# dsh-engram v0.9.6

围绕大库运维、草稿闭环与跨平台可靠性推进的一版：**`esr_drop` 轻量丢弃草稿**、**离线记忆巩固（`consolidate`）**、**1,500 条规模基准（`bench:scale`）**，以及新接入 **Windows CI** 实跑抓出并修复的一批真实 Windows 路径 bug。

## 新增与优化

### 1. `todo-sink → draft` 轻量丢弃闭环（`esr_drop`）

- **工具 & API**：新增 `esr_drop` 工具与 `POST /api/dsh-engram/tasks/drop`，无需三证即可归档不需要的 `draft` 任务并立即释放 `maxTasksPerWorkspace` 配额；对 `active` / `stable` 任务默认拒绝（传 `force: true` 才允许归档）。
- **看板 UI & i18n**：`EngramBoard` 草稿列卡片新增「丢弃草稿」按钮，同步补齐俄语翻译并重建 `lib/client.js`。
- **去重与存储修复**：
  - `lib/store.js`：`listTasks()` 新增 `includeArchived` 选项；修复 `archiveTask()` 对 `archivedAt === undefined` 的历史/自动沉淀草稿误判为已归档的问题。
  - `lib/todo-sink.js`：`sinkPendingTodos()` 去重同时覆盖近期（14 天内）被丢弃/归档的草稿，防止下一会话末复活；新建草稿显式落 `archivedAt: null`。

### 2. 离线记忆巩固（`lib/consolidate.js` / `consolidate`）

- **热路径零 LLM、默认 dry-run、仅归档不硬删**：
  - `planConsolidation()` 通过 `exportAll(workspace)` 扫描全量活跃记忆（不受 `listMemories` 200 条上限限制）：
    - 同 `(kind, entity)` 下按 token Jaccard（默认 `≥ 0.65`）聚簇近重复记忆，按「工作集受保护 > `signal` > `hits` > `createdAt`」选出保留项，被活跃任务 `memoryRefs` 引用的工作集记忆绝不归档；
    - 跨 `episode` 提炼出现 `≥ 3` 次的 `cmd×N→fixed` 修复模式与热点文件为 `procedure` / `insight`（带 `episode-rollup` 标签，二次运行幂等）。
  - `applyConsolidation()` 执行归档/提炼，并预留可选异步 `summarizeCluster(cluster)` 钩子供离线 LLM 改写接入。
- **入口**：新增 `npx dsh-engram consolidate [--workspace <dir>] [--apply] [--min-sim 0.65]`（原子落盘）与 `POST /api/dsh-engram/consolidate`。

### 3. Windows 真实 bug 修复与双平台 CI 护栏

- **新增 Windows CI 矩阵**（`.github/workflows/ci.yml`：`verify-windows`，运行 `npm test`、`npm run eval`、`npm run bench:scale`），双平台（Ubuntu + Windows）全绿。
- 修复实跑中暴露的 4 处真实 Windows 兼容 bug：
  - `lib/session-cjk.js`：`bucketFromCwd()` 折叠盘符冒号 `[:\\/]+ → -`，避免生成 NTFS 非法目录名 `--c:-...--`；
  - `lib/boundary-prune.js`：`normalizeWorkspaceKey()` 同步折叠冒号，保证 Windows 绝对路径与会话桶名归一一致；
  - `lib/api.js`：`/api/dsh-engram/stats?workspace=...` 对查询参数做 `workspaceKey` 归一化；
  - `eval/quality-ab.mjs` & `eval/g6/sandbox-profile.mjs`：改用 `fileURLToPath`、`path.delimiter` 与 `path.posix` 路径分隔符。
- **千条级规模基准**：新增 `npm run bench:scale`（`eval/scale-bench.mjs`，1,500 条中英混合噪声 + 5 条针），验证 1,323 条活跃记忆下 `Hit@1 = 100%`、`Recall@5 = 100%`、`[ENGRAM] = 670c ≤ 700c`、`recall p95 < 10ms`。

## DSH 版本支持

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **最后验证日期**：2026-11-23
