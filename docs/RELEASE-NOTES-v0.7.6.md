# dsh-engram v0.7.6

自 v0.7.5 以来：**修掉 L1 边界剪枝在 `dsh web` 上「已武装、永不触发」的结构性哑火**，
并给「武装≠开火」这件事补上可离线检查的证据。

## 1. L1 在 web 上是哑的（真机证据 + 根因）

v0.7.5 之后状态快照说 `boundaryPrune.armed: true`，`/overview` 也一致，但：

- `activation.boundaryPrune` 恒为 `null`，`~/.dsh/engram/pack-telemetry.json` 从未生成；
- 账本所有会话行的 `prunedChars` 恒为 `0`；
- 本会话里真实发生了一次 todo 边界（`todo/write`，1 项完成），依然什么都没有。

根因不是阈值或还款时钟：**监听器装在 host 平面，而 `dsh web` 的会话事件属于
agent preset 的 realm**。host 那只监听器从头到尾没见过一个 `todo/write`，所以它
永远「武装、零触发」——账本信用侧的两条腿里，剪枝那条腿在 web 上是死的。

## 2. 新增 preset 行 `dsh-engram/prune`

web 接管现在同时写入**两行**（同一个 `compaction` 组、同一个 isolate realm）：

```yaml
- id: engram-compaction
  name: dsh-engram/compaction
- id: engram-prune
  name: dsh-engram/prune      # L1，能看见这个 realm 里会话的 todo/goal 边界
```

- `lib/prune.js`：realm 侧入口，复用同一个 `toolResultPruner` 与还款/自适应门；
  入账走 host 提供的 `engramLedger`（账本仍只有一个写者）。
- 两平面并存是安全的：`pruneSession` 只剪超阈值结果，第二次扫同一 surface 找不到
  可剪对象，自然不重复入账。
- 老接管（只有引擎行）在刷新配置时自动补上 prune 行；`revert` 会把它摘掉，
  回到**逐字节一致**的出厂文本（有回归测试）。

## 3. 「武装≠开火」有证据了

新增 `~/.dsh/engram/boundary-attempts.jsonl`（JSONL，32 KB 内保留最近 20 条）：

| 字段 | 含义 |
|---|---|
| `plane` | `host` / `preset` —— 哪个平面看见的边界 |
| `kind` | `fired` / `skipped`（还款时钟）/ `held`（账本自适应关闭） |
| `boundary` | `{kind: todo|goal, ...}` |
| `pruned` / `charsRemoved` | 真剪到几条、多少字符 |

`npx dsh-engram status` 直接打印摘要（各平面见过几次边界、真剪到几次、最近一次）。
从此「0 次尝试」和「尝试了但剪不到」是两件可区分的事。

## 4. 状态文件不再被杂进程覆盖

同一份 `context-gc.status.json` 变「说谎」的第二个来源找到了：**跨进程**覆盖。
`npm test` 的 wiring harness 会真的跑 `apply()`，于是每次跑测试都会用出厂默认
（`host: unavailable` / `L1 未武装`）覆盖开发机上正在跑的服务器快照。

- harness 现在把 `DSH_HOME` 指到临时目录；
- `writeContextGcStatus` 增加一条规则：**跨 pid 的降级写入，若原写者进程仍存活则拒绝**。
  重启（新 pid、同样好的快照）照常接管，崩溃循环也不会把好快照刷成坏快照。

## 5. 顺手

- `gate-audit` 的报告日期不再写死 `2026-10-22`，改为审计时刻的真实日期。

## 已知边界

- 本版只让 L1 **能**开火；它到底剪了多少，要等下一次 todo 边界在真机发生
  （`boundary-attempts.jsonl` 里出现 `plane: preset, kind: fired, pruned > 0`）。
- G1 仍是 1/4 行正收益（`未测`），判定需要 ≥ 5 条账本行。
