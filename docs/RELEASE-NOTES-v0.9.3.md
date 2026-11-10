# dsh-engram v0.9.3

**两条「用户第一次跑就撞上、而仓库里所有测试都绿」的缝。修法都不在产品代码里：一条在 `files[]`，一条在一句日志。**

这两条是 issue #9 里承诺「单独处理」的尾巴，与 0.9.1 修的两个 bug 同一族——
**工作区里是对的，装出来是错的**。0.9.1 那条缝开在 Windows 的键上，这两条开在发布包与文案上：
代码路径都没错，所以跑得最快的那批测试（也是 CI 里最靠前的那批）永远看不见它们。

## 修复

### 1. `npm run eval` 在安装包里跑不起来（issue #9 遗留 ①）

`scripts.eval` 指向 `eval/recall-bench.mjs`，而 `files[]` 只放行 `eval/gate-audit.mjs`：
装好的包里照 README 跑 `npm run eval` 就是 `MODULE_NOT_FOUND`（在已发布的 0.9.2 tarball 里核实过）。
报障者先发现了它——对一个正在查召回质量的人来说，这是最不该坏的一条命令。

根因不是逻辑，是**发布门没有覆盖 `eval/`**：`prepublishOnly` 从装好的 tarball 里 import host 与
client bundle，两条路径都在 `lib/`，`eval/` 不经过任何门。

改法三层，一层比一层硬：

- **随包发**：四个自包含（只 import `lib/`）的评测脚本进 `files[]` —— `recall-bench`（`npm run eval`）、
  `ledger-bench`、`playbook-audit`、`skill-export-check`，与既有 `gate-audit` 并列。
- **形状锁** `test/packaging.test.mjs`：每个 `scripts.*` 项必须被显式分类——
  要么它跑的文件确实随包发，要么它被写进 `SOURCE_ONLY` 白名单（`build:client` / `typecheck` / `test` /
  `i18n:*` / `quality:ab`，最后这条依赖 5.5 MB 的 `eval/g6` 实验语料）。新加一条 script 又忘了打包，
  测试直接红；白名单里留一条已删除的 script 也红。
- **真凭据**：`scripts/prepublish-check.mjs` 第 5 步在**装好的 artifact** 里跑一次 `npm run eval`，
  要求出现 `BENCH PASS`。形状断言能在合并前拦住犯错的提交，这一步才拦得住「文件在、但跑不起来」。

### 2. `status` 在没那个文件时点名它（issue #9 遗留 ②）

原文案走 else 分支时断言「旧版组合文件（`agent.cordis.yml`，DSH ≤ 0.1.x）」，而进入该分支的全部依据
只是「扫到的预设里没有 `*.patch.yml`」。`COMPOSITION_NAMES` 有两种合法名（`agent.cordis.yml` 与
`agent.json`），报障机器的旧版根里一个都没有——提示里那个文件名是**推断出来的**。

现在只报读到的：

```
预设布局：没有发现声明式预设（*.patch.yml），按 DSH ≤ 0.1.x 布局处理；实际读到 agent.json
```

回归测试用一个只放 `agent.json` 的 legacy root 钉住两件事：这句话出现，且整段输出里**不出现**
`agent.cordis.yml`。

## 没变的

- 产品行为、配置键、数据格式、GUI、宿主注入面：全部不动。`lib/client.js` 仍是 425 128 B。
- `eval/g6`（5.5 MB 实验语料）与三个写死绝对路径的边界仿真脚本仍不随包发——它们是实验台工具，
  在 `SOURCE_ONLY` 与 `files[]` 两处都写明了理由。

## DSH 版本支持

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **peer 声明**：
  - `@deepseek-ai/dsh-compaction`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-compaction-basic`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-llm`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-settings`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-storage-domain`: `>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh 0.2.1-rc.2`（本机 CLI + web）
- **最后验证日期**：2026-11-10
- **安装方式已验证**：`dsh plugin --profile <name> add <tgz|dsh-engram>`

## 验证

```
npm test          → 540 tests, 538 pass
                    （2 个失败仅 test/g6-sandbox.test.mjs：需要 OS 级 fence，本机不可用，
                      父提交上同样失败）
npm run prepublishOnly → packed tarball 里 host(7 exports) + client bundle(425128 B) import OK，
                         且 eval/recall-bench.mjs 在**装好的包**里跑通（BENCH PASS）
npm pack          → 517.0 kB / 101 files（0.9.2 是 504.3 kB / 97 files）
git stash 反证      → 撤掉本版两处改动后，两条新测试各自变红（cli 文案 1 条 + packaging 2 条）
```

## 关掉 issue #9 还缺什么

不在这版里：需要报障者在 Windows + DSH ≥ 0.9.1 上确认 `[ENGRAM]` / `[ESR]` / `[RESUME]` 三块都回来了
（`42a9552` 的错键修复）。拿到那句确认后 #9 即可关闭，这一版只是把它尾巴上两条已知项清干净。
