## dsh-engram v0.4.0

以 SoL-Pi(NVIDIA Labs)的 harness 效率研究为方法论起点:先量化、再造机制。本版本新增会话语料测量工具链与第一个由数据驱动的上下文效率机制。

### 功能

- **BoundaryPrune(子任务边界剪枝,默认关)** — 在 todo 完成推进 / goal 终态边界,主动调用 DSH 自带 `toolResultPruner`(确定性 surface-replace、零 LLM、replay-safe),让超阈值旧工具结果停止在后续每个请求里整段重放。含**偿还门**(预计剩余请求 < `boundaryPruneMinRemaining`(默认 50)不剪;先验下界 + ×2 外推,长会话不被挡死)、pruner 服务特性检测(缺席即禁用)、fail-contained。配置 `boundaryPrune`(默认关)/ `boundaryPruneMinRemaining`。
- **证据链工具链(eval/,零 LLM、确定性,读 ~/.dsh/sessions 真实日志)**:
  - `oracle-analysis.mjs` — 浪费源量化:结果重放暴露(97 会话实测 2.77B–7.53B 字符,96% 字节来自 bash/read/run_code,中位会话 top-10 结果占 46%)、edit→exec 融合候选、插件机制激活率、goal/todo 边界与 splice 事件捕获。
  - `simulate-boundary-prune.mjs` — L0 反事实仿真:阈值 × 边界策略 × 偿还门扫掠;todo 边界覆盖 79% 暴露,偿还门全配置提升净收益 12–32%。
  - `dryrun-boundary-prune.mjs` — BoundaryPrune 全量干跑:77 会话激活 38%,303 结果首剪 ≈3.47M 字符。
- **文档**:docs/ORACLE-ANALYSIS.zh.md(测量报告)、docs/PROPOSAL-resultpack.zh.md(接缝盘点 + L0/L1 记录;严格首插改写需上游 PR,已论证)。

### 修复

- (无 — 本版本为纯新增;boundaryPrune 默认关,不开即零行为变化)

### 其他

- 测试 279/279 过(新增 6 个 BoundaryPrune 用例);prepublishOnly 真实 tarball 安装双入口导入验证过。
- README 中英双语新增 BoundaryPrune 小节与 eval 工具说明;配置示例更新。

## DSH 版本支持

- **支持的 DSH 范围**：>=0.1.2-alpha.2 <0.2.0-0
- **peer 声明**：
  - `@deepseek-ai/dsh-compaction`: `>=0.1.2-alpha.2 <0.2.0-0`
  - `@deepseek-ai/dsh-compaction-basic`: `>=0.1.2-alpha.2 <0.2.0-0`
  - `@deepseek-ai/dsh-llm`: `>=0.1.2-alpha.2 <0.2.0-0`
  - `@deepseek-ai/dsh-settings`: `>=0.1.2-alpha.2 <0.2.0-0`
  - `@deepseek-ai/dsh-storage-domain`: `>=0.1.2-alpha.2 <0.2.0-0`
- **验证版本**：`dsh-v0.1.5-alpha.1`（本地 deepseek-harness checkout）
- **最后验证日期**：2026-09-14
- **安装方式已验证**：`dsh plugin --profile web add dsh-engram`
