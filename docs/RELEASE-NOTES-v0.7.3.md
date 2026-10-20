# dsh-engram v0.7.3

自 v0.7.2 以来：**设置卡搬到「Engram 记忆 → 设置」tab**——DSH 0.2.1 删掉了
`settings.plugin.item` 槽位，旧位置不再渲染，卡片在 GUI 里彻底不可见（宿主 API
`/api/dsh-engram/settings` 一直正常，只是没有挂载点）。

## 根因

`settings.plugin.item` 是 DSH ≤0.2.0 时代「插件 → 插件配置」tab 的插槽；`0.2.1-rc.2`
把插件配置改成按 entry-id 的通用表单（插件管理页里的行详情），旧插槽在运行时不再声明
（只剩 `dsh-client-ui-settings-models` 里的一份类型声明）。插件把卡片注册进这个槽位，
`ctx.slots.inject` 因此在浏览器里静默失败，卡片从未挂载——用户看到的
「Engram 记忆」页只有 记忆 / ESR / 注入预览 / 遥测 四个 tab。

## 改动

- 「Engram 记忆」页新增 **「设置」tab**，直接渲染同一张 `EngramConfigCard`（默认展开）；
  共享 `EngramScopeImpl`（`/api/dsh-engram/settings`）传输，读写落在同一份 DSH 设置文档，
  写回后 loader 提交 volatile ref → 插件热同步 `resolved`（与之前完全一致）。
- `EngramConfigCard` 新增 `defaultOpen`：设置页里展开，旧槽位里保持折叠的旧行为。
- 保留 `settings.plugin.item` 注册（DSH ≤0.2.0 上仍可见），失败仍只 `console.warn`。
- 设置 tab 下隐藏顶部「工作区」筛选（该 view 与工作区无关）。
- 文档：README 中英改为「设置 → Engram 记忆 → 设置 tab」，并注明旧座位仅 DSH ≤0.2.0。

## 验证

`npm run typecheck` 干净；`npm test` 406/406；`npm run build:client` 重新产出
`lib/client.js`（设置 tab、`setView("config")`、`defaultOpen` 均在产物中）；
`/api/dsh-engram/settings` 实测返回 `autoWebCompaction=true · gcReplacesCompaction=true ·
gcNarrative=true`（与 profile patch 一致，无「卡片说 false、实际 true」的分裂）。
