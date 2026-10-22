# 门审计（gate audit）· 2026-10-22

窗口：最近 14 天 · 扫描 40 个会话（其中 29 个挂载了工具）· 账本行 0 条

| 门 | 指标 | 实测 | 目标 | 判定 | 备注 |
|---|---|---|---|---|---|
| G1 | NetTokens · 净收益 > 0 的会话占比 | 未测 | ≥ 50% | **未测** | 0/0 sessions with ledger rows |
| G1b | NetTokens · 长会话（≥200 请求）占比 | 未测 | ≥ 70% | **未测** | 0/0 long sessions |
| G2 | Activation · 机制激活率（挂载会话 fire ≥1 次） | 75.9% | ≥ 60% | **PASS** | 22/29 mounted sessions |
| G2b | Push · [RECALL] 注入命中会话占比 | 0.0% | 观测项（无预声明门） | **—** | 0/29 sessions carry a [RECALL] block in their request header |
| G3 | DrillRate · detail / recall-with-hits | 0.08 | 观测项（推送是否被采纳） | **—** | 3 detail / 37 recall-with-hits |
| G4 | StaleRate · 被 supersede 的行占比 | 0.0% | < 1% | **PASS** | 0/326 memories (5 tagged stale) |
| G5 | 索引 ≤ 700 chars | 680c | ≤ 700c | **PASS** | /Users/sunchuxiong/dsh-loom · 76 memories · 6 lines |
| G6 | Quality Δ · 配对任务成功率差 | 未测 | ≤ 2pp | **未测** | needs paired A/B runs (not derivable from logs) |
| G7 | 账本自身开销 | 未测 | < 0.5% 请求时延 | **未测** | in-memory accumulation; needs a timed benchmark |

## 账本合计

- injected 5,592,471c（≈1,398,118 tok）· avoided 1,429,007,050c（≈357,251,763 tok）
- rewrites 11 次 / 2,483,185c（按 cacheDiscount 计罚 2,234,867c）
- **net 1,421,179,712c ≈ 355,294,928 tok**；开源会话 0 条，其中净收益为正 0 条

## 最近会话（按会话落行）

_no per-session rows yet — restart the host so v0.7.5 starts writing them_

> 口径：token = chars/4（与 GUI 一致）；rewrites 罚金 = 前缀字符 ×（1 − cacheDiscount），默认 0.1。
> 未测即未测——不猜。G5/G6/G7 需要运行中的宿主或配对实验。
