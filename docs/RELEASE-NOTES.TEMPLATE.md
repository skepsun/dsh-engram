# Release Notes 模板（每次发布必用）

每个 GitHub Release 正文都应包含以下区块。**「DSH 版本支持」一节为必填**，
其余按发布内容填写。版本支持信息从 `package.json` 读取，避免手写漂移：

```sh
# 直接生成「DSH 版本支持」markdown 段（读 package.json 的 engines.dsh + peers）
npm run dsh-engram:release-notes
# 或
node scripts/gen-release-notes.mjs
```

---

## 模板正文（复制后填空）

```
## dsh-engram v<版本号>

<一句话：自上一个版本以来的主题>

### 功能
- ...

### 修复
- ...

### 其他
- ...

## DSH 版本支持（必填）

- **支持的 DSH 范围**：`<复制自 package.json engines.dsh，如 >=0.1.2-alpha.2 <0.2.0-0>`
- **验证版本**：`<如 dsh-v0.1.5-alpha.1>`（本地 deepseek-harness checkout）
- **最后验证日期**：`<YYYY-MM-DD>`
- **安装方式已验证**：`<如 dsh plugin --profile web add dsh-engram>`
- **peer 声明**：`<复制自 package.json peerDependencies 中的 @deepseek-ai/dsh-* 范围>`

> ⚠️ 新旧分界：DSH `0.1.2-alpha.2` 起 settings/client API 族大改
> （`@deepseek-ai/dsh-settings` 移除 `settingsNamespace`/`installSettingsSection`，
> 改 `settings.installSection`；client 注入集从 `dsh-client-runtime` 换到
> `dsh-api-remotes` 等；cordis `^4.0.2`、schemastery `^3.18.2`）。
> 若本版本仍声明 peers `^0.1.0-rc.7`，说明它**只支持旧版 DSH**
> （≤ `0.1.1-rc.2`），正文必须写明「仅支持旧版 DSH」并用上面第一段替换当前示例。
```

---

## 历史版本口径（补注用，legacy releases 说明）

已发布版本 `0.2.0` … `0.3.6` 的 Release/README 如果缺失 DSH 兼容说明，统一补这
一段：

```
## DSH 版本支持

- **支持的 DSH 范围**：仅旧版 —— `0.1.0-rc.7` / `0.1.0-rc.8` / `0.1.1-rc.1` / `0.1.1-rc.2`
- **peer 声明**：`@deepseek-ai/dsh-*@^0.1.0-rc.7`
- ⚠️ DSH `>=0.1.2-alpha.2` 与本版本**不兼容**（settings/client API 族在该版本断裂）。
  如需新版 DSH，请升级插件到 `master` 的下一个发布。
```

## dsh-market 兼容信息格式参考

- 包清单的版本兼容字段是 **semver 范围**：`package.json` / `dsh.plugin.json` 的
  `engines.dsh`（如 `">=0.1.5-alpha.2"` 或 `"0.1.0-rc.6 || 0.1.2-rc.1"`）。
- 市场侧 README 公约（`## Compatibility` 段）：
  `DSH 版本` · `最后验证日期` · `安装方式已验证`。
