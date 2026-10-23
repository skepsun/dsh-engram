# dsh-engram v0.7.7

**L1 边界剪枝在真机上永久哑火的真正原因**：工作区键一边是 `Users-x-proj`，一边是
`/Users/x/proj`，查历史永远落空 → 还款闸门的「预期会话长度」塌回地板值 → 任何
`requests ≥ 1` 的会话都被判「快到尾巴了、别剪」，于是**坐着武装、永不触发**。

## 1. 证据链（v0.7.6 的脚手架抓到的）

v0.7.6 给每个「看见边界」加了落盘 `boundary-attempts.jsonl`。真机重启后我故意做了一次
todo 边界（1 项完成），文件里立刻出现两行：

```json
{"plane":"preset","kind":"skipped","boundary":{"kind":"todo","completed":1},"requests":7,"expectedTotal":50,"workspace":"/Users/sunchuxiong/dsh-loom"}
{"plane":"host","kind":"skipped","boundary":{"kind":"todo","completed":1},"requests":7,"expectedTotal":50,"workspace":"/Users/sunchuxiong/dsh-loom"}
```

三件事同时被证明：

1. **两个平面都收到了边界** —— v0.7.6 里「host 平面看不见 web 会话事件」的推断是错的，
   realm 隔离不是病因（preset 行留着，无害且自限）；
2. 拦住它的是**还款闸门**（`kind: skipped`），不是阈值、不是 pruner；
3. `expectedTotal: 50` —— 恰好等于地板值，说明**历史查询没命中**：一个有 17 场会话的
   工作区，被当成了「第一次见的陌生目录」。

## 2. 根因：两套键，永远对不上

| 来源 | 键的形状 |
|---|---|
| 会话目录（`~/.dsh/sessions/--Users-…-dsh-loom--/`） | `Users-sunchuxiong-dsh-loom` |
| 活会话的 `header.cwd` | `/Users/sunchuxiong/dsh-loom` |

`expectedSessionRequests()` 拿后者去 `history.get(workspace)`，永远 `undefined` →
`prior` 落回 `DEFAULT_MIN_REMAINING`（50）→ 闸门是
`requests + minRemaining > expectedTotal`，在 `expectedTotal == minRemaining` 时对任何
`requests ≥ 1` 恒真 → **跳过**。只有 `requests == 0` 才可能开火——也就是永不。

这同时解释了今天早些时候「210 请求、真边界、零触发、`activation.boundaryPrune: null`」。

## 3. 修复

- `normalizeWorkspaceKey()`：`/Users/x/proj`、`Users-x-proj`、`--Users-x-proj--`
  归一成同一个键（去首尾分隔符、`/ \` 折叠为 `-`、win32 小写）。
- `workspaceHistory()` 用归一键建表；`expectedSessionRequests()` 查表前也归一
  （两侧都归一，向后兼容注入的旧式 map）。
- 回归测试：造一个真实形状的桶（`--Users-x-proj--`, 非空 `session.jsonl.zstd`），
  断言活 cwd 能查到历史、`expectedTotal` 从 50 变 120、闸门从「必跳过」变成「有headroom」。

真机语料上的模拟：`expectedTotal` 由 `50 → 120`，`7 + 50 ≤ 120` → 边界会放行。

## 4. 顺带修掉的污染源

`engramHome()` 之前写死 `~/.dsh/engram`，不看 `DSH_HOME` —— 于是跑一次 `npm test`，
测试里的假会话（`/tmp/ws-preset`）就把 21 次假 fire 写进开发机的**真实**遥测
（`boundary-prune.status.json`）。现在它跟随 `DSH_HOME`，测试彻底隔离。

## 已知边界

- 本版让闸门**有 headroom**，但真机是否真的剪到东西，仍需一次 ≥ 50 请求后的 todo 边界
  在 `boundary-attempts.jsonl` 里留下 `kind: fired, pruned > 0`。
- G1 仍是 1/4 行正收益（`未测`），判定需要 ≥ 5 条账本行。
