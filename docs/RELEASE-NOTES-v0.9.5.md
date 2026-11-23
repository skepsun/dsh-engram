# dsh-engram v0.9.5

收口两个来自真实使用的闭环缺口：**已关闭 draft 被 todo-sink 反复复活（#17）**，以及 **渲染层静默空块不可观测 / G5 门离线不可测**。

## 改动

### 1. `todo-sink` 去重覆盖近期已关闭（`stable`）任务（issue #17）

- `lib/todo-sink.js`：`sinkPendingTodos()` 查询任务时改为 `listTasks(workspace, { includeStable: true })`；`planTodoSink()` 对最近 **14 天**内关闭（`state: "stable"`，优先按 `stateChangedAt` 判断，回退 `updatedAt` / `createdAt`）的同名任务同样纳入去重（`DEFAULT_STABLE_DEDUPE_DAYS = 14`，可通过 `opts.stableDedupeDays` 覆盖）。
- 已关闭的 `stable` 任务仍不计入 `maxTasksPerWorkspace` 活跃任务配额，不影响其他新待办沉淀。
- 超过 14 天时间窗后，真正的周期性同名任务仍可正常重新沉淀。
- `test/todo-sink.test.mjs` 新增 3 条回归测试（含 #17 端到端复现）。

### 2. 渲染层遥测补盲 + G5 门离线可测

- `lib/push-legs.js`：`noteSessionEventsSource()` 与 `push-legs.jsonl` 新增可选的 `workspace` 与渲染字段 `engramChars` / `resumeChars` / `recallChars` / `workspaceMemories`（完全向后兼容旧记录）。
- `lib/index.js`：在 `blockFor()` 完成装配后按会话记录一次推送腿 + 渲染层字节数（即便 `autoRecallOnStart` 关闭也会记录）。
- `dsh-engram status`（`describePushLegs`）现在直接展示各块渲染字节数；当工作区库内有活跃记忆但 `[ENGRAM]` 渲染为 `0c` 时直接打出告警 `⚠ 库有 N 条记忆但 [ENGRAM]=0c`，堵住此前 #9/#10 暴露的「事件日志正常、渲染层静默空块」观测盲区。
- `eval/gate-audit.mjs`：离线模式（未传 `--api`）下读取 `push-legs.jsonl` 的非空 `engramChars` 最大值判定 **G5（索引 ≤ 700 chars）**；传入 `--api` 时仍以实时 `/preview` 为准。
- `test/push-legs.test.mjs` 与 `test/gate-audit.test.mjs` 补齐对应单测。

### 3. 文档同步

- `README.zh.md` 补齐与 `README.md` 对齐的「宿主事件日志前提与静默休眠说明」提示块（#9）。

## DSH 版本支持

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **最后验证日期**：2026-11-23
