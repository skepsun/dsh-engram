## dsh-engram v0.6.0

自 v0.5.1 以来：从「记忆插件」转向**上下文投资组合**——先把省 token 变成可审计的账本，
再用账本纠正默认值、否决不划算的剪枝，并按确定性事件把记忆推给模型。

### 功能

- **Context Ledger（上下文净收益账本）** — 每个模型请求记一次账：
  `net = avoided − injected − rewriteChars × (1 − cacheDiscount)`。
  注入的 `[ENGRAM]`/`[RECALL]`/`[ESR]`/`[JIT]` 块按存活请求计成本；BoundaryPrune 剪掉的
  结果按后续请求计节省；每次剪枝/推送按前缀重写计价（默认缓存折价 0.1）。
  `GET /api/dsh-engram/stats` 与 `/overview` 返回 `ledger`（totals / byWorkspace / byDay），
  落盘 `~/.dsh/engram/ledger.json`（原子写、按天滚动、delta flush）。
  设置键：`ledgerEnabled`（默认开）、`ledgerCacheDiscount`（默认 0.1）。
- **GUI 账本可视化** — 遥测页新增「Context Ledger · 上下文净收益」面板（净 token 大数字、
  节省/注入/重写罚金三卡、近 14 天红绿柱、JIT 推送次数）；记忆概览新增「上下文净 token」卡。
- **BoundaryPrune 默认开 + 账本否决** — `boundaryPrune` 默认 `true`、`resultPack` 默认 `true`
  （默认剪枝由归档兜底、无损）；新增 `boundaryPruneAdaptive`（默认开）：某 workspace 真实剪枝
  后净收益为负且 ≥3 次时，账本自动否决后续剪枝（fail-open，日志一行）。
- **JIT 推送（v0.6-C）** — 三类确定性事件，命中已有记忆/任务才推，append-only、每会话 ≤3 行、
  每行 ≤220 字符、无命中沉默：错误复发（同 `cmd:` 第 2 次失败 + 已有 error/procedure）、
  文件焦点（同文件连续第 2 次编辑 + filePath/dir 锚定记忆）、goal 完成（有 active ESR 任务）。
  新增 `[JIT]` section（order 40.75）、`/stats.jit` 计数、`jitEnabled` 开关。
- **设置卡** — 新增「剪枝自适应」「JIT 推送」两个开关。

### 破坏性变更（默认值纠偏）

| 键 | v0.5.1 | v0.6.0 |
|---|---|---|
| `boundaryPrune` | `false` | **`true`** |
| `boundaryPruneAdaptive` | — | **`true`** |
| `resultPack` | `false` | **`true`** |
| `gcReplacesCompaction` | `true` | **`false`**（opt-in） |
| `autoWebCompaction` | `true` | **`false`**（opt-in） |

- 默认剪枝现在**开启**，但被剪中段默认归档到 `resultpack/`（7 天），可用
  `result_recall(callId)` 召回。要回到纯记忆模式：`boundaryPrune:false`（或
  `resultPack:false` 接受不可召回）。
- Context GC 接管改为 **opt-in**。已接管的 web 预设保持 wired，但默认挂宿主
  `BasicCompactionEngine`（DSH 自己的 LLM 摘要），除非显式打开
  `gcReplacesCompaction:true`（web 还需 `autoWebCompaction:true`）。
- 升级后需重启 `dsh web`；账本从下一次会话开始累计。

### 其他

- 测试 **359/359**（新增 ledger 13 例、jit 9 例、adaptive gate 4 例、settings/API/client 渲染用例）；
  `npm run eval` BENCH PASS；`npm run typecheck` 通过；`lib/client.js` 重建。
- 文档：`docs/PROPOSAL-evolution.zh.md`（演进提案）、中英 README、`docs/CONTEXT-GC-GUIDE.zh.md`
  （Context GC 改为 opt-in 的 4 步启用）。
- 真实实例冒烟（`dsh 0.2.0-rc.2`，临时将 profile 的 `dsh-engram` 指向工作树后还原）：
  `/overview` 返回 `ledger`、`/stats` 返回 `jit`，defaults 与上表一致，`compaction.host = default`。

## DSH 版本支持

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **peer 声明**：
  - `@deepseek-ai/dsh-compaction`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-compaction-basic`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-llm`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-settings`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-storage-domain`: `>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh 0.2.0-rc.2`
- **最后验证日期**：2026-10-19
- **安装方式已验证**：`dsh plugin --profile web add dsh-engram`
