#!/usr/bin/env node
/**
 * dsh-engram release-note helper.
 *
 * Prints the required "DSH 版本支持" markdown stanza for a release note by
 * reading the single source of truth in package.json (engines.dsh + the
 * @deepseek-ai/dsh-* peers), so the declared compatibility can never drift
 * from what the package.json actually claims.
 *
 * Usage:
 *   node scripts/gen-release-notes.mjs            # print the stanza
 *   node scripts/gen-release-notes.mjs --watch    # also echo engines + peers
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const engines = pkg.engines ?? {};
const peers = pkg.peerDependencies ?? {};

const DSH_PEER_PREFIX = "@deepseek-ai/dsh-";
const dshPeers = Object.entries(peers)
  .filter(([name]) => name.startsWith(DSH_PEER_PREFIX))
  .sort(([a], [b]) => a.localeCompare(b));

const range = engines.dsh;
const legacyOld =
  !range && dshPeers.every(([, r]) => r.includes("0.1.0-rc.7"));
const supportLine = legacyOld
  ? "仅旧版 —— `0.1.0-rc.7` / `0.1.0-rc.8` / `0.1.1-rc.1` / `0.1.1-rc.2`"
  : range ?? "（package.json 未声明 engines.dsh —— 补注历史版本时按上一行规则填写）";

const peerLine = dshPeers.length
  ? dshPeers.map(([n, r]) => `  - \`${n}\`: \`${r}\``).join("\n")
  : "  - （无 @deepseek-ai/dsh-* peer 声明）";

const body = `## DSH 版本支持

- **支持的 DSH 范围**：${supportLine}
- **peer 声明**：
${peerLine}
${
  legacyOld
    ? "- ⚠️ DSH `>=0.1.2-alpha.2` 与本版本**不兼容**（settings/client API 族在该版本断裂：`@deepseek-ai/dsh-settings` 移除 `settingsNamespace`/`installSettingsSection`，改 `settings.installSection`；client 注入集换到 `dsh-api-remotes` 等；cordis `^4.0.2`、schemastery `^3.18.2`）。如需新版 DSH，请升级插件到 `master` 的下一个发布。"
    : range
      ? `- **验证版本**：<如 dsh-v0.1.5-alpha.1>（本地 deepseek-harness checkout）
- **最后验证日期**：<YYYY-MM-DD>
- **安装方式已验证**：<如 dsh plugin --profile web add dsh-engram>`
      : ""
}
`;

if (process.argv.includes("--watch")) {
  console.log(`engines.dsh = ${range ?? "<未声明>"}`);
  console.log(`engines.node = ${engines.node ?? "<未声明>"}`);
  console.log(`@deepseek-ai/cordis peer = ${peers["@deepseek-ai/cordis"] ?? "<未声明>"}`);
  console.log(`@deepseek-ai/schemastery peer = ${peers["@deepseek-ai/schemastery"] ?? "<未声明>"}`);
  console.log("---");
}
process.stdout.write(body);
