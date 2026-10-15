## dsh-engram v0.5.0

DSH 0.2.x 兼容修复版：`0.1.7` 起 `@deepseek-ai/dsh-settings` 移除了
`settings.installSection`，设置卡改为**条目式 volatile Config** 模型；本版本把设置
绑定迁移到新模型（entry-id `engram`），并把声明范围修到能覆盖 DSH `0.2.x` 全系，
使插件在最新 DSH 上恢复加载与设置卡读写。

### 功能

- **DSH ≥0.1.7 / 0.2.x 设置模型支持** — 插件 `Config`（`lib/index.js` 导出的
  `Config`）声明全部 48 个 DEFAULTS 键；27 个 GUI 旋钮为 `.volatile()` 字段，
  设置表单由 DSH 以 profile 条目 id `engram` 对外提供，卡片编辑经
  `loader/volatile-update` **热提交**到运行配置（新会话即时生效，已冻结块保持
  冻结——插件既有契约）。其余键普通声明，profile patch 里的内部旋钮不再被校验丢弃。
- **双代际特性检测** — `installEngramSettings` 自动识别宿主：DSH `≤0.1.5`
  回退旧的 `settings.installSection` 命名空间（`dsh-engram`），行为与 0.4.0 完全
  一致；`≥0.1.7` / `0.2.x` 走新模型（无挂载调用）。HTTP wire 命名空间两代际都保持
  `dsh-engram`，**客户端 bundle 零改动**。

### 修复

- **版本范围**：`engines.dsh` + 5 个 `@deepseek-ai/dsh-*` peer 从
  `>=0.1.2-alpha.2 <0.2.0-0` 修正为 `>=0.1.2-alpha.2 <0.3.0-0`——原范围把
  DSH `0.2.0-rc.x` 全部排除（semver 预发布窗口），插件在最新 DSH 上被兼容门槛拒绝。
  新范围已用 DSH 自身的 `includePrerelease` 检查实测：`0.2.0-rc.2` 与整个 `0.2.x`
  线放行，`0.3.0-0` 拒绝。
- **宿主设置崩溃**：移除对已不存在的 `settings.installSection` 的无条件调用
  （其在 `dsh-settings 0.1.7-alpha.2` 起被删除），改为特性检测。
- **`boundaryPruneThresholdChars` 默认 `null` → `0`**：与设置卡长期使用的
  “0=用宿主 8192” 语义一致（`0` 与 `null` 在剪枝判定中等价），并让 describe 的
  表单值完整包含该键。

### 其他

- 测试 329/329 通过（新增 `test/settings-v2.test.mjs` 6 个用例，覆盖 volatile
  Config 校验/解包/热同步与两代际安装路径；`test/api.test.mjs` 随 ns 语义更新）。
- settings 投影与写路径针对真实 `dsh-settings 0.2.0-rc.2` 工具函数
  （`volatileForm`/`projectForm`/`isVolatilePath`/`plainConfig`）验证；
  真实 cordis 4.0.4 集成验证 Config 校验与热提交。
- **真机烟测通过**（隔离 profile，`dsh 0.2.0-rc.2`，`--port 3099`）：插件启动无
  版本拒绝、`/api/dsh-engram/settings` 提供 27 键表单、
  GET → PUT（mutate，revision 0→1）→ unset 往返落盘并读回。
- `scripts/prepublish-check.mjs` 随新导出面与 peer 范围更新，`prepublishOnly`
  在 0.2.x peer 集上通过。

## DSH 版本支持

- **支持的 DSH 范围**：>=0.1.2-alpha.2 <0.3.0-0
- **peer 声明**：
  - `@deepseek-ai/dsh-compaction`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-compaction-basic`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-llm`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-settings`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-storage-domain`: `>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh-v0.2.0-rc.2`（全局 DSH CLI，并针对真实
  `dsh-settings` / `cordis` / `schemastery` 依赖集）
- **最后验证日期**：2026-10-15
- **安装方式已验证**：`dsh plugin --profile web add dsh-engram`
