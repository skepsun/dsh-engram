# dsh-engram v0.7.8

**L1 第三次尝试，第三个 bug**：闸门放行之后，剪枝本身在 `session.append` 的重入检查上
被静默吞掉——"fire 了、剪了 0 条、永远如此"。

## 1. 证据（v0.7.7 之后真机复现）

修好工作区键（v0.7.7）后，`boundary-attempts.jsonl` 第一次出现 `kind: fired`：

```json
{"plane":"host",  "kind":"fired","boundary":{"kind":"todo","completed":2},"requests":3,"pruned":0,"charsRemoved":0}
{"plane":"preset","kind":"fired","boundary":{"kind":"todo","completed":2},"requests":3,"pruned":0,"charsRemoved":0}
```

但紧接着我往 surface 里放了一个 60 KB 的工具结果，再做两次 todo 边界（completed 3、4），
**日志一行都没有**。不是"剪了 0 条"，是**整个回调消失了**。

## 2. 根因：在 publish 窗口里 append

DSH 的 `Session.commit()` 在发布事件时置 `appending = true`，并把 `session/event`
观察者**在同一同步栈里**叫起来。`toolResultPruner.pruneSession()` 为每个被剪的节点
`session.append("compaction/prune", …)` —— 在 publish 窗口内这是重入，host 直接抛
`session append cannot reenter while another append is being published`。

而监听器外层是 `try/catch { log?.warn }`（"剪枝 bug 绝不能打断会话管线"），于是：

- 有东西可剪 → 抛异常 → 被吞 → 日志里连"fired"都不出现；
- 没东西可剪 → 不 append → 正常落盘 `fired, pruned: 0`。

合起来正是「永远 fired、永远 0 条」的完美表象。

## 3. 修复

- `fireBoundary` 改由 `queueMicrotask` 调度：微任务在 `commit()` 返回之后才跑，
  `appending` 已复位，append 合法。
- 外层 catch 不再只写日志（日志在 web 里没人看得到），改为**落盘**
  `report("error", { where, message })` —— 以后任何抛错都会出现在
  `boundary-attempts.jsonl` 里。
- 回归测试：假会话在 publish 窗口内 append 抛错（照抄 host 的措辞），断言
  剪枝落在窗口之后、`pruned: 1` 正常入账。

## 4. 现在的状态

- 闸门：放行（v0.7.7 工作区键归一）。
- 执行：落在 publish 窗口之外（本版）。
- 观测：`plane / kind / pruned / charsRemoved` 全落盘，抛错也落盘。

下一次真机边界（surface 里有 >8192 字符的工具结果）应当出现
`kind: "fired", pruned > 0`，账本对应会话行的 `prunedChars` 由 0 变正——
这是 L1 第一次真正给「节省」贡献数字。

## 已知边界

- `pruneSession` 只剪**当前 surface** 里的超阈值结果；已经离开 surface（被 Context GC
  或压缩遮掉）的历史不参与，符合设计。
- G1 仍是 1/4 行正收益（`未测`），判定需要 ≥ 5 条账本行。
