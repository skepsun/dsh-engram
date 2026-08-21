# dsh-engram 改进方案 · 借自 Beads（依赖图 / 可逆压缩 / prime 注入）

> 依据：[gastownhall/beads](https://github.com/gastownhall/beads) 深度研究（Go + Dolt 的分布式图式 issue tracker）。
> 约束：全部**纯规则 / 零向量 / 零 LLM 蒸馏 / 确定性单测 / host 等自然重启**。
> 现状：ESR 任务有 draft→active→stable + 证据门，但**无任务依赖 / 无认领所有权 / 无会话开始注入**。

---

## 总览

| # | 概念（来源） | 解决什么 | 落点 | 成本 |
|---|---|---|---|---|
| ① | **依赖图 + ready 队列 + 原子 claim**（blockedstate.go / claimer.go / ready） | 任务各自为政：没有「谁挡谁」、没有可认领队列、没有所有权 | TaskSchema deps/assignee + `esr_dep`/`esr_claim`/`esr_unclaim`/`esr_ready` + board 阻塞标记 | host ~350 行 |
| ② | **可逆压缩**（compactor.go SnapshotIssue 先归档再覆盖） | 闭环任务全文占看板/上下文；丢了细节 | esr_close 自动 `snapshot` + 规则 `summary`；board 显示摘要、可回看原文 | host ~60 行 + board |
| ③ | **prime 注入模式**（prime.go 预算分层） | esr_model 只能按需查全文，无法 50-token 会话注入 | `esr_model` 加 `brief/full` + `max_chars` | host ~50 行 |

顺序：**① → ② → ③**（① 是核心增量，②③ 轻量收尾）。

**状态：① ✅ ② ✅ ③ ✅**（单 commit 落地，见 git log）。宿主 84/84（beads 12 + compaction 2 + prime 3）、
dock 63/63、board 59/59（含 4 条 beads UI）。host 侧（esr_dep/esr_claim/esr_unclaim/esr_ready、compactOnClose、
esr_model mode/max_chars）随下次 `dsh web` 重启生效；board 三处显示（🔒 blocker / @assignee / 🗜 摘要）
client-hmr 即时生效。

---

## ① 依赖图 + ready + claim

### 数据模型（TaskSchema 增量，向后兼容）
```jsonc
// 既有字段不动；新增：
"deps": [{ "id": "tsk_2", "kind": "blocks" | "relates-to" | "parent-of" }],
"assignee": null,          // claim 者
"claimedAt": null
```
旧任务无这些字段 → schema default 兜底，不动存量。

### 语义（借鉴 BlockedStateInvariant，纯派生）
- `isBlocked(ws, id)`：存在一条**未关闭**（非 stable/未 archive）的 `blocks` 边指向自己 → blocked；或被 `parent-of` 链上父级 blocked 继承 → blocked。
- `readyTasks(ws)`：active/draft 中 `!isBlocked` → 可认领队列。
- `claimTask(ws, id, agent, {force})`：已被他人 claim（assignee 非空且 ≠ agent）且非 force → 拒绝（anti-yank fence）；成功置 assignee+claimedAt+state=active。
- `unclaimTask(ws, id, agent, {force})`：同上 fence 反向。
- 校验：`addDep` 防自引用 + **有向环检测**（BFS 从 dep 出发不可达自身即可）。
- close 解锁：blocked 是派生的，无需显式释放（读时计算）；cycle 检测写时校验。

### 工具（host）
- `esr_dep {task_id, dep_id, kind}` → addDep，返回当前 dep 列表
- `esr_claim {task_id, agent?, force?}` / `esr_unclaim {task_id, force?}`
- `esr_ready {ws?, limit?}` → 无 blocker 的 active/draft 列表（一行一条 + 缺口）
- 全部走既有 parse/guard/中文返回；拆写不入 dock。

### Web
- board 卡上：被 blocker 阻塞 → 卡头 🔒 + title 提示「被 N 个未闭环任务阻塞」；有 assignee → 卡 meta 显示 `@assignee`。（不做编辑，编辑走工具。）

### 测试
`test/beads.test.mjs`（或并入现有）：addDep 自引用拒 / 环拒 / isBlocked 直连+继承 / ready 过滤 / claim fence / unclaim fence / close 后 blocker 解锁 / route 注册。

---

## ② 可逆压缩（闭环快照）

- esr_close 进入 stable 时：若 `description.length > 240` 字符 → `summary = 首行/前 120 字`（规则截断，无 LLM），`snapshot = { description, artifact, evaluation, memoryRefs }` 原文入库存档；否则 summary=null。
- board 卡：`summary` 存在则显示摘要并标注「已压缩 · 原文见详情」；展开区回看全文（snapshot）。
- 语义：上下文只看摘要、信息可逆，与 compact.go 的「先归档再覆盖」同序（我们是先归档再展示）。
- 新增 `esr_task --full`（或 esr_detail 变体）回看 snapshot？最小：board 展开即可，不加新工具。

---

## ③ prime 注入模式（预算分层）

- `esr_model` 加参数 `mode: "brief"|"full"`（默认 full）、`max_chars`。
- `lib/mental.js` 加 `compileBriefSummary(domain, ws)`：只输出核心一行（任务 X 进行中/Y 就绪 · 实体 a b · 观测 N 条 · 风险 0）——对应 beads 的 ~50-token MCP 提醒。
- brief 同样吃 dirty/水印缓存（复用 getModel，仅渲染模式不同）。
- 工具文档更新：建议会话开始用 `esr_model --brief` 注入；全量按需用 full。

---

## 风险与不做
- 不做 Dolt/分布式 sync / wisp 消息平面 / AI Haiku 压缩 / contributor-maintainer 路由。
- 不做 board 依赖编辑 UI（工具优先，dock 保持极简）。
- cycle 检测 O(V+E) 每写一次，任务数小（≤40/ws）无压力。
- addDep 对 stable/archived 目标仍放行（可引用历史），仅校验存在性。
