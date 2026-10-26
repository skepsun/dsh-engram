# 门审计（gate audit）· 2026-10-26

窗口：最近 14 天 · 扫描 46 个会话（其中 35 个挂载了工具）· 账本行 7 条

| 门 | 指标 | 实测 | 目标 | 判定 | 备注 |
|---|---|---|---|---|---|
| G1 | NetTokens · 净收益 > 0 的会话占比（有节省机会的会话） | 100.0% | ≥ 50% | **未测** | 2/2 opportunity rows of 7 — need ≥ 5 for a distribution |
| G1b | NetTokens · 长会话（≥200 请求）占比 | 100.0% | ≥ 70% | **未测** | 1/1 long opportunity sessions |
| G2 | Activation · 机制激活率（挂载会话 fire ≥1 次） | 77.1% | ≥ 60% | **PASS** | 27/35 mounted sessions |
| G2b | Push · [RECALL] 注入命中会话占比 | 20.0% | 观测项（无预声明门） | **—** | 7/35 sessions carry a [RECALL] block in their prompt |
| G3 | DrillRate · detail / recall-with-hits | 0.07 | 观测项（推送是否被采纳） | **—** | 3 detail / 45 recall-with-hits |
| G4 | StaleRate · 被 supersede 的行占比 | 0.0% | < 1% | **PASS** | 0/380 memories (12 tagged stale) |
| G5 | 索引 ≤ 700 chars | 681c | ≤ 700c | **PASS** | /Users/sunchuxiong/dsh-loom · 106 memories · 6 lines |
| G6 | Quality Δ · 配对任务成功率差 | 未测 | ≤ 2pp | **未测** | needs paired A/B runs (not derivable from logs) |
| G7 | 账本自身开销 | 0.2137% | < 0.5% 请求时延 | **PASS** | from `npm run bench:ledger` (worst op vs a 300ms request floor) |

## 账本合计

- injected 9,943,344c（≈2,485,836 tok）· avoided 1,480,967,187c（≈370,241,797 tok）
- rewrites 17 次 / 4,024,426c（按 cacheDiscount 计罚 3,621,983c）
- **net 1,467,401,860c ≈ 366,850,465 tok**；开源会话 7 条，其中净收益为正 2 条

## 最近会话（按会话落行）

| session | requests | injected | avoided | net | workspace |
|---|---|---|---|---|---|
| session-746c03… | 624 | 1,286,964c | 25,007,097c | 23,435,269c | dsh-loom |
| session-419cfc… | 61 | 168,927c | 0c | -168,927c | kototoro-parsers |
| 91e9c39a-2231-… | 66 | 179,382c | 286,224c | 106,842c | kototoro-parsers |
| session-775f51… | 220 | 609,289c | 0c | -1,711,542c | kototoro-parsers |
| session-71f597… | 140 | 392,295c | 0c | -392,295c | kototoro-parsers |
| session-ffbe89… | 120 | 361,254c | 0c | -361,254c | Kototoro |
| session-ed8929… | 260 | 775,040c | 0c | -775,040c | Kototoro |

> 口径：token = chars/4（与 GUI 一致）；rewrites 罚金 = 前缀字符 ×（1 − cacheDiscount），默认 0.1。
> 未测即未测——不猜。G5 需要运行中的宿主（`--api`），G7 需要 `npm run bench:ledger` + `--g7 <pct>`，
> G6 需要配对实验：`npm run quality:ab -- run …`（协议见 docs/G6-quality-ab.zh.md，< 10 对配对一律报未测）。
> G1 的分母是「有节省机会」的会话（`prunedChars + compactedChars > 0`）：没有任何剪枝/压缩的会话结构上必为负，
> 把它们算进分母测的是激活率而不是收益。机会会话 < 5 时只报数值、不给判定：一个会话不是分布。
> 绝对值说明：injected 按名义价逐请求记，而宿主前缀缓存实际约 10% 付费；
> 两侧同比例缩放不改变 net 的**正负号**（G1 判的就是符号），所以门不受影响，但「节省 token」的绝对量偏悲观。
