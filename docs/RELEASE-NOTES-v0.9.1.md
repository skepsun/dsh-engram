# dsh-engram v0.9.1

**两个「自己说自己活着」的部件：一个在 Windows 上从第一次启动起就没亮过，一个接管了
本机 compaction 却一次也没压缩过。**

从 `v0.9.0` 到这里只有两个 commit，修的是同一类故障——**状态面显示正常，功能面从未发生**。
这类故障单测抓不到，因为它不是逻辑错了，而是两个面用的键、或者两个面用的上下文不一致：
写的时候用了一套，读/挂的时候用了另一套。两次都是先有人在真实环境里看见「那个东西没出现」，
才回头找到这条缝。

## 修复

### 1. `[ENGRAM]` 块在 Windows 上恒为空（issue #10）

`blockFor` / `esrBlockFor` 用裸 `path.resolve(cwd)` 推会话工作区，而所有写入路径——以及
渲染调用下面两行的账本——用的是 `workspaceKey()`。win32 上写入端会把整个 key 小写
（盘符默认大写），于是原始 key 匹配到 0 行：`[ENGRAM]` 渲染成空串，`sessionCache` 再把
空串冻住整场会话，看起来像「记忆库是空的」。

`[RESUME]` 与 `[ESR]` 快照/冻结块是同一个第二 key 派生，一起修。三处调用点现在共用
`wk(cwd)`，`lib/index.js` 不再 import `node:path`——没有第二条派生路可走。
`test/workspace-key.test.mjs` 不依赖 Windows 主机也能复现这对键，另外用源码不变量把调用点
锁住。

### 2. 宿主面 compaction 引擎从未真正挂上（issues #12 / #13）

`BasicCompactionEngine` 声明 `static inject = ["llm", "tokenMeter", "sessions"]`，但
`static inject` 只有被 loader **当插件加载**时才转成供给好的依赖图。`mountCompactionEngine`
用的是 `new Engine(ctx)`，而且这个 `ctx` 来自 engram 自己那条 `inject = ["tools"]` 的 fiber，
于是 `compactIfNeeded()` 的第一句 `this.ctx.tokenMeter` 直接从 ctx 代理里抛
`cannot get property "tokenMeter" without inject`——可选链救不了，getter 本身在抛。

两个后端把同一条错误吞成了两种表情：

- 注册 `agent/request(prepend)` 的后端 → 错误冒到模型切换上，界面提示
  "select a model with a larger context window"（误导，跟模型大小无关）；
- 在 `agent/pre-step` 里读的后端 → 被 catch 成 `step compaction failed … continuing the turn`，
  引擎挂着、`context-gc.status.json` 一直写着 `host: "context-gc"`、却从不压缩。

现在 `mountCompactionEngine` 改为 `ctx.plugin(Engine)`，两个子类都接
`constructor(engineCtx = ctx)`，loader 在引擎自己的 fiber 上供给三个服务；engram 自身仍只
inject `["tools"]`，minimal/headless profile 不因此多背依赖。

顺手处理的三个坑（都有测试钉住）：

- **`fiber.await()` 不是就绪信号**：inject 缺失时 fiber 从不启动，`await()` 立即 resolve
  且 resolve 的是 undefined。改成等引擎自身构造的回调；宿主永不供给服务时挂载保持 pending，
  `lib/index.js` 用 15s 上界把 `host: "unavailable"` 写进 status 并 warn 一行，不再静默。
- **重复 provider 必须在挂载前拦**（`ctx.get("compaction") !== undefined` → 抛）。否则 cordis
  从 fiber 内部拒绝并 `logger.error` 打栈，而「base 的 `compaction-basic` 行还启用着」本是
  设计内的情况，不是事故。
- **错误路径**：`MountedEngine` 里 `try { super() } catch (e) { settle.reject(e); throw e }`，
  否则构造失败会让挂载静默挂死（内部 `catch {}` 把异常吃了）。

## 这次怎么验的

单测跑的是真 cordis + 真 backend（`test/compaction-mount.test.mjs`，含两个反向对照：
一个断言 `compactIfNeeded()` 确实经注入的 meter 实测，一个保留 `new` 的做法仍复现原报错）。
但「真 backend」还不是「真宿主」，所以补了一次真机探针：

**做法** —— 把本仓库 `npm pack` 成 tarball，在 `/tmp` 里起一个一次性 `DSH_HOME`，用
`dsh --from-default-profile web` 造 profile，`dsh plugin --profile probe add <tgz>` 装上，
再用一份 overlay patch 插一个只做一件事的探针插件：启动 8 秒后调
`ctx.compaction.compactIfNeeded(agent, "pressure")`，把结果写进文件；`dsh --port 3199 web`
起真宿主，读文件。这套流程已固化成 `npm run host:probe`（`scripts/host-mount-probe.mjs`，
`--gc` 切 GC 模式、`--tgz <old.tgz>` 当对照；不联网、不调模型，退出码 0 = 通 / 1 = 引擎报错）——
下面这张表的每一行都能用一条命令重跑。

**读数**（`dsh 0.2.1-rc.2`，本机）：

| 装上的是 | `status.host` | `compactIfNeeded("pressure")` |
|---|---|---|
| 本版（fixed，默认配置） | `default` | `ok: true`，`null`（空会话无需压缩） |
| 本版（fixed，`gcReplacesCompaction: true`） | `context-gc` | `ok: true`，`null` |
| 父提交 `42a9552`（对照） | `default` | `ok: false` —— `cannot get property "tokenMeter" without inject` |

第三行是关键：同一套探针、同一个宿主，把插件换回父提交的 tarball，原报错原样复现。也就是说
前两行的绿不是「没测到那条路」，是那条路真的通了。

## 其他

- 贡献者 PR #11（客户端 i18n + 俄语目录，457 条）已在本机全量验证（合并无冲突、`build:client`
  与提交产物逐字节一致、527/525 只有本机 fence 失败），但**不在本版**：它改的是 `client/`，
  等 review 合并后再发。
- 配置键与数据格式与 `0.9.0` / `0.8.8` 完全一致，**无需迁移**。

## DSH 版本支持

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **peer 声明**：
  - `@deepseek-ai/dsh-compaction`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-compaction-basic`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-llm`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-settings`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-storage-domain`: `>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh 0.2.1-rc.2`（本机 CLI + web；宿主面 compaction 挂载另用一次性 profile 实测，
  见上）
- **最后验证日期**：2026-11-09
- **安装方式已验证**：`dsh plugin --profile <name> add <tgz|dsh-engram>`

## 验证

```
npm test          → 532 tests, 530 pass
                    （2 个失败仅 test/g6-sandbox.test.mjs：需要 OS 级 fence，本机没有，
                      父提交上同样失败）
npm run typecheck → ok
npm run build:client → 无 diff（bundle 新鲜）
npm run prepublishOnly → packed tarball 里 host + client bundle 双入口 import OK
npm pack          → 476.8 kB / 96 files（client bundle 298476 bytes）
npm run host:probe → exit 0（`--tgz <父提交 tarball>` 复跑：exit 1，原报错）
```
