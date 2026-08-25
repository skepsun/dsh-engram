# dsh-engram 改进方案 · Context GC（自动 GC = 替代自动 compact，而非记忆面板回收）

> 依据：[pi-esr Context GC](https://github.com/skepsun/pi-esr/blob/master/extensions/CONTEXT_GC.md)
> （`extensions/context-gc.ts` + `CONTEXT_GC.md`，v0.7.0 落地）deep-dive。
> 一句话定位（用户口径）：**pi-esr 的自动 GC 用于替代自动 compact（如 DSH 自带的上下文压缩），
> 而不仅仅是记忆面板里的 gc**。
> 约束：全部**纯规则 / 确定性 / 可回退 / 默认不烧额外 LLM（可配置）**；host 随 `dsh web` 重启生效。
> **状态：提案待审（未实施）。**

---

## 1. 现状与缺口

| 面 | 现状 | 缺口 |
|---|---|---|
| 记忆面板 GC | `esr_gc` 工具 + 定时 `runGcAll()` → `store.gc()`：TTL 过期归档、超容量淘汰、stable 任务 retention、悬空链接清理（只归档、不硬删） | 这**只是存储维护**，完全不参与上下文窗口 |
| DSH 自动 compact | 基座 bundle 挂 `@deepseek-ai/dsh-compaction-basic`（`BasicCompactionEngine`）：pressure / context-overflow 时用 `ctx.llm.stream()` 做**有损全量 LLM 摘要**，替换旧轮次 | 有损、不可查询、摘要本身烧上下文；与 engram 已持久化的可重取细节重复付费 |

> 结论：dsh-engram 目前**没有**接入 DSH 的 compaction 接缝，所以「自动 GC = 替代自动 compact」这一层完全缺失。
> 本提案只补这一层；记忆面板 GC 保留原样（两者职责正交，互不干扰）。

---

## 2. 核心思路（对齐 pi-esr，落到 DSH 接缝）

pi-esr 在 pi 侧 hook `session_before_compact`，把「被驱逐消息」扫描出 provenance 锚，返回**指针摘要**
替代 LLM 压缩；只有**无锚轮次**才走 scoped LLM 叙事兜底。

DSH 侧的等价接缝（已核实源码）：

- `ctx.compaction` = 抽象的 `CompactionEngine`，默认实现 `BasicCompactionEngine`（`@deepseek-ai/dsh-compaction-basic`）。
- `BasicCompactionEngine` 的**唯一子类钩子**是 `protected summarize(input, agent, signal)`；
  其 `SummarizationInput.messages` = **被驱逐的 shadowed region（surface 顺序的完整消息）** ——
  正好等价于 pi 的 `messagesToSummarize`。
- `summarize` 返回 `SummaryResult` 后，`compactSurfaceRegion` 会统一经 `frameSummary()` 包装成
  `user/message`（compactCheckpointSource + `<compacted-summary>` framing）落盘 —— 锁、回放校验、
  tool-call/result 配对平衡、token 定价全都不用我们碰。

**方案：`ContextGcEngine extends BasicCompactionEngine`，只重写 `summarize()`**，
把「LLM 全量摘要」换成「provenance 扫描 → 指针摘要 +（可选）无锚叙事」。
DSH 的自动 compact 一切触发/机制照旧（pressure / context-overflow / `/compact`），只是**摘要内容换成 GC 产物**。
这就是「替代自动 compact」在 DSH 里的最小正确落地。

六条 GC 约束映射（pi-esr `concept-context-gc` → dsh-engram）：

| pi-esr 约束 | dsh-engram / DSH 行为 |
|---|---|
| stable-task-evictable | stable 任务（含 artifact/snapshot，记忆面板已归档原文）→ 指针 `esr_ready` / 看板回看，不逐字复述 |
| indexed-output-evictable | engram 已落库记忆（`engram_store` / auto-capture / recall 命中的 `#xxxxxx`）→ 指针 `engram_detail(id)` |
| loom-stored-evictable | 同 engram 记忆 + `filePath` 锚（提示性，不单独作重取调用） |
| working-set-protected | active 任务 + 其 `memoryRefs` 引用记忆 + 相关 constraint → 在摘要里**复述**，永不驱逐 |
| pointer-salience | 每个被驱逐类别都带**显式重取调用**（工具名 + 参数） |
| no-provenance-no-evict | 无锚轮次 → scoped LLM 叙事（默认开，可配 `gcNarrative`）；失败/关闭 → 截断原文兜底 |

---

## 3. 实现设计

### 3.1 新文件 `lib/context-gc.js`（host，~380 行）

```
scanProvenance(messages)          # 纯函数：消息 → ProvenanceReport
groupTurns(messages, anchored)    # 纯函数：按 user 消息切轮次，标 anchored
buildPointerSummary(report, domain, ws)   # 纯函数：→ 指针摘要（零 LLM）
summarizeUnprovenanced(turns, ctx, signal, { narrative })  # 叙事/截断兜底
ContextGcEngine extends BasicCompactionEngine
  - summarize(input, agent, signal)   # 唯一重写点
  - gcConfig (gcNarrative / gcNarrativeMaxTokens / gcNarrativeMaxChars / gcFallback)
```

**扫描规则**（DSH `Message.content` 的 `tool-call` / `tool-result` block）：
- 锚工具：`engram_store` / `engram_recall` / `engram_detail` / `esr_task` / `esr_close` /
  `esr_ready` / `esr_link` / `esr_dep` / `esr_claim` / `esr_unclaim` / `esr_node` / `esr_model`。
- 提取：memory id（`#xxxxxx` / `mt…`，工具结果回显 + `engram_detail` 参数）、task/entity id
  （`task-*` / `ent_*`）、`filePath` 存在性。
- **管理工具不算锚**：`esr_gc`（同 ctx_purge 不重跑原则，绝不指示模型重跑 GC）。
- 无模型调用、纯字符串/正则，确定性可单测。

**指针摘要**（替换默认摘要正文，仍走 `frameSummary` 包装）：
```
## Context GC — 被驱逐细节可重取
Evicted N turn(s): X with re-fetchable provenance, Y narrative-only.
### engram 记忆（可精确重取）
- `engram_detail(id: "…")`   # 被驱逐段内已落库的记忆
- `engram_recall(query: "…")`  # 被驱逐段的检索线索（来源查询）
### ESR 任务状态
- active 工作集复述：`tsk_… [active] · 约束 …`
- stable（已闭环/已快照）→ `esr_ready` / 看板回看
### 未在其他地方保留的叙事
<narrative 或 "None — all evicted turns had re-fetchable provenance.">
---
_优先重取，不要重新推导。_
```

**叙事兜底**（`summarizeUnprovenanced`）：
- `gcNarrative: true`（默认）且存在可用路由 → scoped `ctx.llm.stream()` 一次性调用
  （`purpose: 'compaction'`、`maxTokens: gcNarrativeMaxTokens=1024`、复用被驱逐消息前缀），
  仅此路标记 `llmStreamCall: true`。
- 无模型 / 失败 / `gcNarrative: false` → 截断原文（`serializeConversation`，上限 4000 字符，标注截断）。
- 无无锚轮次 → 输出 `_None_`，**完全零模型调用**（最常见路径：编程会话大多有工具锚）。

**可回退（永不破坏 compact）**：
- `summarize()` 内任何扫描/读取/叙事错误 → `return super.summarize(input, agent, signal)`（默认 LLM 摘要）。
- `gcReplacesCompaction: false` → 引擎根本不加载，DSH 继续走 compaction-basic。
- engram 域未就绪（无 storage-domain 的 profile）→ 同上回退，不阻塞宿主启动。

### 3.2 `lib/index.js` 增量

- `DEFAULTS` 加：
  ```js
  gcReplacesCompaction: true,   // 接管 DSH 自动 compact（false=完全回退默认）
  gcNarrative: true,            // 无锚轮次走 scoped LLM 叙事；false=截断原文（纯机械）
  gcNarrativeMaxTokens: 1024,   // 固化默认即可，不进设置 UI
  ```
- `ctx.effect` 内（`index.js`）：`loadCompactionEngine(ctx, { auto: true }, deps, { mode })` → `new Engine()`，
  注册 `compaction` 服务；`mode = gcReplacesCompaction ? "context-gc" : "default"`。Service 实例注册即生效、
  随 fiber 卸载自动移除（cordis `Service` 语义）→ 卸载/reload engram 自动回滚，天然可逆。
- 记忆面板 GC（`gcEnabled` / `esr_gc`）原样保留。

### 3.3 装配（mounting，实施时已运行时验证 cordis 同名 service 语义）

**验证结论**（cordis `reflect.provide` + loader `isolate` 源码 + loader-composition 测试）：
cordis **拒绝**同一隔离域的第二个同名 provider——`provide()` 直接抛
`service "compaction" has been registered at <fiber>`，**不是**「更深/更晚 wins」。
因此装配=下面两条，都已落库：

1. **基座行禁用（必须）**：dsh-engram 的 `cordis.patch.yml` 增加
   ```yaml
   - id: compaction-basic
     disabled: true
   ```
   bundle patch 层按 bundle 顺序应用、dsh-engram 晚于 dsh-base → 该行生效；卸载 engram 即自动还原。
   禁用后 `compaction` 由 dsh-engram 独占提供：`gcReplacesCompaction:true` → ContextGcEngine，
   `false` → 裸 `BasicCompactionEngine`（与默认行为一致），因此 **`compaction` 服务永不缺席**。
2. **preset 面条目（web profile 必需）**：web 面把 compaction 移到 agent preset 的 isolate realm
   （dsh-web-app 禁用基座行、`standard` 预设自挂 `compaction-basic`），host 平面条目进不去该 realm。
   为此新增可挂载条目 `lib/compaction.js`（`name: dsh-engram-compaction`、`inject: [llm, tokenMeter,
   sessions]`、`package.json` `./compaction` export），把预设 `compaction` 组里的 `compaction-basic`
   行换成 `- name: dsh-engram/compaction` 即按 session 生效（recipe 见 README）。

### 3.4 依赖与设置

- `package.json` peerDependencies 追加（均 optional）：
  `@deepseek-ai/dsh-compaction`、`@deepseek-ai/dsh-compaction-basic`（宿主基座已装，此处仅声明类型与导入契约）。
- `settings.js` schema 追加 `gcReplacesCompaction` / `gcNarrative`；`SETTINGS_KEYS` 同时收录二者。
  设置 UI 收敛原则（assessment P4）下**只把 `gcNarrative` 放进高级折叠**，`gcReplacesCompaction` 走
  profile / preset 配置。
- `peerDependencies` 追加（均 optional）：`@deepseek-ai/dsh-compaction`、`@deepseek-ai/dsh-compaction-basic`、
  `@deepseek-ai/dsh-llm`；`setup-links.mjs` 补三条 junction（`.mjs` 开发工作流）。

---

## 4. 测试（`test/context-gc.test.mjs`）

| 组 | 用例 |
|---|---|
| 扫描 | tool-call/tool-result 提取 memory id / task/entity id / filePath；`esr_gc` 排除；tool-result 回显关联 |
| 轮次 | 按 user 切轮、anchored 透传、无锚轮次归集 |
| 指针 | 合成 report + 假 domain：working-set 复述、stable 指针、`_None_` 叙事、footer |
| 叙事 | 关（纯机械、无 llmStreamCall）/ 开且成功（llmStreamCall）/ 失败截断兜底 |
| 引擎 | 假 ctx + 假 session：`summarize()` 产指针块不落错；**错误 → 回退 super**（注入可替换的 defaultSummarize 以便单测）；`gcReplacesCompaction:false` 不加载 |
| 装配 | config 合并键存在；`loadCompactionEngine` 两 mode 各返回正确类；preset 条目 shape + apply 挂载（default/context-gc 各断言受托引擎） |

回归：`npm test`（当前 143/143 全绿）+ `npm run build:client`。

---

## 5. 风险与不做

- **不做主动触发**（等价 pi `--gc-auto` / `--gc-auto-percent`）：只跟随 DSH 现有时机（pressure /
  context-overflow `/compact`）——用户已确认，改动最小。
- **不重写** retention walk / token 定价 / 锁 / 回放校验 / tool 配对平衡：全部复用 `BasicCompactionEngine`。
- **不与 tool-result pruner 冲突**：`ctx.toolResultPruner` 在 range 选择前先压大 `tool/result` 节点，
  我们的 `summarize` 收的是 prune 后的 shadowed region；指针指向 engram 本体记忆（不受 prune 影响）。
- 指针摘要比默认摘要短 → 每次 compact 省 token 可量化（落盘前用 `ctx.tokenMeter.estimateMessage` 记一次）。
- 极端场景：无任何锚且 `gcNarrative` 关 → 截断原文可能比默认 LLM 摘要长；有 `gcNarrativeMaxChars` 上限兜底，
  且这是用户显式关闭叙事的取舍。

---

## 6. 落地顺序

1. `lib/context-gc.js` 纯函数层（scan / group / pointer / narrative-fallback）+ 单测（先行，无依赖）。
2. `ContextGcEngine` + `summarize()` 重写 + 回退注入 + 单测。
3. `index.js` 装配 + config 键 + 装配单测（含「卸载回退」验证）。
4. 设置 schema / UI 高级折叠（`gcNarrative`）。
5. README.zh.md「记忆 GC」章节扩为「自动 GC = Context GC（替换自动 compact）+ 记忆面板 GC」，FEATURES.zh.md 记一笔。
6. 全量 `npm test` 回归 + `npm run build:client`（若 UI 有改动）。
