# AML 编程榜（coding）全量快照与观察 · 2026-08-21

> 数据源：站点内嵌 `coding-data.js`（`/leaderboard/academic/coding` 与 `/leaderboard/industry/coding`，
> 非 API；API 对该 track 返回空）。原始 JS：`research/aml-coding-data-2026-08-21.js`；
> 精简表：`research/aml-coding-2026-08-21.json`。

## 规模与刻度
- 共 58 条：**academic 43 / industry 15**。
- 主指标 `taskSolve`（总体解决率 %），细分为 New Feature % / Bug Fix %；另有 returnSize、
  searchTime/addTime/totalTime 与 token 档位。
- 分数刻度：52.667 ≈ 79/150；150 = 51(new feature?) + 99(bug fix?)（两细分分母之和），
  提示评测任务集为 150 个基础软件工程任务（官方 README：12 仓库 / 150 基础任务 / 1290 时间限制历史任务）。

## 核心现象：学术 coding 榜没有任何提交超过官方 baseline
- academic 峰值 **52.67**，与**官方 `aml-memory-baseline` 同一分数**，且 **8 个系统并列 52.67**
  （AM-Link / AMC-Memory / aml-memory-baseline / aml-memory-mvp / causal-memory /
  Hybrid Episodic Memory / Memoria / nano-memory_chris）——大概率都基于官方 baseline 模板。
- **43 个 academic 提交中 0 个 > 52.67**；其余 35 个分布在 46.00~52.33。
- industry 峰值 MemoraX **62.00**（唯一 >52.67 的 track 内高分），其余 51 以下为主；
  若官方对照 "no-memory-8000"（无记忆 + 8k 上下文）基线的 taskSolve ≥ 62，则**连 industry
  也没有提交超过**。注：页面与资源中未见该基线显式数值，显示于网页端（待确认）。

## 为什么超不过（数据驱动的解释）
1. **同分带极窄**：academic 43 个提交挤在 46.00–52.67（6.7 分空间），区分度远低于 textual 榜
   （23–45 分、22 分空间）。coding 评测当前的"记忆检索边际价值"很小。
2. **52.67 像是任务集的理论小天花板**：官方 baseline 检索 + gpt-4o-mini 能解决其中 79/150；
   其余任务需要超出模板的检索/工程能力，首届截止前无人突破。
3. **记忆甚至可能净负**：若 no-memory-8000 基线 ≥ 52.67，则"加了记忆"没有带来解决率的提升
   （检索噪音/返回过量反而干扰 answer 模型）——与 textual 榜"纯 BM25 37%→榜首 45%"类似，
   但 coding 上差距更极端。

## 与 dsh-engram 相关的观察
- **词法/简单方法在 coding 上不落下风**：SQLite-FTS-Baseline 50.00、Refind 50.00、
  FlowGrid 49.33、Mem0 48.67、Vectorize Hindsight Cloud 46.67 —— 纯规则/词法与向量/混合几乎同带，
  官方 baseline 本身就是简单实现。
- 再次验证：当前评测阶段，**记忆系统之间的检索质量差异对"任务解决率"贡献有限**，反而
  证据组织（返回什么、返回多少：returnSize/tier）更可能决定成败。
- 首届赛事 coding 轨道整体区分度不足，后续版本（含代码记忆维度 Debug/Development Memory）
  是否会拉开差距值得跟踪。
