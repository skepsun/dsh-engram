# dsh-engram 改进方案 · 借自 Hindsight（三个概念，不引重路线）

> 依据：[vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) 深度研究（2026 春季快照）。
> 原则：三条全部**纯规则 / 无向量 / 无 LLM 蒸馏 / 确定性可单测**，符合既有约束
> （不引重路线、中文、host 改动等自然重启、dock 极简）。
> 真实基线：Kototoro memories 71（扁平）/ tasks 1 / links 4 / nodes 3；toolstats 近 14 天
> todo 48 · ESR ~6 · esr_node/esr_link 接近零。

---

## 总览

| # | 概念（来源） | 解决什么 | 落点 | 成本 | 依赖 |
|---|---|---|---|---|---|
| A | **Observation 范式**：证据引用 + proof_count + refine-not-overwrite（consolidator.py） | 71 条扁平记忆无从浓缩；失败/成功经验被覆盖不保留证据链 | `lib/store.js` 写入侧 + `lib/obs.js` 新模块 + board 观测区 | host ~250 行 | 无 |
| B | **Mental model 预计算**：常驻答案读零计算 + 水印刷新（mental_models + last_memory_seen_at） | 每次会话现查照样费 tokens；dock/board 每次重算 | `lib/mental.js` + 新工具 `esr_model` + board 常驻条 | host ~200 行 | 依赖 A 提供的 observation 汇总 |
| C | **召回重排信号**：proof_count boost × recency 半衰期（reranking.py） | 现行排序只有 recency+精确匹配；失败复活性差 | `lib/rerank.js` 纯函数 + esr_recall 接入 | host ~80 行 | 无 |

建议实施顺序：**C → A → B**（C 最小且立即见效 → A 核心价值 → B 消费 A 的产出）。

---

## A. Observation：证据浓缩 + 证据计数 + 增强而非覆盖

### 问题
- 记忆是扁平列表；同一主题的多次失败/多次成功没有聚合，`esr_recall` 返回的是散点。
- D1/D3 的「失败记忆复活」只恢复了单条，没有形成「这个模式被证明 N 次」的信念。

### 数据模型（新增 `tables.observations`，存 storages/dsh_engram.json）
```jsonc
{
  "id": "obs_<8>",
  "ws": "/ws/A",                 // "" = 全局
  "text": "浓缩后的信念语句（初始 = 触发记忆文本）",
  "kind": "belief",              // belief | pattern | risk（由触发记忆 tags 推导，不引 LLM）
  "proof": { "count": 3, "sources": ["mem_<8>", ...] },
  "span": { "first_seen_at": 1, "last_seen_at": 2 },
  "negations": 0,                // 反证计数 → 触发 weaken/stale
  "trend": "stable",             // new|strengthening|stable|weakening|stale（算法计算）
  "tags": ["fail"],
  "updated_at": 3
}
```

### 算法（`lib/obs.js`，全部纯函数 + 一个写入钩子）
1. **`concentrate(ws, memText, memId, tags)`** —— host 写入记忆（esr_store_memory / 失败复活 / engram 自动捕获）后调用：
   - 桶化：按 `(entity 锚点 或 tags) + 字符 n-gram Jaccard ≥ 阈值(0.45)` 找既有 observation（中文无需向量）。
   - 命中 → **merge 而非覆盖**：`proof.count+1`、`sources.push(memId)`、`span.last_seen_at = now`、`updated_at=now`；`text` 仅在新增细节时 append（简单规则：新文本含旧文本不存在的 token 段则并句）。
   - 命中且可判定为**反证**（tags 含 `error`+当前 text 与旧 text 出现否定词对）→ `negations+1`，`proof.count` 不变。
   - 未命中 → 新建 observation（`proof.count=1`）。
2. **`computeTrend(span, now, recentDays=30, oldDays=90)`** —— 借鉴 observations.py 的 `Trend`：
   - last_seen 在 30 天内且 first_seen 更早 → `strengthening`
   - 全部证据在 30 天内 → `new`
   - 90 天内有证据 → `stable`
   - 90 天内无新证据但有历史 → `weakening`；无证据 → 不存在的桶自清（GC 归入 esr_gc）。
3. **读取注入**：`esr_recall` 把 `proof.count ≥ 2` 的 observations 作为高权重候选混入返回（标记 `source: observation`），证据门语义不变。

### Web 展示
- 只进 **board**（dock 保持极简）：columns 上方一行可折叠「观测 · N 条信念」条，展示 `text · ✓×count · 趋势图标`，展开可看 sources 列表。
- KPI 行（toolstats 那行）旁加 `观测 N`。

### 测试
`test/obs.test.mjs`（node:test 直接 import）：
- 首次写入建桶 / 二次相同语义 merge（count 2 且 sources 追加）/ 反证 negations+1 /
  trend 四种时间窗 / 阈值下不误并 / Jaccard 中文样例。

---

## B. Mental model：常驻摘要 + 水印刷新

### 问题
- agent 每轮现查「这个工作区现在什么状态」要花多次 recall；看板每次挂载重算 overview + tasks + links。
- 产出一个可被反复读取、只在数据变化时才重算的「常驻答案」→ 读零计算。

### 数据模型（新增 `tables.models`）
```jsonc
{
  "ws": "/ws/A",
  "content": "## /ws/A 常驻摘要\n- 任务：2 active（1 就绪）/ 1 stable\n- 实体 3 · 链接 4\n- 观测 6 条信念（2 失败模式已重复 3 次）\n- 近 14 天：todo 48 · ESR 6\n- 生成于 N 分钟前",
  "generated_at": 1,
  "dirty": true,           // 任何 esr_* 写操作后置 true
  "sources_hash": "sha256 摘要（惰性校验可跳过重算）"
}
```

### 算法（`lib/mental.js`）
- **`bumpDirty(ws)`** —— host 工具写钩子（esr_task/esr_close/esr_node/esr_link/esr_store_memory/todo 沉淀）之后调用。
- **`getModel(ws)`** —— 读缓存；`dirty` 或过期（>10min）则**纯聚合重算**（无 LLM）：复用 `domain` API 的 tasks/entities/links 计数 + `collectToolCounts` 的近况 + `tables.observations` 的 top 信念 → 拼 markdown；重算后 `dirty=false`。
- **暴露**：
  - agent 工具 `esr_model(ws?)` —— 返回常驻摘要 markdown（**零 LLM、一次 DB 读**）放在工具说明顶部「先看 model 再 recall」；response 带 `modeling:` 行同款风格。
  - web endpoint `/model?ws=`（route 注册随下次重启，与 /toolstats 同批）。

### Web 展示
- board 顶部「常驻摘要 · 生成于 N 分钟前」可折叠条（可复制、可下载为 md——复用自己的 buildTasksMarkdown 思路，纯 client 无依赖）。

### 测试
`test/mental.test.mjs`：dirty→重算 / 未 dirty→命中缓存（generated_at 不变）/ 写操作触发 bump（route 注入假 service）/ 空工作区占位内容。

---

## C. 召回重排：proof_count × recency 半衰期

### 问题与现状核实
- 现行 `util.js bm25Rank` **已含** recency 半衰期因子 `1 + 0.5·exp(-ageDays/14)`（14 天、最多 +50%，
  不覆盖强词法相关），也有 tag-exact/fuzzy/phrase/BM25 权重——真正缺失的是**证据强度信号**：
  同样词频的记忆，被证明过 N 次的（hits）没有被排序优待。
- D2 失败复活已在 error 记忆重复时递增 `hits`；它就是现成的 proof 计数。

### 实现（已落地：`lib/rerank.js` + `util.js bm25Rank` 接线）
```
score_final = score_lexical                     // BM25 + tag/phrase boost（既有）
            × (1 + 0.5·exp(-ageDays/14))        // recency 半衰期（既有）
            × evidenceBoost(hits)               // 新增：1 + 0.1·min(max(0,hits), 5)，饱和 ±5%
```
- `evidenceBoost(hits, {alpha=0.1, cap=5})`：0→1.0、5→1.5（封顶），保守不喧宾夺主（借鉴 reranking.py 的 proof alpha）。
- `scoreCandidate(matchScore, hits)`、`sortByEvidence(list, opts)`（稳定、可注入 tiebreak）。
- 接入点：`bm25Rank` 词法分后乘 `evidenceBoost(r.hits ?? 0)`——encerence recall/searchMemories 全走这里，零额外改动。
- 「失败复活」天然增强：高 hits 的失败记忆在同词频下与新鲜记忆竞争更接近。

### 测试
`test/rerank.test.mjs`：三种 matchKind 基准 / 半衰期形状（t=0, halflife, 2*halflife 分别为 1, 0.5, 0.25）/ proof cap / 稳定排序（同分保序）/ 未来时间戳钳制。

---

## 分阶段计划（每阶段：代码 + 测试 + client-hmr 即时 / host 待重启 + 中文总结）

| 阶段 | 内容 | 交付物 | 生效 |
|---|---|---|---|
| C | rerank 纯函数 + 接入 esr_recall | `lib/rerank.js` + `test/rerank.test.mjs` | 等自然重启 |
| A | observations 表 + concentrate/trend + recall 注入 + board 观测条 | `lib/obs.js` + `lib/store.js` 钩子 + `test/obs.test.mjs` + board | host 待重启；board 即时 |
| B | mental 缓存 + esr_model 工具 + /model 端点 + board 常驻条 | `lib/mental.js` + `test/mental.test.mjs` + board | host 待重启；board 即时 |

每阶段与既有实现正交：不动 dock 交互（除可选 KPI 一列）、不动证据门、不动 esr_close 语义。

## 明确不做（保留约束）
- 不做 LLM 抽取/浓缩（Hindsight retain 管线）——成本与我们的形态不匹配。
- 不做向量/图库/交叉编码器重排。
- 不做 mental model 的「用户定义问题」自由文本——用固定模板，纯聚合。
- observations 的「来源逐 quote 引用」简化为 sources 列表（证据门已足够）。

## 风险
- 浓缩误并（Jaccard 阈值误命中）→ 反证机制 + GC 可兜；阈值可配。
- observation 桶增长失控 → 每 ws 上限（默认 50 条），超出按 proof 降序逐出（保留计数进 audit），归入 esr_gc。
- mental 缓存脏标记漏置 → `bumpDirty` 挂全量写钩子 + 过期兜底（10min 强制重算）。
