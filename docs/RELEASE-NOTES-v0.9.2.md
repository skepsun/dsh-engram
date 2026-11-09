# dsh-engram v0.9.2

**客户端第一次有了语言层。代价是 bundle 从 291KB 涨到 415KB——这笔账记在减法债上，不假装没发生。**

0.9.1 之后合并的贡献者 PR #11（@maxadrom）把浏览器侧所有文案从「各组件各写各的中文字符串」
收进一张 msgid 目录，并带上第一份完整译文（俄语，457 条）。宿主侧只多了一条读路径，
服务端行为、配置键、数据格式都没动。

## 功能

- **客户端文案走 msgid 目录**（gettext 风格，以中文源文为 key）：`tr(key, params)`，
  未知 key 渲染中文源文而不是 `missing.key` —— 没翻译到的地方退化成原文，不会在界面上
  露出占位符。
- **俄语目录 457 条**（`client/src/i18n/ru.ts`）；`entry.tsx` 向 DSH locale 服务注册
  `{ zh, en, ru }`，日期格式化跟随 active locale，切语言时 DOM 挂载面通过
  `locale.subscribe` 重渲染。
- **常驻摘要按需渲染**：`/api/dsh-engram/model` 接受 `?lang=`，GUI 拿到自己语言的那份；
  缓存行和 `esr_model` 工具保持默认文案——**模型看到的输出不随浏览器语言变化**。
- **模板字符串可重排占位符**：`tr("已沉淀 {0} 项", { "0": n })`，译文不必迁就中文语序。
- **维护工具**：`npm run i18n:wrap` / `npm run i18n:check`（需要 `tools/.toolchain` 里的
  TS 5 编译器 API，README 写了 bootstrap 命令）。

## 这次改了、但没有改的

三条边界，都是**有意**的：

- `en` 仍然只有 3 个壳级 key（`nav` / `refresh` / `error`），msgid 文案回落中文——与这一层
  存在之前完全一致，不是回归。
- 服务端另有一张 zh/ru 文案表在 `lib/mental.js`：常驻摘要的正文不在目录里，将来 `en`
  目录落地时它会是唯一不跟随的面。
- 少数字面量留在 JSX 注释和壳字典里，`i18n:check` 之外我用启发式扫过一遍 `client/src`，
  没有漏掉的用户可见文案。

## 代价

| | v0.9.1 | v0.9.2 |
|---|---|---|
| `lib/client.js` raw | 298 476 B（291 KiB） | 425 128 B（415 KiB） |
| `lib/client.js` gzip | 61 056 B（59.6 KiB） | 84 572 B（82.6 KiB） |

gzip 增量 23.5KB（+38.5%），其中约八成是译文数据本身：编译后的 `ru.ts` 单独就占
18 508 B gzip。0.9.0 的发布说明把「client bundle <150KB」列在减法债里，这一版把它推远了。

出路是按 active locale 动态 `import()` 目录——机制已经支持（目录就是一张表 + 一个
`register` 条目），中文用户不必为俄语文本付费。这条记进待办。

## 其他

- 合并时 `package.json` 与 master 的 `host:probe` 脚本冲突（双方各追加 script 行），
  保留双方三行，没丢任何一方；合并树全量门重跑过，见下。
- **本版无服务端行为变化**：`lib/` 只新增了那条 `?lang=` 读路径。配置键与数据格式与
  `0.9.1` 一致，无需迁移。
- 0.9.1 修的 #10 / #12 / #13 已在 npm 上，三个 issue 已按各自的验证口径关闭。
- `host:probe` 里那个假 session 被发现太假：真 tokenMeter 要经 session-projection 折
  `snapshotEvents()`，缺这些方法时探针会先死在宿主侧、根本没走到引擎读 ctx。补全 session
  面之后连跑两次稳定复现，`--tgz` 对照也仍按预期失败——探针自己先得过自证。

## DSH 版本支持

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **peer 声明**：
  - `@deepseek-ai/dsh-compaction`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-compaction-basic`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-llm`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-settings`: `>=0.1.2-alpha.2 <0.3.0-0`
  - `@deepseek-ai/dsh-storage-domain`: `>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh 0.2.1-rc.2`（本机 CLI + web）
- **最后验证日期**：2026-11-09
- **安装方式已验证**：`dsh plugin --profile <name> add <tgz|dsh-engram>`

## 验证

```
npm test          → 536 tests, 534 pass
                    （2 个失败仅 test/g6-sandbox.test.mjs：需要 OS 级 fence，本机没有，
                      父提交上同样失败）
npm run typecheck → ok
npm run build:client → 无 diff（bundle 与提交产物逐字节一致，425 128 B）
npm run prepublishOnly → packed tarball 里 host + client bundle 双入口 import OK
npm run host:probe → exit 0（真 dsh 宿主上 compactIfNeeded("pressure") 跑通；
                      `--tgz` 换回 0.9.0 的 tarball 仍复现 `cannot get property "tokenMeter" without inject`）
npm pack          → 504.0 kB / 97 files（client bundle 425128 bytes）
```
