# dsh-engram v0.7.13

**账本终于记得住东西了。** 两个把「证据」变成零的 bug，都在重启后才看得见。

## 1. 压缩入账：永远是 0，因为读错了事件的形状

`committedGcSaving()` 读 `event.summary` / `event.shadowedTokenCount`，而 DSH 真正落盘的
`compaction/summary` 长这样：

```json
{ "type": "compaction/summary", "seq": 7, "time": 1,
  "data": { "compactionId": "…", "summary": [...], "shadowedTokenCount": 83371, … } }
```

结果：**本机 137 个已提交 checkpoint 里 82 个是 Context GC 写的，一个都没入账**（若按真实
形状重放，它们合计 29,629,411 字符 ≈ 7.4M token）。单元测试一直是绿的，因为它自己造了一个
扁平事件——和 v0.7.8 的重入 bug 同一类：测试的假宿主比真宿主宽容。

修法：优先读 `event.data`，扁平形状保留兼容；wiring 测试改成发真实形状的事件。

## 2. 重启会把会话的剪枝计数清零

`flushSession()` 里写的是 `row.prunedChars = session.prunedChars`（绝对值），而重启后
内存计数从 0 开始 → **重启后的第一次 flush 把持久行的剪枝历史覆盖成 0**。
今天 10:04 就这么把本会话那 7,841 字符抹掉了（快照里现在还是 0）。

修法：三个计数（pruned/hostPruned/compacted）改成 delta 累加，并在 `ensure()` 时从持久行
回填种子。回归测试新增 `a restart does not zero a session's prune counters`。

## 3. 附带

- CLI 的 `readLedger()` 现在尊重 `DSH_HOME`（此前在沙箱里也会读真实账本，测试因此一直
  在验证真机数据）。
- `npx dsh-engram status` 的「L1 未武装」告警区分「默认关闭」与「服务坏了」，前者不再报警。

## 已知边界

- 已被清零的历史行不会自动恢复（`sessions` 里的 0 是真的写坏了；`workspaces` 桶里还留着
  一部分合计值）。从本版起不再发生。
- G1/G1b 这两个门之前 FAIL 有很大一部分是上面两个 bug 造成的，重启后应重跑
  `npm run gate:audit` 再判断。
