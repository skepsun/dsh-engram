# 门审计（gate audit）· 2026-10-22

窗口：最近 14 天 · 扫描 42 个会话（其中 31 个挂载了工具）· 账本行 3 条

| 门 | 指标 | 实测 | 目标 | 判定 | 备注 |
|---|---|---|---|---|---|
| G1 | NetTokens · 净收益 > 0 的会话占比 | 33.3% | ≥ 50% | **未测** | 1/3 rows — need ≥ 5 flushed sessions for a distribution |
| G1b | NetTokens · 长会话（≥200 请求）占比 | 50.0% | ≥ 70% | **未测** | 1/2 long sessions |
| G2 | Activation · 机制激活率（挂载会话 fire ≥1 次） | 77.4% | ≥ 60% | **PASS** | 24/31 mounted sessions |
| G2b | Push · [RECALL] 注入命中会话占比 | 9.7% | 观测项（无预声明门） | **—** | 3/31 sessions carry a [RECALL] block in their prompt |
| G3 | DrillRate · detail / recall-with-hits | 0.08 | 观测项（推送是否被采纳） | **—** | 3 detail / 39 recall-with-hits |
| G4 | StaleRate · 被 supersede 的行占比 | 0.0% | < 1% | **PASS** | 0/351 memories (8 tagged stale) |
| G5 | 索引 ≤ 700 chars | 646c | ≤ 700c | **PASS** | /Users/sunchuxiong/dsh-loom · 85 memories · 6 lines |
| G6 | Quality Δ · 配对任务成功率差 | 未测 | ≤ 2pp | **未测** | needs paired A/B runs (not derivable from logs) |
| G7 | 账本自身开销 | 未测 | < 0.5% 请求时延 | **未测** | in-memory accumulation; needs a timed benchmark |

## 账本合计

- injected 7,682,995c（≈1,920,749 tok）· avoided 1,463,469,816c（≈365,867,454 tok）
- rewrites 11 次 / 2,483,185c（按 cacheDiscount 计罚 2,234,867c）
- **net 1,453,551,954c ≈ 363,387,989 tok**；开源会话 3 条，其中净收益为正 1 条

## 最近会话（按会话落行）

| session | requests | injected | avoided | net | workspace |
|---|---|---|---|---|---|
| session-746c03… | 200 | 376,508c | 7,795,950c | 7,419,442c | dsh-loom |
| session-ffbe89… | 120 | 361,254c | 0c | -361,254c | Kototoro |
| session-ed8929… | 260 | 775,040c | 0c | -775,040c | Kototoro |

> 口径：token = chars/4（与 GUI 一致）；rewrites 罚金 = 前缀字符 ×（1 − cacheDiscount），默认 0.1。
> 未测即未测——不猜。G5 需要运行中的宿主（`--api`），G6/G7 需要配对实验。
> G1 在行数 < 5 时只报数值、不给判定：一个会话不是分布。
> 绝对值说明：injected 按名义价逐请求记，而宿主前缀缓存实际约 10% 付费；
> 两侧同比例缩放不改变 net 的**正负号**（G1 判的就是符号），所以门不受影响，但「节省 token」的绝对量偏悲观。
