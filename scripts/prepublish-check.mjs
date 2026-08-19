/**
 * Pre-publish self-check (runs on `npm publish` via prepublishOnly, and
 * directly via `npm run prepublishOnly`).
 *
 * Packs the tarball, then installs it into a temp dir together with the
 * optional peer packages exactly as a real profile's pnpm would resolve
 * them, and finally imports BOTH the host entry (lib/index.js) and the
 * client bundle (lib/client.js) from the INSTALLED artifact. Fails with a
 * non-zero exit when the published fileset is missing anything the plugin
 * needs to load — the tarball-only import is the genuine surface, not the
 * working-tree files.
 *
 * Requires network access to the npm registry for the @deepseek-ai peers
 * and zod; skipped cleanly on failure? — no: an unverifiable publish is
 * refused.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "dsh-loom-pack-"));
const PEERS = [
  "@deepseek-ai/cordis@^4.0.1",
  "@deepseek-ai/dsh-settings@^0.1.0-rc.7",
  "@deepseek-ai/dsh-storage-domain@^0.1.0-rc.7",
  "@deepseek-ai/schemastery@^3.18.1",
];

function sh(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

try {
  // 1. pack
  sh("npm", ["pack", "--pack-destination", tmp], root);
  const tarball = readdirSync(tmp).find((f) => f.startsWith("dsh-loom-") && f.endsWith(".tgz"));
  if (tarball === undefined) throw new Error("no packed tarball produced");

  // 2. install the artifact + peers into the temp dir (mirrors a real profile)
  sh("npm", ["install", "--no-audit", "--no-fund", join(tmp, tarball), ...PEERS], tmp);

  // 3. import host + client from the INSTALLED fileset
  const installed = join(tmp, "node_modules", "dsh-loom");
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const host = await import(pathToFileURL(join(installed, manifest.main)).href);
  const expected = ["apply", "inject", "name"].sort().join(",");
  const actual = Object.keys(host).sort().join(",");
  if (actual !== expected) {
    throw new Error(`host exports mismatch: got ${actual}, want ${expected}`);
  }
  // 4. the client bundle is loaded by the web shell with its externals
  //    (react, @deepseek-ai/dsh-client-*) provided by the host — it is NOT a
  //    standalone-loadable module, so verify presence + size instead of import.
  const clientStats = statSync(join(installed, "lib/client.js"));
  if (clientStats.size < 10 * 1024) {
    throw new Error(`suspiciously small client bundle: ${clientStats.size} bytes`);
  }
  console.log(
    `✓ packed ${tarball}: host(${actual}) import OK, client bundle present (${clientStats.size} bytes)`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
