## dsh-engram v0.5.1

补丁版：修复会话日志扫描对**版本化文件名**的硬编码（issue #8，所有会话扫描
功能静默返回 0），并补齐记忆查看器的**数据导出/导入**与**替换/冲突可视化**
（issue #3 收尾）。

### 修复

- **会话扫描识别 `session.v<N>.jsonl.zstd`**（#8）—— `lib/usage.js`、
  `lib/boundary-prune.js`、`lib/session-cjk.js` 曾硬编码 `session.jsonl.zstd`；
  当前 DSH 把会话格式版本写进文件名（`0.1.x` → `session.v3.jsonl.zstd`，
  `0.2.x` → `session.v4.jsonl.zstd`），`statSync` 抛 `ENOENT` 后被循环 `continue`
  静默吞掉，导致：

  - 设置页 → 遥测恒为「样本不足（0 次）」，`GET /stats`、`GET /toolstats` 全 0；
  - BoundaryPrune 的 `workspaceHistory()`（L0 偿还输入）看不到任何会话；
  - CJK 跨会话搜索恒返回 `[]`。

  新增 `sessionLogFile(dir)`：正则匹配 `session[.v<N>].jsonl.zstd`，取目录内
  **mtime 最新**的一个（迁移会话可能 v3/v4/legacy 并存，最新 = 宿主正在追加的
  文件），无匹配时回退历史名、调用方保留原有 ENOENT 处理。四处调用点统一改用它。
  本机实测（14 天窗口）：`files 0 → 17`、`events 0 → 643`。

### 功能

- **数据备份面板**（#3）—— 设置页 → Engram 记忆 →「数据备份」：一键导出当前
  工作区（或全部）为 `dsh-engram/export` v1 JSON 并下载；导入支持 **dry-run 预览**
  → `merge`（只补缺失，幂等）/ `replace`（需勾选确认，宿主要求
  `confirm:"restore"`）。宿主端的 `GET /export`、`POST /import` 早已存在，本版只补
  GUI 入口，GUI 与 API 走同一格式。
- **替换 / 冲突可视化**（#3）—— 记忆表给被替代的旧行挂「已替换」徽标、给新行挂
  「替代 #id」跳转；记忆详情面板新增「替换 / 冲突」双向链（出边来自记录的
  `supersedes`/`contradicts`，入边由已加载列表反查），元数据露出
  `source`/`conditions`/`filePath`。

### 测试

- 334/334（新增 5 个 #8 用例：版本化/纯 legacy/v3+v4+legacy 混合/陈旧 legacy
  不遮蔽 v4/无关文件名不被误选，以及 CJK 版本化读取与 `workspaceHistory` 计数）。
- `npm run typecheck`、`npm run prepublish-check` 通过；`lib/client.js` 重新构建。

## DSH 版本支持

- **支持的 DSH 范围**：>=0.1.2-alpha.2 <0.3.0-0
- **peer 声明**：
  - `@deepseek-ai/dsh-compaction`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-compaction-basic`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-llm`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-settings`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-storage-domain`: `>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh-v0.2.0-rc.2`（与 0.5.0 相同的宿主依赖集；本版只改会话日志
  解析与纯客户端界面，未触碰设置/注入路径）
- **最后验证日期**：2026-10-19
- **安装方式已验证**：`dsh plugin --profile web add dsh-engram`
