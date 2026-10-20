## dsh-engram v0.7.1

自 v0.7.0 以来：**修复 DSH `0.2.0` 声明式预设下的 web 平面 Context GC 接管**。v0.7.0（及
更早）的自动装配以旧版 `agent.cordis.yml` 的布局为锚（`compaction-basic` 行固定 4 空格缩进），
而 `0.2.0` 把代理预设换成了 `@deepseek-ai/dsh-web-app/presets/<id>.patch.yml` 里的
`@deepseek-ai/dsh-agent-preset` 声明（行在 14/16/18 空格缩进）——结果是 **autoWebCompaction
静默跳过所有预设**，且旧的字符串替换不含行尾换行，极端情况下会半改写 stock 行。

### 修复

- **结构化定位 compaction 行** — 不再按缩进/整行字面量匹配：先找 YAML 结构里的
  `compaction` 组（带 `group: true` 的列表项），再在组内按 `- id:` **且** `name:` 双重校验
  定位 stock / engram 行，替换块继承该行自己的缩进。旧版组合文件（4 空格）与声明式补丁文件
  （14/16/18 空格）都逐字节往返一致（swap → restore 还原原件）。
- **声明式预设发现** — DSH `0.2.0` 的预设 roster 不再携带 `path`。插件把 roster 的每个 id
  映射到出厂的 `<presetsDir>/<id>.patch.yml`（经 dsh 安装解析，`DSH_WEB_PRESETS_DIR` 可覆盖），
  找不到出厂文件（= 用户自定义声明式预设 / profile patch 覆写）时跳过并打明确日志，不再当成故障。
- **删除一个潜在的半改写 bug** — stock 替换原用不含行尾的固定字符串，若文件恰好把
  `compaction-basic` 行与下一行同缩进紧挨着，替换会产生缺换行的坏文件；新实现按整块替换。
- **状态 / doctor CLI 适配两种布局** — `npx dsh-engram status|doctor` 自动发现旧版
  `agent.cordis.yml` 与声明式 `*.patch.yml`，显示检测到的布局；doctor 新增
  `autoWebCompaction=false`（opt-in 未打开，web 平面必然 no-op）、node_modules 预设（`npm update dsh`
  会恢复出厂布局，仅 autoWebCompaction 保持开启时下次启动自动重接管）、profile patch 里
  `preset-*` 覆写行（Web 编辑器保存的 `config.plugins` 优先于 shipped 文件）的三类提示。
  `enable` 手动重跑时镜像状态快照里记录的 `gcReplacesCompaction`/`gcNarrative`，不会把手动
  enable 的预设行翻成与设置卡不一致的开关。
- **状态快照不再假装「启动中」** — `autoWebCompaction=false` 时 web 平面记为 `disabled`
  （此前恒为 `pending`，`dsh-engram status` 会误显示「启动中（agentPresets 尚未就绪）」），
  CLI 增加「未启用（autoWebCompaction=false）」文案并保留 opt-in 警告，旧快照里遗留的
  `pending` 也会按快照记录的 `configSource` 归一化显示。

### 账本：节省不再是常量 0（净 token 恒负的根因）

遥测里「节省 · 剪枝/压缩」长期为 0、净 token 恒为负，是两条**入账腿同时断开**：

- **L1 边界剪枝在 0.2.0 web profile 下静默失效** — `dsh-web-app` 的 host 层把
  `tool-result-pruner` 行 `disabled: true` 并移进各 agent preset 的 isolate realm，
  host 平面的 engram 插件 `ctx.get("toolResultPruner")` 拿到 `undefined`，只打一行 warn
  就休眠。现在 bundle `cordis.patch.yml` 重新启用 host 行（预设域仍保留自己那份用于
  compaction 期剪枝），状态快照新增 `boundaryPrune: { armed, reason }`，CLI `status`
  会打印「L1 边界剪枝：已武装 / 未启用（原因）」，未武装时直接提示节省不会入账。
- **压缩节省从未接入** — Context GC 引擎现在在 checkpoint 提交前算
  `被替换区间可见字符数（含 tool-call 参数与嵌套 tool-result） − checkpoint 字符数`，
  经 `onCompacted` 回调交给账本 `noteCompaction`，按后续请求计入 `avoidedChars`（与剪枝同口径）。
  host 平面直连账本；web 预设域通过 host 插件提供的 `engramLedger` 普通服务桥接（隔离域里
  closure 不可达），全进程仍只有一个落盘写入者。回调失败被容器化，绝不影响压缩。

### 遥测口径更直白

- 卡片标签改成「节省 · 剪枝/压缩（已入账）」「注入成本 · 索引/召回/ESR（每请求重计）」；
- 当 `avoidedTokens === 0` 且已有注入/重写时，页签内直接解释：还没有剪枝/压缩节省入账、
  L1 需要 host 平面 pruner、净值为负 = 注入 + 重写罚金；
- README 中英两版与 `docs/CONTEXT-GC-GUIDE.zh.md` 的「口径诚实」段落更新（原文写
  「Context GC 的压缩节省暂未接入」）。

### 兼容性说明

- 纯**文件改写逻辑**修复，无存储 schema 变化、无新设置键（GUI 旋钮仍 34 个）。
- `autoWebCompaction` 仍是 opt-in（默认 `false`）：打开后**重启一次 `dsh web`**，下一次启动
  即把每个 stock 声明式预设接管（幂等；已手写的 engram 行会按请求的引擎配置刷新）。
- 已接管但位于 node_modules 的预设：`npm update dsh` 会恢复出厂布局，保持 autoWebCompaction
  开启时下次启动自动重新接管，否则手动 `npx dsh-engram enable`。

### 其他

- 测试 **405/405**（v0.7.1 共新增 24 例：15 例 web-provision/CLI——8 个 web-provision 例——声明式 stock/custom/双组拒绝、
  14 空格 swap+refresh+逐字节 restore、`--presets-dir` 发现、roster 无 path 的映射/跳过/扫描
  回退；7 个 CLI 集成例——沙箱 `DSH_HOME` + 声明式目录下 status/enable/revert/`--file`/
  `DSH_WEB_PRESETS_DIR` 发现/doctor opt-in 提示/未知命令退出码；另有 9 例账本修复——
  压缩入账滚动 1、`messagesTextChars` 1、`onCompacted` 上报 1、回调抛错不断压缩 1、
  预设域经 `engramLedger` 入账 1、无账本服务仍可压缩 1、`boundaryPruneAvailability` 3）；
  `npm test` 全绿。
- 文档：`docs/CONTEXT-GC-GUIDE.zh.md` 补两种预设布局说明、`.engram.bak` 命名、`--presets-dir`、
  两条排障条目；顺带修正指南第 6 节里 v0.6 起已改为 opt-in 但表格仍写默认 `true` 的笔误；
  README 兼容性矩阵新增 `0.7.1` 行。

## DSH 版本支持

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **peer 声明**：
  - `@deepseek-ai/dsh-compaction`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-compaction-basic`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-llm`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-settings`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-storage-domain`: `>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh 0.2.0-rc.2`（本机全局安装，`dsh-web-app/presets` 4 个预设实测）
- **最后验证日期**：2026-10-19
- **安装方式已验证**：`dsh plugin --profile web add dsh-engram`
