# dsh-engram v0.7.4

自 v0.7.3 以来：**修复「推送腿」在 DSH 0.2.x 上整条静默失效**。`[RECALL]` 启动召回、
会话 episode、`[RESUME]` 恢复简报、会话结束 todo 沉淀——四个 v0.6/v0.7 的招牌机制，
在真机上**一次都没有触发过**，而它们的单测全绿。

## 根因（宿主 API 漂移 + 静默归零，第二次）

DSH ≤0.1.x 把会话日志暴露成 `session.events`（一个冻结数组）。**DSH 0.2.x 删掉了这个
getter**——`Session.prototype` 现在只有 `eventAt` / `snapshotEvents` / `ownEvents` /
`deriveEventMessage`，宿主内部的同步全量读已被标记 deprecated，官方路径是
`ctx.sessionQuery.live(session)` 租约。

插件里 6 处 `Array.isArray(session.events)` 因此全部拿到 `[]`：

| 位置 | 后果 |
|---|---|
| `index-block.firstUserMessageText` | 取不到首条用户消息 → 查询串为空 → `[RECALL]` 永不渲染 |
| 同上（`pendingRecall` 分支） | 每轮都「等下一轮再试」→ `[ENGRAM]` 块**永不缓存**，每轮重渲染；注入体积也不进账本（净收益被高估） |
| `episode.buildEpisode` | 永远返回 `null` → 0 条 episode → `[RESUME]` 永不触发 |
| `todo-sink.pendingTodosFromSession` | 永远读不到 `todo/write` → 会话结束不沉淀任何 ESR draft |
| `capture` / `tools` / `preference` 的 `seq` 戳 | 溯源恒为 `seq: 0`（可审计性的最小字段失效） |

真机数据（本机 store，286 条记忆）：`kind` 分布里 **0 条 `episode`**、**0 条
`preference`**、只有 4 条带锚点——与「机制存在 ≠ 机制被调用」的旧教训完全一致。
单测之所以没发现：它们都 mock 了 `{ events: [...] }`，测的是旧宿主的形状。

## 修复

- 新增 **`lib/session-events.js`**：跨代际读取会话日志，按顺序取第一个可用路径
  1. `session.events`（≤0.1.x 与所有单测替身）→ 2. `ctx.sessionQuery.live()` 租约
  （≥0.2.x 官方路径，读完立即 dispose）→ 3. `session.snapshotEvents(0, seq)`
  （无 ctx 时的兜底）→ 4. `[]`。
  同时导出 `sessionEventsSource()`（`legacy` / `sessionQuery` / `snapshotEvents` /
  `none`）与 `sessionSeq()`（溯源 seq，优先 `session.seq`）。
- 6 处读点全部改接：`firstUserMessageText`、`buildEpisode`、`pendingTodosFromSession`、
  `episode` 写入的 seq、`capture` / `tools` / `preference` 的 seq。
- **不再无限重试**：`[RECALL]` 的 `pendingRecall` 现在只在「日志可读但首条用户消息还没
  落地」时重试；日志彻底不可读时只告警一次并照常缓存 `[ENGRAM]` 块——恢复前缀稳定性，
  也避免每轮重渲染。
- 新增一次性告警：`engram: this host exposes no readable session event log … —
  [RECALL] / episode / todo-sink stay dormant`（把静默降级改成可观测）。

## 验证

- `test/session-events.test.mjs` 10 例：所有用例的 session 替身**故意不暴露 `.events`**
  （只给 `seq` / `eventAt` / `snapshotEvents`，与 0.2.x 原型一致），覆盖 legacy /
  lease（含 dispose 断言）/ 兜底 / lease 抛错 / 完全不可读 / seq 取值，以及
  `[RECALL]` 取词、`buildEpisode`、`pendingTodosFromSession` 三条端到端回归。
  一旦有人改回 `session.events`，这组用例会红而不是静默归零。
- `npm test` 416/416；`npm run typecheck` 干净。
- 交叉核对真机形状：`Session.prototype` 仅含 `eventAt/snapshotEvents/ownEvents/
  deriveEventMessage`；真实会话文件里的 `user/message` 事件形状与读取逻辑一致
  （`data.content[].text`）、`todo/write` 仍存在于 0.2.1。
- **未做实机重启验证**：修复要重启 `dsh web` 才生效，而本次修复是在同一进程里做的
  （重启会终结当前会话）。验证方式：重启后新会话的系统提示里应出现 `[RECALL]`，
  且 `/stats` 的 `recallInjection` 计数开始增长。

## 升级步骤

```bash
# 插件走 file: 链接，改完代码重启 web 面即可
# （设置文档不需要迁移）
dsh web   # 或在你原来的终端里 Ctrl-C 后重新 dsh --profile web
```

## 由此改变的产品判断

本提案「拉取式被证伪」的实测（store 123 / recall 24 / detail 8）**有一部分是假的**：
推送腿当时根本没接线。重启后 1–2 周的账本与激活漏斗，才是「推送 vs 拉取」的第一份
干净数据——在它出来之前，不应据此再加新机制。
