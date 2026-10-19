## dsh-engram v0.7.0

自 v0.6.0 以来：把「记忆」从**事件记录**推进到**可维护的当前真相**——会话结束自动沉淀
episode、新会话给恢复简报、`esr_node` 升级为实体页、文件锚点让过期真相可被检测。

### 功能

- **会话 episode（v0.7-A）** — `session/disposed` 时用零 LLM 规则把事件日志压成一条紧凑
  纪要：改过哪些文件、跑过哪些命令、哪些失败后修复（`cmd×N→fixed`）、git commit 主题、
  仍挂着的 todo。只在有实质内容时写（纯 `ls` 会话不写），**永不进 `[ENGRAM]` 索引**，
  每个 workspace 保留最近 20 条。
- **恢复简报（v0.7-D）** — 新会话第一次组装时，取最近 7 天最新的 episode，注入
  ≤240 字符的 `[RESUME]` 行 + `engram_detail` 指针；与 `[ENGRAM]`/`[RECALL]` 一起按会话冻结。
  没有近期 episode 就不注入。
- **实体页 + 实体卡（v0.7-B）** — `esr_node` 升级为可读页面：`truth`（preference 优先、
  superseded 剔除）/ `timeline` / `open loops`（active 任务 + 证据缺口）/ `conflicts`
  （无序对去重）/ `relations`。`[ENGRAM]` 为活跃实体前置最多 2 张一行卡
  （truth 首条 + mem/open + 下钻指针），被代表的实体不再重复平铺行；
  `engram_detail(entity="<name|id>")` 返回完整页。
- **可重验证锚点（v0.7-C）** — 带 `filePath` 的记忆在写入时记录
  `{path, mtimeMs, size, hash?}`（≤256KB 存 sha256）；会话启动时有界重验证（≤40 条），
  文件改动/缺失 → 打 `stale` 标签，索引与实体 truth 不再展示，timeline 标注 `· stale`，
  `engram_detail` 仍可重取（不删除）。
- **分层 TTL（v0.7-C）** — `preference` / `procedure` 永久；`episode` 14 天；`error` 60 天；
  其余按 `expireDays`（默认 180 天）。仍然只有 GC 归档、没有硬删。

### 兼容性说明

- 存储 schema 只**新增**字段：`memories.anchor`（nullable，默认 null）与新的 memory kind
  `episode`。旧数据读取自动补默认值，无需迁移；真实实例冒烟用 256 条既有记忆验证通过。
- 只有**新写入**且带 `filePath` 的记忆会落锚；既有记忆不会被回溯锚定（避免一次性把历史
  事实全部标 stale）。需要时可后续加显式 backfill 命令。
- 新增设置键（均默认开）：`episodeEnabled`、`resumeBriefEnabled`、`entityCardsEnabled`、
  `anchorRevalidate`；隐藏可调 `episodeMaxPerWorkspace`、`resumeBriefMaxAgeDays`、
  `resumeBriefMaxChars`、`entityCardsMax`、`entityCardChars`、`episodeTtlDays`、
  `errorTtlDays`。GUI 旋钮总数 34。
- 升级后需重启 `dsh web`；episode 要等一个会话结束、resume brief 在下一个新会话生效。

### 其他

- 测试 **381/381**（新增 episode 9 例、entity 7 例、anchor 6 例）；`npm run eval` BENCH PASS；
  `npm run typecheck` 通过；`lib/client.js` 重建。
- 文档：中英 README（episode / 实体页 / 锚点三节）、`docs/PROPOSAL-evolution.zh.md`
  （v0.7 A/B/C/D 状态）、设置卡新增「会话纪要 / 恢复简报 / 实体卡」开关。

## DSH 版本支持

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **peer 声明**：
  - `@deepseek-ai/dsh-compaction`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-compaction-basic`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-llm`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-settings`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-storage-domain`: `>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh 0.2.0-rc.2`
- **最后验证日期**：2026-10-19
- **安装方式已验证**：`dsh plugin --profile web add dsh-engram`
