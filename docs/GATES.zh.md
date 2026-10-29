# 门审计（gate audit）· 2026-10-29

窗口：最近 14 天 · 扫描 14 个会话（其中 6 个装了 engram；"用过任意工具"的会话 8 个）· 账本行 6 条

| 门 | 指标 | 实测 | 目标 | 判定 | 备注 |
|---|---|---|---|---|---|
| G1 | NetTokens · 净收益 > 0 的会话占比（有节省机会的会话） | 未测 | ≥ 50% | **未测** | 0/0 opportunity rows of 6 — need ≥ 5 for a distribution |
| G1b | NetTokens · 长会话（≥200 请求）占比 | 未测 | ≥ 70% | **未测** | 0/0 long opportunity sessions |
| G2 | Activation · 机制激活率（装上了 engram 的会话 fire ≥1 次） | 83.3% | ≥ 60% | **PASS** | 5/6 installed sessions |
| G2b | Push · [RECALL] 注入命中会话占比 | 83.3% | 观测项（无预声明门） | **—** | 5/6 installed sessions carry a [RECALL] block in their prompt |
| G2c | Push opportunity · 有记忆可推的会话里推送腿渲染占比 | 83.3% | 观测项（无预声明门） | **—** | 5/6 sessions whose workspace has ≥1 memory |
| G3 | DrillRate · detail / recall-with-hits | 0.00 | 观测项（推送是否被采纳） | **—** | 0 detail / 4 recall-with-hits |
| G4 | StaleRate · 被 supersede 的行占比 | 0.0% | < 1% | **PASS** | 0/369 memories (6 tagged stale) |
| G5 | 索引 ≤ 700 chars | 未测 | ≤ 700c | **未测** | pass --api <base>?workspace=<ws> to read the rendered block size |
| G6 | Quality Δ · 配对任务成功率差 | 100.0pp | Δ ≥ −2pp | **PASS** | 18 对配对 · 9 任务 × 2 种子 · eval/g6/runs/r9-net/runs.json |
| G7 | 账本自身开销 | 未测 | < 0.5% 请求时延 | **未测** | run `npm run bench:ledger` and pass --g7 <pct> |

## 账本合计

- injected 5,850,956c（≈1,462,739 tok）· avoided 0c（≈0 tok）
- rewrites 0 次 / 0c（按 cacheDiscount 计罚 0c）
- **net -5,850,956c ≈ -1,462,739 tok**；开源会话 6 条，其中净收益为正 0 条

## 最近会话（按会话落行）

| session | requests | injected | avoided | net | workspace |
|---|---|---|---|---|---|
| session-de86a1… | 820 | 1,519,132c | 0c | -1,519,132c | dsh-loom |
| session-c0c6f9… | 160 | 339,571c | 0c | -339,571c | Kototoro |
| b6ded7c9-6408-… | 1 | 742c | 0c | -742c | Kototoro |
| 03760170-ce43-… | 2 | 2,780c | 0c | -2,780c | Kototoro |
| session-0fff53… | 70 | 118,833c | 0c | -118,833c | dsh-loom |
| session-24dcd6… | 1,883 | 3,869,898c | 0c | -3,869,898c | Kototoro |

> 口径：token = chars/4（与 GUI 一致）；rewrites 罚金 = 前缀字符 ×（1 − cacheDiscount），默认 0.1。
> 未测即未测——不猜。G5 需要运行中的宿主（`--api`），G7 需要 `npm run bench:ledger` + `--g7 <pct>`，
> G6 需要配对实验：`npm run quality:ab -- run …`（协议见 docs/G6-quality-ab.zh.md，< 10 对配对一律报未测）。
> G1 的分母是「有节省机会」的会话（`prunedChars + compactedChars > 0`）：没有任何剪枝/压缩的会话结构上必为负，
> 把它们算进分母测的是激活率而不是收益。机会会话 < 5 时只报数值、不给判定：一个会话不是分布。
> 绝对值说明：injected 按名义价逐请求记，而宿主前缀缓存实际约 10% 付费；
> 两侧同比例缩放不改变 net 的**正负号**（G1 判的就是符号），所以门不受影响，但「节省 token」的绝对量偏悲观。
