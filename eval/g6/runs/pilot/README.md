# pilot（无效实验，保留作证据链）

第一次跑配对实验时，harness 写进去的预置记忆行 `sessionId: null` 违反了
`MemorySchema`（`sessionId: z.string().min(1)`），插件因此把整个域判为不可用：

```
domain 'dsh_engram' … stored record 'seed-00' does not match its schema — memory offline
```

于是这一轮 on 臂实际是「engram 离线」，两臂差别不是记忆而是故障——**数字无效**。
修好 seed 行（`sessionId: "session-g6-seed"`）后的 `pilot2/` 与正式轮 `g6-2026-10-26/`
才是有效数据。留着这份记录，是因为「pilot 抓到了 schema 漂移」这件事本身是流程价值。
