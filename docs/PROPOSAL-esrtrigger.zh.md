# 提案：ESR 触发机制对齐 pi-esr —— 静态方法论 + 会话快照 + 拉取式触发

- 状态：**已实施**（含范围「完整实施」+「提示行挪到 esr_status」两项批准决策）
- 面向：dsh-engram `[ESR]` 块的触发/提示机制（P0-A/B + P2 + P3 + P4）
- 参考：pi-esr（`@pi-esr/…`）——README「为 LLM 前缀缓存稳定性而生，每字节确定」（三个不变式 + 状态机 + 增量读取）

---

## 1. 为什么现在改（当前机制的不稳定点）

`[ESR]` 块是 dsh-engram 模型侧触发 ESR 的全部入口。当前实现（`lib/index-block.js` `renderEsr` +
`lib/trigger.js` `makeTriggerRecorder` + `lib/index.js` systemPrompt section 装配）：

1. **`[ESR]` 块每轮系统提示词装配都重新渲染**。对比 `[ENGRAM]` 走 `blockFor()` 的每会话
   `sessionCache` 冻结缓存，`engram:esr` section 的 `text()` 直接调 `renderEsr(...)`——每次都带着
   live recorder 重跑。于是逐轮注入内容漂移 → **打断前缀缓存（KV cache）**，会话越长成本越高。
2. **块内混入推式启发式提示行**：`promote:` / `root-cause:` / `close:` / `stale:` / `escalate:`
   随运行态出现/消失（一旦强制一次/会话抑制、magic 阈值 `minTodosForPromote`/`todoPromoteRatio`/
   `minErrorHits`/`staleTaskDays`/`escalate 0.34`）。`sortActiveForNext` 的末位 tiebreak 用
   `updatedAt` → 同状态任务排序随时间漂移。这些行**每轮都可能不同**，无法复现、难以测试，也不稳定。
3. **教模型「何时用 ESR」靠运行时 nudge，而非静态方法论**：协议（建任务→升 active→证据闭环）
   依赖提示行出现才被记得；提示被 once 抑制后协议也就不可见了。
4. **推式状态全在进程内内存**（todo 快照、mem/esr 计数、once 抑制集合）→ 宿主重启即清、跨会话
   不可见、纯时序依赖。

> 一句话：**触发信号从「每轮推送进前缀」变成「每轮推送进前缀」的错误姿势**——正确姿势是
> 「前缀里只有字节恒定的方法论+快照，实时状态按需拉取」。

---

## 2. pi-esr 参考（「稳定」的三个不变式 + 状态机）

pi-esr README.zh-CN：*「一个受约束的语义图状态机，专为……设计。为 LLM 前缀缓存稳定性而生——
每个字节都是确定性的。」*

| # | 不变式 | pi-esr 落地 | 我们当前的违背点 |
|---|---|---|---|
| 1 | **系统提示词运行时永不变化** | `prompts/esr.md` 静态方法论 + Golden Rules + Minimum workflow，每轮逐字节相同 | `[ESR]` 块每轮重渲染、提示行增删 |
| 2 | **会话快照注入一次、绝不中途自动刷新** | `[ESR_CONTEXT]` 在 SessionStart 注入，末尾明示 "This snapshot WILL NOT auto-refresh. Call `esr_get_context`…"；上下文**确定性排序**（entity by id、relation by (from,type,to)），**时间戳排除在上下文外**（保字节稳定） | `[ESR]` 从未冻结；`sortActiveForNext` 用 `updatedAt` 排序 |
| 3 | **增量读取** | `esr_get_context(since_revision=N)`：版本一致 → ~10 token 的 "ESR state unchanged since revision N"；不一致 → 全量确定性快照 | 没有拉取工具；状态只在块里 |
| 4 | **状态机** | draft → active → stable（blocked/deprecated）；每次转换自动 journal；`esr_complete_task` 一站式证据闭环；「State is the single source of truth」 | 已有 draft→active→stable + 证据门（对齐），无需大改 |

另外 pi-esr 把「何时该创建/提升/闭环」写进**协议文本**（`When to call ESR` / `Minimum workflow` /
`Golden rules`），而不是运行时 nudge——稳定且提示串可复用。

---

## 3. 推荐设计（dsh-engram 落地：静态 + 快照 + 拉取）

### 3.1 静态方法论 section（新增 `engram:esr-method`，字节恒定）

固定文本（仿 pi-esr Golden Rules / Minimum workflow，改成 dsh-engram 工具名），每轮逐字节相同：

```
ESR（工程状态）操作协议 —— 多步工作建任务、用证据闭环：
  1. 动工前：esr_ready 看可认领工作；esr_status 拿实时状态（本块是会话开始快照，不会自动刷新）。
  2. 多步工作 → esr_task(name="…", entity=…) 建任务（draft 起步）；重复对象 → esr_node；关系 → esr_link。
  3. 动工 → esr_claim（draft → active）。
  4. 收工 → esr_close（artifact + evaluation + memory_ref 三证齐才算数；不齐的活继续挂着，别硬关）。
  state 是唯一真相：拿不准 state 就 call esr_status。
```

装配在 `esrOrder` 之前（如 order-1），**不依赖任何运行态**。DSH systemPrompt section 本身就
按 section 缓存；该 section 返回的文本只由静态内容组成 → 字节稳定。

### 3.2 `[ESR]` 块改为「每会话冻结快照」（复用 `blockFor` 的 sessionCache）

- `renderEsr` 放进与 `[ENGRAM]` 相同的 `sessionCache` WeakMap（新 session → 渲染一次）。
- 快照内容（全部**确定性派生**，无 LLM、无 recorder、无时间戳）：
  - `[ESR] tasks: N active / M stable / K draft`
  - 证据齐的最优先行：`next: esr_close <id>`（`evidenceGaps` 纯派生）——保留
  - 活动任务列表按 `READY→claimed→active→draft` 排序列出；**最后 tiebreak 从 `updatedAt`
    改为 `id` 字典序**（等价 pi-esr「时间戳排除在上下文外」；同一 store 快照 → 字节相等）
  - `closed:` 行（stable 汇总）——保留
  - 固定尾行：`snapshot from this session's start — WILL NOT auto-refresh; call esr_status for live state`
  - **删除**全部 `promote:/root-cause:/close:/stale:/escalate:` 行与 `#suggest-*` 来源标记（从块内）
  - 空态时保留一行固定的「BE PROACTIVE」教模型建任务（静态文本，非 nudge）
- 无 session 的渲染（GUI 预览）天然不带 hints，行为不变。

### 3.3 `esr_status` 拉取工具（新增，替代推式提示的全部「实时」职责）

工具（读类，zero-写）：`esr_status(workspace?, since_revision?)`

- **全量视图**：确定性排序的活动/稳定/draft 任务 + `next:` 行 + stable 汇总（≈现 `renderEsr`
  的静态部分，但含活数据）。
- **增量**：进程内维护 workspace 级 `revision`（每次任务写操作 +1，或像 pi-esr 那样用
  DJB2 指纹 `buildGraphFingerprint`，二选一，实施时定）；`since_revision ≥ 当前` →
  返回 `ESR state unchanged since revision N (~5 行小响应)`；不一致 → 全量。
- **派生 actionables（原 P0-A/P0-B/P2/P3 转变而来，只在「拉」时产生）**：
  - `promote:` — 读 recorder 的 todo 快照（`minTodosForPromote`/`todoPromoteRatio` 保留，但只在此 apply）
  - `root-cause:` — 读 store 的复发错误候选（`minErrorHits` 保留）
  - `close:` / `stale:` — 读 `workDone` 标记 / `staleTaskDays` 计算（stale 按 task update 时间
    在**拉取时**算——不进前缀，时间敏感无碍）
  - `escalate:` — 读 recorder 的 mem/esr 实时计数
  - 每条仍带 `#suggest-*` 标记（可引用、可归因）
- 由于这些行只在按需返回里出现，**永不进入每轮前缀** → 前缀稳定性不受影响。

### 3.4 `[ENGRAM]` index 块保持现状（已经冻结，不在此提案范围）

### 3.5 P4 转化度量适配

- `emitHint(kind, ws, sessionId)` 从「`renderEsr` 注入块时调用」改为「`esr_status` 返回该 hint
  时调用」（真实返回路径）；`tools/result` 订阅里 esr_* 的 10 分钟窗口归因**保持不变**。
- `/triggerstats` API/口径文案微调（触发源：`esr_status` 返回，而非块注入），路由不变。

### 3.6 保留 / 移除对照

| 现状 | 动作 |
|---|---|
| `[ENGRAM]` 冻结块 | 保留 |
| 记忆面板 GC、Context GC | 保留（刚实施） |
| `esr_task/esr_close/esr_link/esr_dep/esr_ready/esr_node/esr_claim` 工具与证据门 | 保留 |
| GUI「沉淀到 ESR」按钮 | 保留 |
| `tools/result` 订阅喂 recorder（todo 快照、mem/esr 计数） | **保留**（转成 esr_status 的拉取数据源；不再喂块渲染） |
| `[ESR]` 块逐轮重渲染 | **移除** → 每会话冻结快照 |
| 块内 `promote/root-cause/close/stale/escalate` 行 | **移除** → 移到 `esr_status` 拉取结果 |
| `sortActiveForNext` 的 `updatedAt` tiebreak | 改为 `id` 字典序（确定性） |
| 静态方法论 | 新增 `engram:esr-method` |
| `esr_status` | 新增（含增量 revision） |
| 配置键 `minTodosForPromote/todoPromoteRatio/minErrorHits/staleTaskDays` | 保留（仅作用于 esr_status 派生行） |

---

## 4. 测试（`test/` 新增/改动）

| 组 | 用例 |
|---|---|
| 快照确定性 | 同一 store 快照下 `renderEsr` 两次调用输出**逐字节相等**；输出**不含** `#suggest-*`/`promote:`/`escalate:` 等 hint 行 |
| 排序确定性 | `sortActiveForNext` 对同 rank 任务按 id 稳定排序（不再用 updatedAt 漂移） |
| 版本/增量 | `revision` 单调递增（写任务 +1）；`esr_status(since_revision=当前)` → short "unchanged" 响应；过期 rev → 全量 |
| 派生行 | esr_status 含 promote（todo 快照条件）/ root-cause（hits≥阈值）/ close（workDone）/ stale（超窗）/ escalate（mem ratio），每条带 `#suggest-*` |
| 静态方法论 | `engram:esr-method` 文本与运行态无关（两轮装配字节相等） |
| 回归 | 现有 143 测试全绿（`renderEsr` 的既有调用方/测试按新语义适配：无 recorder 时=纯快照） |

---

## 5. 风险与不做

- **不做**：不删 `tools/result` 的 recorder 订阅（它是 esr_status 派生行的数据源）；
  不做 pi-esr 式「协议硬门」（PreToolUse 强拦）——DSH 是自由 agent，硬门会进交互层，暂不做；
  不做 `since_revision` 的持久化（进程内 revision 足够；跨宿主重启全量返回，代价可接受）。
- **行为变化**：`[ESR]` 块不再逐轮提醒 → 依赖提示的旧行为消失，由静态方法论 + 用户/模型主动
  `esr_status` 替代。这是「稳定换主动」的取舍，正是 pi-esr 的取向。
- **GUI 预览**：`renderEsr` 不带 recorder 时本来就渲染静态视图，改动后预览与真实快照一致。
- `updatedAt` 不进入快照（连 tiebreak 都不依赖它）→ stale 只存在于拉取视图，天然与缓存解耦。

---

## 6. 落地顺序

1. `index-block.js`：`sortActiveForNext` tiebreak 改 id；`renderEsr` 去掉 hint 分支（保留
   `next:`/列表/closed/静态 BE PROACTIVE/尾行）；配套单测。
2. `index.js`：`[ESR]` 并入 `sessionCache` 冻结渲染；新增 `engram:esr-method` 静态 section。
3. `store.js`：workspace 级 `revision` 计数（写路径 +1）+ `buildWorkspaceFingerprint`（可选）。
4. `tools.js`：新增 `esr_status`（全量 / since_revision 增量 / 派生 actionables）。
5. `trigger.js`：`emitHint` 改从 esr_status 返回路径调用；其余逻辑保留为拉取数据源。
6. 文档：README.zh/README.md 的「决策点触发」章节改写为「静态协议 + 会话快照 + 拉取触发」；
   FEATURES.zh.md 记一笔。
7. 回归 `npm test` + `npm run build:client`。

---

## 7. 验收

- `[ESR]` 块在同一会话内两次装配**逐字节相同**（前缀缓存稳定）。
- 同一 store 快照下 `renderEsr` 输出确定性（无时间戳、无 recorder、无 `#suggest-*`）。
- `esr_status` 提供增量短响应 + 全量确定性视图 + 全部派生 actionables，各自带稳定来源标记。
- 现有 143 测试全绿 + 新增测试通过；客户端构建通过。

---

## 8. 实施记录（与提案的差异）

- **revision 采用任务表面指纹，而非单调计数器**：`store.esrFingerprint(workspace)` 对
  id/state/evidence/认领人排序后 sha256 前缀（`hashText`）——零持久化、跨重启一致、时间戳天然排除
  （提案 §4「决定在实施时定」：计数器 vs 指纹 → 选指纹；持久化 → 不持久化全量兜底）。
- **`[ESR]` 头部把 draft 单列**：`tasks: N active / M stable / K draft`（N 不含 draft，避免歧义）。
- **`esr_status` 响应统一走 `buildEsrStatusView`**（index-block.js 导出）：始终重算 actionables
  （易变部分——balance/stale 窗口），`since_revision` 只短路**状态视图**；actionables 在
  unchanged 分支仍会返回。
- **gui/api 的 `renderEsrBlock` 变为纯快照**（hint-free），与冻结前缀一致；预览即真值。
- **测试**：143 → 148（新增：指纹时间戳排除、buildEsrStatusView 全量/增量/过期、方法论字节恒定、
  快照 hint-free 确定性）；`trigger.test.mjs` 全部提示测试改走 `esrHintLines` / `buildEsrStatusView`。

### 8.5 再修订：混合方案（提升行为主动性，用户二轮拍板）

- 用户反馈：纯拉取让「主动建任务/实体/关系」不保证（模型不调 `esr_status` 就看不到提示）。
  批准混合：`[ESR]` 块 = **冻结快照 + 本会话单调追加的 actionables**。
- **实现是「单调渐进」而非字面「会话开始冻结一次」**：会话第一帧装配时 recorder 还是空的，
  字面冻结等于没提示。正确做法是每条 actionable 在它成熟的那一刻（如模型写完 todo 计划后的
  下一轮）被 `esrHintLines` 一次性产出 → 追加进块并永久冻结（`holder.actionables` 按 kind 存储、
  `ESR_HINT_ORDER` 固定排序），永不回撤 → 前缀只在「真正出现新决策点信息」时变化一次。
- 若干细节：`buildFrozenEsrBlock(store, ws, config, {recorder, sessionId, holder})` 是宿主装配入口；
  `[ESR]` 不再用 WeakMap 缓存（渲染是纯确定性派生，变化只来自新 actionables）；
  快照本体保持 hint-free（GUI 预览 `renderEsrBlock` 仍是纯快照）；
  `esr_status` 保持纯拉取（实时状态 + 会话中后期才成熟的派生）。
- 测试：新增「快照纯净 + actionables 单次追加」「单调增长 / 已追加不回撤」、「无 recorder 状态时纯快照」。
- 文档：README.zh/README.md/FEATURES.zh.md 的 0a 章节改为混合语义，注入块示例含
  `# this-session actionables (frozen)`。
