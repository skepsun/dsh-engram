# dsh-engram Context GC — 从 0 开始的使用教程

> 适用范围：dsh web（preset 平面）+ headless/TUI/base（host 平面）。
> 一句话：**用「机械驱逐 + 重取指针」替代 DSH 自带的有损 LLM 全量摘要压缩。**
>
> **v0.6 起是 opt-in**：`gcReplacesCompaction` 与 `autoWebCompaction` 默认都是 `false`，
> 插件默认保留 DSH 自己的摘要。要启用 Context GC，先打开这两个开关（见第 3 步）。

---

## 1. 这是什么

DSH 默认的上下文压缩（`compaction-basic`）在自动 / 手动 compact 时，把被驱逐的历史压成一段
**不可查询的散文摘要**——有损、且摘要本身还要烧 token。

dsh-engram 的 Context GC 把这一步换成：

1. **扫描**被驱逐轮次里的 provenance 锚——`engram_store`/`engram_recall`/`engram_detail`
   回显的 `#记忆id`、`esr_*` 涉及的 `tsk_*`/`ent_*`、`file_path` 锚；
2. **指针摘要**——每条被驱逐类别都带显式重取调用（`engram_detail(id)` / `engram_recall(query)`
   / `[ESR]` 块 / `esr_ready`）；active 工作集在摘要里**复述**、不驱逐；
3. **兜底叙事**——只有**无锚轮次**（纯对话/推理，没有任何可重取落点）才走 scoped LLM 摘要
   （`gcNarrative`，默认开）；关掉后整条路径**零 LLM**，无锚轮次截断原文保留。

触发时机跟 DSH 现有 compact 完全一致：**自动压力（约 80% 窗口阈值）→ context-overflow → 手动
`/compact`**。任何一步出错都会回退默认压缩，**永不破坏 compact、永不弄丢会话**。

### 两个平面

| 平面 | 覆盖 | 接管方式 |
|---|---|---|
| host 平面 | headless / TUI / base 型 profile | 打开 `gcReplacesCompaction` 后，插件启动时注册 ContextGcEngine；否则挂裸 `BasicCompactionEngine`（宿主摘要） |
| web 平面 | dsh web 的 agent preset（shipped + 用户预设） | 打开 `autoWebCompaction` 后，启动时把 stock 预设的 `compaction-basic` 行换成 `dsh-engram/compaction` 行 |

web 平面在两种 DSH 预设布局上都生效（插件按 `compaction` 组的结构定位行，不依赖缩进）：

- **DSH ≤ 0.1.x：旧版组合文件** `<root>/<id>/agent.cordis.yml`（行在 4 空格缩进）；
- **DSH ≥ 0.2.0：声明式出厂预设** `@deepseek-ai/dsh-web-app/presets/<id>.patch.yml`
  （行在 14/16/18 空格缩进，文件里是 `- insert:` 声明的 `@deepseek-ai/dsh-agent-preset`）。
  用户自定义的声明式预设（存在 profile patch 里、没有出厂文件）不会被改写。

---

## 2. 前提

- 已安装 dsh（含 **dsh web**）与一个 web profile；
- dsh-engram 已作为 profile 依赖挂好（`link:/path/to/dsh-loom` 或 npm 包），profile patch 里有
  `engram` 行；
- 后端依赖 `@deepseek-ai/dsh-compaction-basic` 可被解析（安装 engram 时自动链接）；
- 记忆/任务侧已配置好 engram 存储域（`engram_store` 有可写域、ESR 可选）。

---

## 3. 从 0 安装并启用（4 步 + 1 条铁律）

```bash
# ① 安装（源码开发方式；生产用 npm install dsh-engram）
cd /path/to/dsh-loom && npm link            # 或 profile package.json 加 "dsh-engram": "link:..."

# ② 打开两个 opt-in 开关（设置卡「记忆 GC」区，或 profile patch）
#    gcReplacesCompaction: true   # host 平面换 ContextGcEngine
#    autoWebCompaction: true      # web 预设自动改写（带 .engram.bak）

# ③ 启动一次 dsh web —— 这一步做「自动装配」
#    - host 平面：按 gcReplacesCompaction 注册 Context GC 为 compaction 服务
#    - web 平面：改写每个 stock 预设文件（compaction-basic 行 → dsh-engram/compaction 行，
#      每个文件旁留 .engram.bak 备份）：
#        DSH ≤ 0.1.x → <root>/<id>/agent.cordis.yml.engram.bak
#        DSH ≥ 0.2.0 → <presets>/<id>.patch.yml.engram.bak
dsh web

# ④ 再重启一次 dsh web —— 让已接管的预设真正生效
dsh web
```

**铁律：代码/预设改动后必须重启 dsh。** 运行中的进程把旧 `lib/*.js` 和旧预设行都缓存/装载在内存里，
磁盘上的修复与文件改写不会热生效；只有在两个开关打开的前提下重启，才会加载新代码并接管 web 预设。

> 也可以先手动预写再一次性重启：
> ```bash
> npx dsh-engram enable    # 等价于启动时的自动装配（需 autoWebCompaction；通常 no-op）
> npx dsh-engram status    # 确认 preset 已 wired
> # 然后重启 dsh web 一次
> ```

---

## 4. 验证是否生效

```bash
npx dsh-engram status      # 每个预设显示 wired（已接管）/ stock（未动）/ custom（不碰）
npx dsh-engram doctor      # status + 按缺口排序的下一步建议
```

启动日志的两行金标准：

```
engram context-gc: compaction = Context GC (mechanical eviction + re-fetch pointers)   # host
engram web-provision: wired Context GC into preset "standard" (…); restart dsh web …    # web 每个预设一行
```

其他入口：
- 记忆看板头部状态徽标（"Context GC · 主机 ·N 预设"）；
- 权威快照 `$DSH_HOME/engram/context-gc.status.json`。

---

## 5. 日常使用：它替你做掉了什么

在任意会话里照常对话、照常用工具即可。当 compact 触发（自动压力 / 溢出 / 手动 `/compact`），
落在会话里的 checkpoint 长这样：

```
## Context GC — evicted detail is RE-FETCHABLE (do not re-derive)

Older conversation was evicted to free context. The detail is NOT lost: it lives in the engram memory
store and the ESR task store. Re-fetch ONLY when you actually need it, using the tools below.

Evicted 3 turns. 2 with re-fetchable provenance, 1 narrative-only.

### ESR task state
Reload the full graph with the [ESR] block / `esr_ready` — only re-fetch what you need.
- Active working set (still tracked in ESR):
  - `tsk_act1` — migrate compaction engine
- 2 closed task(s) retained — details stay re-fetchable via the [ESR] block.

### engram memories (re-fetchable)
Fetch the exact records that are still in the store:
- `engram_detail(id: "8f7a2c4e-…")` [decision]
- Re-run recall: `engram_recall(query: "compaction shrink gate")`

### Narrative not captured elsewhere
（只有无锚轮次的 scoped 叙事；gcNarrative 关掉则为截断原文）
```

指针类别速查：

| 被驱逐内容 | checkpoint 里留下的指针 |
|---|---|
| engram 记忆（含 auto-capture / recall 命中 `#xxxxxx`） | `engram_detail(id)` / `engram_recall(query/entity)` |
| ESR 任务 / 实体 / stable 任务 | `[ESR]` 块 / `esr_ready` / 实体 `ent_*` |
| 文件锚 | `filePath` 路径提示 |
| 无锚轮次（纯对话 / 推理） | `gcNarrative` 叙事（默认开）或截断原文（关闭后） |
| active 工作集 | **在摘要里复述，绝不驱逐** |

手动触发：`/compact` 命令（来自 `command-compact` 插件）。

---

## 6. 配置项

> 位置：dsh web 设置卡「记忆 GC」区 / profile patch 的 `engram` 行 `config:` / 配置 JSON。

| 键 | 默认 | 作用 |
|---|---|---|
| `autoWebCompaction` | `false` | 是否在启动时自动改写 stock 预设并接管 web 平面（opt-in，见开头） |
| `gcReplacesCompaction` | `false` | `true`=用 Context GC；`false`=回退 DSH 默认 LLM 摘要（`compaction` 服务永不缺席）。opt-in |
| `gcNarrative` | `true` | 无锚轮次是否走 scoped LLM 叙事；`false`=**纯机械、整条路径零 LLM** |
| `gcNarrativeMaxTokens` | `1024` | 叙事生成的最大 token 数 |
| `gcNarrativeMaxChars` | `4000` | 无锚轮次原文兜底的截断长度（字符） |

**改配置后要重启 dsh web**——web 预设行会在下次启动时被自动刷新成新配置（幂等重写）。

---

## 7. 运维与卸载

| 命令 | 作用 |
|---|---|
| `npx dsh-engram status` | 查看 host + 每个预设的接管状态与生效配置（自动适配新旧预设布局） |
| `npx dsh-engram doctor` | status + 按缺口排序的下一步 |
| `npx dsh-engram enable` | 手动重跑启动时的自动装配（通常 no-op） |
| `npx dsh-engram revert` | 把全部预设还原成 stock `compaction-basic` 行 |
| `npx dsh-engram status --presets-dir <dir>` | 声明式预设目录探测失败时手动指定（如 `DSH_WEB_PRESETS_DIR`） |

- 仓库内 `npm run web-compaction:*` 是同一 CLI 的别名。
- 每个被改写文件旁有 `.engram.bak`（create-only，保留首次原件）：
  `agent.cordis.yml.engram.bak`（旧版布局）或 `<id>.patch.yml.engram.bak`（声明式布局）。
- **卸载 dsh-engram 之前先 `npx dsh-engram revert`**——否则预设里的 `dsh-engram/compaction` 行会
  悬空，web 会话挂 loading。

---

## 8. 排障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| 自动压缩没触发，反而触发模型侧上下文溢出 | 运行中的进程还是**旧代码**（shrink-gate 回滚 bug） | **重启 dsh web** 加载修复（本教程最典型场景） |
| 手动 `/compact` 报 `manual compaction did not commit cleanly` | 旧 Context GC 代码缺 provider/model 落盘，commit 阶段被拒 | 同上：重启加载新代码 |
| 长会话自动压缩仍不提交（`start` 涨、`summary` 不涨） | 同上 / 或某些后端版本旧 | 重启；确认日志有 `compaction = Context GC` |
| 日志 `… keeping the existing compaction service` | 同域已有 compaction provider（基座行未禁 / 双 provider） | 检查 patch 与预设行，避免重复注册 |
| 日志 `web-provision … skipped (custom)` | 该预设是自定义/无 compaction 布局 | **设计如此**，不会碰 |
| 日志 `preset "x" has no shipped file …` | DSH ≥ 0.2.0 的声明式用户预设（存在 profile patch，无出厂文件） | 在设置卡/编辑器里改；或手动把 compaction 组换成 `dsh-engram/compaction` |
| 改了 shipped 预设文件却不生效 | profile patch 里有 `preset-*` 覆写行（Web 编辑器保存的 `config.plugins` 优先） | 在编辑器里改，或删掉覆写行 |
| 日志 `dsh-compaction-basic unavailable` | 环境缺后端依赖 | 安装依赖；自动回退默认压缩，host 不崩 |
| 极小被驱逐片段（span 小于 checkpoint 开销）不压缩 | harness 收缩闸门对**任何**后端一视同仁 | 属正常，没必要为几十 token 起 checkpoint |
| 改配置后没变化 | web 行要重启才刷新 | 重启 dsh web |
| 遥测「节省 · 剪枝/压缩」一直是 0、净 token 恒负 | 两条入账腿都没触发：L1 拿不到 host 平面的 `toolResultPruner`（0.2.0 的 host 行被禁），压缩节省此前进不了账本 | 确认状态快照 `boundaryPrune.armed: true`（`npx dsh-engram status` 会打印）；压缩自 0.7.5 起按**已提交的** `compaction/summary` 入账（`shadowedTokenCount×4 − 摘要字符数`） |
| `boundaryPrune.armed: true` 但 `activation.boundaryPrune: null`、剪枝节省恒 0 | **工作区键不一致**：历史表键是 `Users-x-proj`（桶名），查询键是 `/Users/x/proj`（header.cwd）→ 历史永远 miss → 还款闸门恒跳过。0.7.7 起两侧归一见 `normalizeWorkspaceKey` | 看 `~/.dsh/engram/boundary-attempts.jsonl`：`kind: skipped` 且 `expectedTotal` 恰等于 50 就是它；修好后 `expectedTotal` 应变成 120（有历史的工作区） |
| 日志里有 `kind: fired` 但 `pruned: 0`，放个大结果再做边界就**一行都没有** | 剪枝在 `session/event` 的 publish 窗口里调 `session.append`，host 的重入检查直接抛错，被监听器的防崩兜底吞掉。0.7.8 起 `queueMicrotask` 把 fire 挪出窗口，抛错也落盘成 `kind: error` | 看 `boundary-attempts.jsonl` 有没有 `kind: error`；没有 error 且 `pruned > 0` 才算真剪到 |

| `fired` 但 `pruned: 0`，而会话里有 `compaction/prune` 事件**没有**对应 todo 边界 | 宿主自己在步与步之间剪超阈值结果（0.2.x 行为）。L1 到达边界时候选已被剪过 → 没得剪 | 0.7.9 起这些剪枝记在账本 `hostPrunedChars` 腿（可见、不认领）。若该腿很大而 engram 腿恒 0，说明 L1 的「再剪一遍」在宿主版本上已无价值，该考虑退场或只留阈值覆盖 || 状态文件说 `host: unavailable` / `web: disabled`，但 `/overview` 说 `host: context-gc` | 同一进程里两个插件实例（一个拿到 profile 配置、一个拿到出厂默认）抢写同一个状态文件，后写的把好的覆盖了 | 0.7.5+ 同 pid 内不允许降级覆盖；以 `/overview` 与 `npx dsh-engram gate-audit --api` 为准 |
| 老会话还在用默认 LLM 摘要（checkpoint 没有 GC 页眉） | 该会话的 agent realm 是在插件接管**之前**组合出来的，realm 里没有 `dsh-engram/compaction` 行；新开会话才拿到 | 新开一次会话即可；已存在的 realm 不会热换 provider |
| L1 状态报 `no toolResultPruner service …` 但 `--dump-config` 里行是启用的 | 行存在却被**运行时**关掉（如 `- id: tool-result-pruner, disabled: true` 的 profile override） | 删掉该 override；bundle patch 只负责重新启用出厂行 |
| L1 状态报 `registered but its fiber is not active yet` | 启动时序：剪枝器 fiber 比插件晚激活（v0.7.2 前会因此永久休眠） | 升到 0.7.2+（改经 `ctx.inject` 武装），然后重启 |

---

## 9. 账本口径（为什么净 token 可能为负）

`net = avoided − injected − rewriteChars × (1 − ledgerCacheDiscount)`，三项都按
`chars / 4` 估算（见 README「Context Ledger」）：

- **injected**：`[ENGRAM]`/`[RECALL]`/`[JIT]`/`[ESR]` 块每请求重计的注入成本；
- **avoided**：**已入账**的节省，只有两条腿——L1 边界剪枝（`toolResultPruner` 剪掉的
  chars × 后续请求数）与压缩（每次 checkpoint 的「被替换区间字符数 − checkpoint 字符数」× 后续请求数）；
- **压缩节省按「已提交」记账**（0.7.5+）：账本不认引擎在 `summarize()` 里算出的数字，只认会话里
  真正落地的 `compaction/summary` 事件——且摘要必须带 Context GC 页眉/尾注（证明是本插件写的）。
  被宿主拒绝、回滚、或退了默认摘要器的压缩，**一律不入账**。这条是踩过的坑：早期版本按引擎
  自报记账，结果把一次没落地的 checkpoint 也记了 29 万字符；
- **rewrite penalty**：L1 剪枝会击穿 KV 前缀缓存，按 `1 − 缓存折价` 一次性计价；
  压缩**不额外计**罚金（压缩是宿主自己的动作，默认后端同样会改写前缀，计了会重复）。

所以：**没剪过、没压缩过的会话，节省必然是 0，净值必然是负的**——负数不代表账本坏了，
只代表这一段时间只花了钱没省到。状态快照的 `boundaryPrune.armed` 告诉你 L1 是否真的
武装；压缩入账要等第一次 checkpoint。

## 10. FAQ

- **有损吗？** 锚定细节**无损**（全部可通过工具重取）；只有无锚轮次走叙事/截断；所有原文仍留在
  会话日志里，即使 checkpoint 被裁剪也能找回。
- **会不会更烧 token？** 默认叙事只覆盖无锚轮次；需要完全零 LLM 就开 `gcNarrative:false`。
- **和记忆面板 GC 什么关系？** 完全正交：面板 GC 管**存储有界**（TTL/超容量归档），Context GC 管
  **上下文窗口**（compact 时驱逐）。
- **是强制的吗？** 不是。`gcReplacesCompaction:false` 即回退 DSH 默认 LLM 摘要。
- **什么时候触发？** 与默认 compact 完全一致：自动压力（约 80% 窗口阈值）→ 溢出 → 手动 `/compact`。
- **之前失败过的会话有没有被弄坏？** 没有。收紧闸门/commit 失败都会**整事务回滚**并写
  `compaction/end`（含 error），不留半成品；修复后直接再 `/compact` 即可。
