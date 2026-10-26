# dsh-engram v0.8.0

**v0.8-A：procedure 变成有证据的东西。** 这一版只做 A（证据化 procedure + 失效检测）；
B（导出 DSH Skill）、C（subagent 胶囊）、D（审批门）还没做。

## 1. 之前的问题

`fixed: npm test — 1 earlier failing run now succeed` 这类 procedure 是**一次成功就写进去、
一次成功就进索引**的。那不是经验，那是运气。`signal 0.45 ≥ minIndexSignal 0.4`，
所以它当场就占了 [ENGRAM] 的一行——正是「从 n=1 泛化」的教科书反例。

## 2. 现在

| 字段 | 含义 |
|---|---|
| `evidenceCount` | verified 成功次数。诞生时 = 1 |
| `lastVerifiedAt` | 最后一次 verified 成功的时间 |
| `lastFailedAt` | 最后一次同命令失败的时间 |
| `invalidatedBy` | 导致失效的那条 error 记忆 id |

**晋升**：`evidenceCount ≥ 3` **且** 最近验证在 14 天内 **且** 之后没失败 → 才进索引。
一个手写的 procedure（没有 evidence 字段）继续走老的 `hits >= promoteHits`，不会被新门误伤。

**失效**：同命令再次失败 → 立刻 `lastFailedAt = now`、`invalidatedBy = <error id>`、
`signal → 0.2`、**当场退出索引**。理由很直接：一条刚失效的 procedure 比没有更糟，
下一个 agent 会照着抄。

**记账不碰 recency**：`recordProcedureOutcome` 不改 `updatedAt` / `hits`——
证据不是召回，crediting 一次成功不该把这条记忆在时间序里重新排前。

## 3. 接在哪

`lib/capture.js` 的 auto-capture handler：每一次命令运行都会问
`procedureOutcome()`（同 workspace、同 `cmd:` 签名、active、`fixed:` 前缀），
命中就记一笔证据。**没有新记忆要写的时候也记**——大多数命令运行本来就不产生记忆，
而它们恰恰是证据的主体。三条早退路径（无条目、窗口内重复、正常写入）都会走到这笔账上。

## 4. 门的证据

`npm run playbook:audit`（[eval/playbook-audit.mjs](eval/playbook-audit.mjs)）跑一个
**注入测试**：往空 store 里塞 10 条「看起来权威」的 `fixed:` procedure。

| 阶段 | 期望 | 实测 |
|---|---|---|
| 过时（30 天未验证）时在索引里 | 0 | 0 |
| 刚重新验证后（对照） | 10 | 10 |
| 首次再失败后失效 | 10 | 10 |
| 失效后仍在索引里 | 0 | 0 |

**10/10 PASS。** 提案里写的是「7 天内全部被降权/失效」——机制是首次失败即失效，
所以测试直接注入失败，不必等一周。

线上账本（报告不判定）：27 条 procedure，2 条 auto-captured（都未证明、都在索引外），
4 条靠 hits 晋升的手写 procedure，0 条失效。

## 5. 还没测的

- **复用率 ≥30%**：需要「被召回后真的被引用」的遥测，现在只有晋升/失效计数；
- **一次通过率 +5%**：属于 G6，装置已就绪（`npm run quality:ab`），缺一次真实配对实验。
