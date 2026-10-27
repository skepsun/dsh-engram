# dsh-engram v0.8.7

**「特性睡着了」这件事，现在有离线证据可查；顺手拆掉一句永远不会兑现的状态承诺。**

0.8.6 修了 issue #9 的**能力**问题（宿主不暴露批量读接口时退回 `seq`+`eventAt`）。
这一版补的是**可观测**问题：就算下一次再遇到同类宿主，也不该有人靠解 zstd 帧
才能证明「不是还没触发，是根本不会触发」。

## 新增：推送腿（push legs）有了落盘证据

`[RECALL]`、会话 episode、`[RESUME]` 简报、会话结束的 todo sink —— 这四件事共享
同一个前提：会话事件日志可读。它们一起醒，也一起睡。

以前这里只有一个 `warn`，打在一个没人留着的终端上。现在每个会话装配时，插件把
**实际走了哪条读法**追加进 `$DSH_HOME/engram/push-legs.jsonl`（有界：超 32 KB 只留尾 50 行）：

```json
{"at":1793086321920,"pid":59392,"sessionId":"session-…","source":"sessionQuery"}
```

`source` 就是 `sessionEventsSource()` 的裁决：`legacy` / `sessionQuery` /
`snapshotEvents` / `eventAt` / `none`。

`dsh-engram status` 多一行：

```
推送腿：事件日志读法 sessionQuery · 最近 2026/10/27 15:32:01 · sessionQuery×3 · eventAt×1
推送腿：⚠ 事件日志不可读（none）—— [RECALL]/episode/resume/todo-sink 休眠中 · 2026/10/27 15:32:01 · none×1
```

第二条就是 issue #9 那台机器的样子——不用开日志、不用解帧，一眼能看出是休眠还是没触发。

## 修复：`minimal` 预设的状态行在撒谎

`dsh-engram status` 对未接管的预设一直打印「出厂布局，重启 dsh web 后自动接管」。
但 DSH 0.2.1-rc.2 的 `minimal.patch.yml` 里 compaction 组**缺 `tool-result-pruner` 行**，
换行不变量（要标准形状）不成立，`swapCompactionRow` 返回 `null`，boot 时记的是
`skipped / layout-mismatch`——那句承诺永远不会兑现，重启多少次都是 `stock`。

现在对 `stock` 再做一次换行探测，换不动就直说：

```
minimal: stock — 出厂布局但与标准形状不同（行不全），自动接管不会发生；要 Context GC 请手工接线或改用 standard
```

## 证据

- `npm test` **488/488**（+5：push-legs 落盘、最新裁决、休眠措辞、有界重写、坏文件不抛）
- `npm run typecheck` 通过；`prepublishOnly` 真实 tarball + peers 装上后 host/client 双入口导入通过
- 本机 0.8.6 实机取证：状态快照 `pid 59392`（15:31:47 写入）→ `recall-injections.json`
  的 `lastInjection` 为 **15:32:01**，即重启后 14 秒推送腿真的动了

## 升级后请做的一件事（如果你在 issue #9 里报过障）

```sh
npx dsh-engram status
```

把「推送腿」那一行贴回 issue。如果它写 `none`，说明桌面运行时的 Session 连
`eventAt` 都不给，那才需要走「直接读 `session.v4.jsonl.zstd`」这条重路子
（Node 22 无内置 zstd，要引依赖）；如果写 `eventAt` 或 `sessionQuery`，说明已经修好。

## DSH 版本支持（必填）

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh 0.2.1-rc.2`（本机 CLI + web）
- **最后验证日期**：2026-10-27
- **安装方式已验证**：`prepublishOnly` 用真实 tarball 装 peers 后导入 host/client 双入口
- **peer 声明**：`@deepseek-ai/dsh-{settings,storage-domain,compaction,compaction-basic,llm}@>=0.1.2-alpha.2 <0.3.0-0`、`@deepseek-ai/cordis@^4.0.2`、`@deepseek-ai/schemastery@^3.18.2`
