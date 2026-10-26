# dsh-engram v0.8.4

**v0.8-D 的另一半：审批门有了 GUI；G6 的门方向修正 + 隐藏规格语料。**

## 1. GUI 审批（`GET|POST /api/dsh-engram/approvals`）

CLI 里能批，面板里也能批，而且是**同一份记录、同一个规划器**：

- 服务端 `approvalsView()` 用 `planSkillExport`（`skill export` 用的同一个）算出
  「证据过关的 procedure」，再按 `~/.dsh/engram/playbook-approvals.json` 切成
  approved / pending。**GUI 不可能批准一个 CLI 会跳过的条目**——两边不是各写一遍规则。
- 客户端「记忆」页顶部出现「Playbook 待批准」卡片：名字、id、证据次数、描述 + 批准/撤销按钮。
- 撤销不是删除证据：条目退回 pending（证据还在，只是文件又被撤了）——这正是操作者
  需要看到的状态。

顺手修的两处：

- `planSkillExport` 的 `dir` 现在是可选的（GUI 只问「会写什么」，不落地），
  传 `undefined` 不再炸在 `path.join` 上；
- `requireApproval: true` 只返回**已批准**的条目，所以「待批准列表」必须用
  `requireApproval: false` 再按批准记录切分——这条写进代码注释，因为第一次写错就是这么错的。

## 2. G6 的门方向修正（重要）

原来的门是 `|Δ| ≤ 2pp`，等于「记忆帮了忙也算失败」。改成单边：

| 条件 | 判定 | 含义 |
|---|---|---|
| Δ ≥ −2pp | PASS | 不伤害（**硬条件**） |
| Δ > +2pp | PASS + 观测值 | 记忆带去了可用信息（提案的愿望，不是门槛） |
| Δ < −2pp | FAIL | 挂载让任务变差 |
| 配对 < 10 | 未测 | 低于配对下限一律不判 |

修正发生在第一轮 0.0pp 之后、第二轮之前——不是为了让某个结果过关，而是把
「愿望」写进门槛本身就说反了。`npm test` 里两条新用例分别钉住「+100pp 判 PASS」
和「−100pp 判 FAIL」。

## 3. 隐藏规格语料（G6 第二轮）

第一轮 12/12 vs 12/12 是天花板：测试就在仓库里，两臂都能读到规格。
第二轮（`eval/fixtures/ledger-kata-hidden`）仓库只有 `src/`，**测试在仓库外**，
`check` 在 agent 收工后才把私有测试拷进去；规格只存在于预置记忆（6 条约定 + 2 条过时旧约定）。

控制组不许偷看，是**物理隔离**而不是靠自觉：

- 控制臂运行时把记忆库文件移出 `DSH_HOME`（移到系统临时目录，跑完移回）——
  第一次只把文件改名为 `.g6-hidden` 留在原目录，agent 直接 `ls storages/` 读走了；
- 跑批输出目录搬到仓库外，否则 agent 顺着 `..` 就能读到 `eval/g6/oracle/` 和种子文件；
- harness 对控制组日志做污染检测（`dsh_engram` / `[ENGRAM]` / `engram_recall`），
  报告里计数——一个跑出漂亮数字的 pilot 差点被当成证据，这条是那次教训的产物。

## 证据

- `npm test` **477/477**（本轮 +2：审批 API 往返、门方向）
- `npm run skill:check` PASS 15/15
- G6 第二轮结果见 `docs/G6-quality-ab.zh.md`（有效数据 + 天花板声明）
