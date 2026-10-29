# dsh-engram v0.9.0

**这一版几乎没改产品代码，改的是「我们凭什么说自己有用」——评测从「跑得动」变成了「作弊不了」。**

从 `0.8.8` 到这里共 22 个 commit，`lib/` 一行未动，唯一的用户可见改动是 CLI 的一处
preset 扫描优先级。剩下的全部落在 `eval/`、`test/` 和 `docs/`：把上一版还只能"声称"的
东西变成能复现的读数。

## 修复

- **`web-compaction` 的 preset 扫描不再被陈旧的 legacy 目录抢占**：`--presets-dir`
  现在优先于一切。此前一个更早的 checkout 留在机器上时，它会先认领 preset id，
  声明式 patch 文件按 id 被去重掉，于是 `status` 报的是 legacy 布局、
  而声明式那份被显示成 `custom`。三条 Linux CLI 测试抓到了这个组合
  （`scripts/dsh-engram.mjs`）。

## 评测基础设施（本版真正的内容）

- **G6 有了网络围栏**（`--sandbox --net-fence --net-endpoint host:port`）：
  bwrap 搭挂载树 → `setpriv` 掉到专用 uid → 三条按 uid 生效的 iptables 规则，
  默认 REJECT，只放行 loopback 和一个模型端点。按 uid 而不是按进程过滤，
  所以开发会话、harness、Web GUI 的网络不受影响。
  跑矩阵前有两个自证，不通过就不计分：出网探针（端点可达 / `github 000` / DNS 死）
  和写目录探针（臂必须能在自己的 workspace 里落盘）。
- **第九轮结果**：9 任务 × 2 seed × 2 臂，p-a 18/18 vs p-b 0/18，Δ **+100.0pp**，
  18 对配对，`infraRows 0`，`contaminated 0`（`eval/g6/runs/r9-net/`）。
  18 份控制日志里有 4 份试图出网，全部拿到 `exit 124` / "network unavailable"——
  这是第七轮「控制臂去 GitHub 查到答案」的反面。
- **语料第 4 条自证**：工作区 stub 必须导出 prompt 点名的函数，参数个数必须与 prompt 一致
  （oracle 可以少传、不能多传）。这条当场抓出三处不一致：`retry` 的 stub 签的是
  `shouldRetry(status, code, attempt)`、`ranking`/`dedupe` 的 stub 导出名 prompt 从未提过。
  一份靠"猜哪份文档算数"得来的通过不是证据。
- **污染判定改为三分类**（`classifyLeak` → `memory` / `artifact` / `network`），
  并提供 `quality-ab.mjs classify` 从既有日志**重算**：围栏下"试过出网"不再等于"拿到了"。
- **G7 从「未测」变成实测**：账本自身开销最坏操作 **0.2956%**（闸门 < 0.5%），
  1123 条真实 step 延迟，`npm run bench:ledger` 可复现。

## 其他

- 证据面汇总见 `docs/GATES.zh.md`：G2 激活率 83.3% PASS · G4 陈旧率 0.0% PASS ·
  G6 Δ +100pp PASS · G7 0.2956% PASS · G1/G1b/G5 仍未测（未测即未测，不猜）。
- G6 方法、十二道缝与失效模式见 `docs/G6-quality-ab.zh.md` §16。

## 这一版**不是** 1.0，也请不要这样读

`0.9.0` 表示"证据链条够了"，不表示"公共面稳定了"。三条至少还挡在 1.0 前面：

1. **宿主还是 rc**（peer `>=0.1.2-alpha.2 <0.3.0-0`，本机 `dsh 0.2.1-rc.2`）：
   1.0 承诺"不无故破坏"，在 rc 宿主上做不到。
2. **旗舰收益未测**：账本 `avoided 0c`、净 **−1.46M token**、G1 未测——
   因为省钱的两条路（`boundaryPrune`、`gcReplacesCompaction`）默认关闭。
   一次开着的实测周（≥5 个 opportunity 会话）才能让 G1 第一次有读数。
3. **减法债**：14 个工具（目标 ≤10）、70 个配置键（面向用户目标 ≤12）、
   client bundle 291KB（目标 <150KB）；存储格式仍无 schemaVersion/迁移。

## DSH 版本支持

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **peer 声明**：
  - `@deepseek-ai/dsh-compaction`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-compaction-basic`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-llm`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-settings`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-storage-domain`: `>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh 0.2.1-rc.2`（本机 CLI + web）
- **最后验证日期**：2026-10-29
- **安装方式已验证**：`dsh plugin --profile web add <path|dsh-engram>`
- **兼容性**：配置键与数据格式与 `0.8.8` 完全一致，**无需迁移**；无破坏性改动。

## 验证

```
npm test        → 519/519
npm run typecheck → ok
npm run eval    → BENCH PASS
npm run build:client → 无 diff（bundle 新鲜）
npm pack        → 459KB / 94 files
```
