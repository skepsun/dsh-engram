# 门审计（gate audit）· 2026-10-26

窗口：最近 14 天 · 扫描 46 个会话（其中 35 个挂载了工具）· 账本行 7 条

| 门 | 指标 | 实测 | 目标 | 判定 | 备注 |
|---|---|---|---|---|---|
| G1 | NetTokens · 净收益 > 0 的会话占比（有节省机会的会话） | 100.0% | ≥ 50% | **未测** | 3/3 opportunity rows of 7 — need ≥ 5 for a distribution |
| G1b | NetTokens · 长会话（≥200 请求）占比 | 100.0% | ≥ 70% | **未测** | 2/2 long opportunity sessions |
| G2 | Activation · 机制激活率（挂载会话 fire ≥1 次） | 77.1% | ≥ 60% | **PASS** | 27/35 mounted sessions |
| G2b | Push · [RECALL] 注入命中会话占比 | 20.0% | 观测项（无预声明门） | **—** | 7/35 sessions carry a [RECALL] block in their prompt |
| G3 | DrillRate · detail / recall-with-hits | 0.07 | 观测项（推送是否被采纳） | **—** | 3 detail / 45 recall-with-hits |
| G4 | StaleRate · 被 supersede 的行占比 | 0.0% | < 1% | **PASS** | 0/406 memories (13 tagged stale) |
| G5 | 索引 ≤ 700 chars | 681c | ≤ 700c | **PASS** | /Users/sunchuxiong/dsh-loom · 119 memories · 6 lines |
| G6 | Quality Δ · 配对任务成功率差 | 90.0pp | Δ ≥ −2pp | **PASS** | 2026-10-28 · 4 任务 × 5 种子 · **20/20 对** · `eval/g6/runs/r6-local/runs.json`（本地 vLLM `deepseek-v4.1-flash-1017`）· 官方端点那次 13/20 对、+95.0pp 作独立复现留在 `r6-neutral`（7 行因余额不足标 `infra` 排除） |
| G7 | 账本自身开销 | 0.0236% | < 0.5% 请求时延 | **PASS** | `npm run bench:ledger`（本机 2026-10-28：最坏 op = p50 步长的 0.0236%，或 300ms 预算的 0.3022%） |

## 账本合计

- injected 11,589,492c（≈2,897,373 tok）· avoided 1,909,142,538c（≈477,285,635 tok）
- rewrites 17 次 / 4,024,426c（按 cacheDiscount 计罚 3,621,983c）
- **net 1,893,931,063c ≈ 473,482,766 tok**；开源会话 7 条，其中净收益为正 3 条

## 最近会话（按会话落行）

| session | requests | injected | avoided | net | workspace |
|---|---|---|---|---|---|
| session-746c03… | 1,084 | 2,168,304c | 310,174,822c | 307,721,654c | dsh-loom |
| session-419cfc… | 320 | 933,735c | 143,007,626c | 142,073,891c | kototoro-parsers |
| 91e9c39a-2231-… | 66 | 179,382c | 286,224c | 106,842c | kototoro-parsers |
| session-775f51… | 220 | 609,289c | 0c | -1,711,542c | kototoro-parsers |
| session-71f597… | 140 | 392,295c | 0c | -392,295c | kototoro-parsers |
| session-ffbe89… | 120 | 361,254c | 0c | -361,254c | Kototoro |
| session-ed8929… | 260 | 775,040c | 0c | -775,040c | Kototoro |

> **2026-10-28（Linux 接管）**：只有 G6 / G7 在本机重测过，其余行仍是 2026-10-26 那台机器的快照——
> 本机的会话历史只有 8 个，用 `--out` 整表重写会把有证据的行降级成"未测"。G6 的围栏机制已从
> macOS seatbelt 换成 Linux bubblewrap（同契约、两套实现，见 `docs/G6-quality-ab.zh.md` §13.6），
> 因此这一轮的 Δ **不能**与第五轮的 +90pp 直接比同（插件版本 0.8.2 → 0.8.8，语料 `check` 也换了可移植写法）。
>
> 口径：token = chars/4（与 GUI 一致）；rewrites 罚金 = 前缀字符 ×（1 − cacheDiscount），默认 0.1。
> 未测即未测——不猜。G5 需要运行中的宿主（`--api`），G7 需要 `npm run bench:ledger` + `--g7 <pct>`，
> G6 需要配对实验：`npm run quality:ab -- run …`（协议见 docs/G6-quality-ab.zh.md，< 10 对配对一律报未测）。
> G1 的分母是「有节省机会」的会话（`prunedChars + compactedChars > 0`）：没有任何剪枝/压缩的会话结构上必为负，
> 把它们算进分母测的是激活率而不是收益。机会会话 < 5 时只报数值、不给判定：一个会话不是分布。
> 绝对值说明：injected 按名义价逐请求记，而宿主前缀缓存实际约 10% 付费；
> 两侧同比例缩放不改变 net 的**正负号**（G1 判的就是符号），所以门不受影响，但「节省 token」的绝对量偏悲观。
