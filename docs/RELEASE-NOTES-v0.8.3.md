# dsh-engram v0.8.3

**v0.8-D：审批门——证据让你进索引，人点头才让你写文件。**

## 为什么两种表面要用两种门

v0.8-A 的门是证据：同一命令成功 ≥3 次、14 天内、未失效 → 进 `[ENGRAM]` 索引。
v0.8-B 把过门的 procedure 写成 `SKILL.md`，宿主会把它挂进**每个**会话的 catalog。

这两件事的风险不一样：

| 表面 | 成本 | 后果 | 门 |
|---|---|---|---|
| 索引里的一行 | 几十字符，下轮就没了 | 私有、可撤回 | 证据（自动） |
| `.dsh/skills` 里的文件 | 磁盘文件 | 被宿主广告给所有 agent（含 subagent） | 证据 **+ 人点头** |

**证据证明的是一条命令跑通过，不是这条指令是对的。** 三条成功记录也可能是三条
有害记录——所以写文件这件事，机械证据不够。

## 怎么用

```bash
npx dsh-engram skill pending          # 证据已够、等你批准的清单
npx dsh-engram skill approve <id>     # 点头（可带 --note "…"）
npx dsh-engram skill revoke <id>      # 收回，下次 export 会删掉它的 SKILL.md
npx dsh-engram skill export           # 只导出「过证据门 + 已批准」的
npx dsh-engram skill export --force   # 本次跳过批准门（审计用的逃生口）
```

批准记录存在 `~/.dsh/engram/playbook-approvals.json`，**不放进记忆库**——批准是人的动作，
放进同一个池子里就等于让池子自己批准自己。结构：

```json
{ "version": 1, "workspaces": { "/path/to/repo": { "<memoryId>": { "at": 1792…, "note": "看过了" } } } }
```

`pending` 与 `export` 用的是同一个 `planSkillExport`，所以「清单里有的」和「导出时被拦的」
永远是同一批——不会出现清单说 A 够格、导出却默默跳过 A 的分叉。

## 你会看到的

```
$ npx dsh-engram skill export
skill export · workspace /repo · 128 条记忆 · 目标 /repo/.dsh/skills
  等批准 1（证据已够，但写文件需要你点头）：
    engram-fix-npm-test  a1b2c3d4
  批准：npx dsh-engram skill approve <id>；或本次强制：--force
```

## 证据

- `test/approvals.test.mjs` 5 条：文件缺失即零批准、按 workspace 隔离、撤销后空桶清理、
  文件损坏降级为「没有批准」而不是崩、空 id 拒绝；
- `npm run skill:check` 从 11 条扩到 **15 条**，新增 4 条走的是宿主自己的 provider：
  未批准不落文件、未批准进 pending、批准后能导出、`--force` 能绕过；
- 全量 `npm test` 见下。

## 边界（写清楚，免得被当成已做）

- 只挡住了「写文件」这一层。索引里的 procedure 行仍是证据门自动晋升的——它便宜、私有、
  撤回无成本，加审批只会让人学会无脑点「同意」；
- 审批记录是**本机**状态，不进 git：换机器要重新点头。这是有意的——跨机复制批准等于
  把「我看过了」变成「有人看过了」；
- GUI 里还没有审批按钮（只有 CLI）。面板要做的话，读的是同一个 approvals 文件，
  不需要新协议。
