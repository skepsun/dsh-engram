# dsh-engram v0.9.4

**两条 CI 全绿的缝，都开在我们并不拥有的环境里：一次扫描越过了仓库边界，一次注入越过了元素边界。**

两次都不是产品逻辑算错，是**推断走得太远**——把「猜到的兄弟目录」当成自己的预设根，把「别人的兄弟节点」当成自己的孩子。修法也是同一个方向：把猜换成声明，或者换成结构上不可能出错的不变量。

## 修复

### 1. `npm test` 会写进兄弟 checkout

`legacyPresetRoots()` 猜两个根，其中一个写死成兄弟目录
`<repo>/../deepseek-harness/apps/cli/config/agent-presets`。而 `--presets-dir` 与
`DSH_WEB_PRESETS_DIR` 只约束**声明式**那一代扫描：调用者无论怎么说，都关不掉 legacy 扫描——
偏偏 `enable` / `revert` 是**写**的。

在一台有兄弟 checkout 的开发机上实测到的代价：

- `test/cli.test.mjs` 红。沙箱里只有 `agent.json`，`status` 却报「实际读到 agent.cordis.yml / agent.json」，
  两条断言（含 `doesNotMatch /agent\.cordis\.yml/`）同时失效——`539/540`，看起来像提交坏了，
  其实是这台机器多了一个目录。把同一棵树 `git archive` 到空目录再跑就是 9/9。
- 更糟的是 enable/revert 测试**摸到了真实文件**：沙箱里报
  `write failed for preset "code" (EROFS …/deepseek-harness/apps/cli/config/agent-presets/code/agent.cordis.yml)`。
  这台机器上围栏挡住了；换台普通开发机，`npm test` 会把另一个仓库的两个预设文件改写掉。

改法：`DSH_ENGRAM_LEGACY_PRESET_ROOTS`（路径分隔，`""` = 一个都不要）。**设了**——哪怕是空串——
它就是全部真相，不再猜任何默认；**没设**才沿用今天的默认，所以普通开发机行为一字不变。
测试沙箱现在同时约束两代扫描，并在猜测会落到的位置（`$DSH_HOME/.agent-presets`）种了金丝雀：
口径一旦被删，套件立刻红，而不是等下一台机器替我们发现。

文档：`README.md`、`README.zh.md`、`docs/CONTEXT-GC-GUIDE.zh.md`（CLI 旋钮表）。

### 2. 侧栏「ESR 看板」入口在 0.2.2-rc.3 消失，并刷 500+ 条异常（issue #14）

`placeEntry` 先算锚点（兄弟家族块 → `logoRow` → 新会话按钮），再把**那个锚点的 `nextSibling`**
交给 `insertBefore`。rc.3 把按钮挪进嵌套块之后，它的 `nextSibling` 属于另一个父节点，DOM 直接抛
`NotFoundError`；而这段代码跑在 `MutationObserver` 里，于是每次 DOM 变动都重抛一次——一次会话
500+ 条未捕获异常，`entryPlaced` 永远置不上，入口也就永远插不进去。

改法不是补一个 `appendChild` 兜底，而是把位置判断换成结构不变量：锚点解析为**侧栏根的直系子节点**
（兄弟家族块优先，否则「包含新会话按钮的那个直系块」），于是 `anchor.nextSibling` 按构造必然是根的
孩子或 `null`。本来能正常显示的布局（`logoRow` 是直系子节点、按钮在它里面）解析出**同一个**锚点，
位置不变；只有本来会抛的形状才换行为。

同时把 `EngramBoardMount` 开头一直写着的 `DOM problems log, never throw` 真正落实：放置失败被捕获、
只 warn 一次，重试继续但静默——猜错壳层结构不再能变成报错风暴。

判断逻辑提到 `client/src/sidebarEntry.ts`（无 React、无 import），由 `test/sidebar-entry.test.mjs`
直接驱动：桩树实现两条关键 DOM 规则（`nextSibling` 跟随父节点的子列表、`insertBefore` 遇外来节点抛
`NotFoundError`）。把锚点改回旧写法，报障的形状会以**与报告一字不差的错误**失败；恢复后 7/7。

## 验证

```
npm test            → 548/548（0.9.3 是 540/540；+8：cli 口径 1 条 + 侧栏入口 7 条）
typecheck           → ok
build:client        → lib/client.js 425 471 B，连跑两次 sha256 相同
prepublishOnly      → 装好的 0.9.4 tarball 里 host 入口、client bundle、eval/recall-bench.mjs 三条路径都跑通
npm pack            → 522.0 kB / 103 files（0.9.3 是 517.0 kB / 101 files）
变异核对            → 撤掉 legacy 口径的环境变量读取 → 新增断言红；锚点改回 base.nextSibling → 以报告原文的错误红
```

## 没变的

- 数据格式、配置键、GUI 布局、宿主注入面：全部不动。`lib/client.js` 425 128 B → 425 471 B
  （只有入口放置那一段）。
- 不设 `DSH_ENGRAM_LEGACY_PRESET_ROOTS` 时，扫描口径与 0.9.3 完全一致。
- 侧栏入口在本来正常的布局上位置不变——这版只改「会抛」那几种形状。

## 关掉 issue 还缺什么

- **#14**：需要报障者在装上本版后确认「侧栏入口出现 + 控制台不再刷 `insertBefore` 异常」。
  正式方案（可注册 / 可 Pin 的侧栏入口）仍不在本版：那需要宿主给出挂载点，插件不该继续猜 DOM。
- **#9**：需要报障者在 Windows + DSH ≥ 0.9.1 上确认 `[ENGRAM]` / `[ESR]` / `[RESUME]` 三块都回来了
  （`42a9552` 的错键修复）。0.9.3 清掉的是它尾巴上两条，不是主体那两条。

## DSH 版本支持

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **peer 声明**：
  - `@deepseek-ai/dsh-compaction`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-compaction-basic`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-llm`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-settings`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-storage-domain`: `>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh 0.2.2-rc.1`（本地 checkout）＋ DSH 0.2.2-rc.3 报障环境的 DOM 形状（桩树复现）
- **最后验证日期**：2026-11-16
- **安装方式已验证**：`dsh plugin --profile web add dsh-engram`
