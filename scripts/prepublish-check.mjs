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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "dsh-engram-pack-"));
const PEERS = [
  "@deepseek-ai/cordis@^4.0.1",
  "@deepseek-ai/dsh-settings@^0.1.0-rc.7",
  "@deepseek-ai/dsh-storage-domain@^0.1.0-rc.7",
  "@deepseek-ai/schemastery@^3.18.1",
];

function sh(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

/** Newest mtime (ms) of any client source file under `dir` (recursive). */
function newestSourceMtime(dir, acc = 0) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      acc = newestSourceMtime(p, acc);
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
      acc = Math.max(acc, statSync(p).mtimeMs);
    }
  }
  return acc;
}

/**
 * 0. Fail the publish when the shipped client bundle is stale — the exact
 *    0.3.4-class hazard (edit client/src, forget `npm run build:client`,
 *    publish an old GUI). Cheap, and saves a broken release.
 */
function assertClientBundleFresh() {
  const newestSrc = newestSourceMtime(join(root, "client/src"));
  if (newestSrc === 0) return;
  for (const bundle of ["lib/client.js", "lib/esrModel.mjs"]) {
    const p = join(root, bundle);
    if (!existsSync(p)) throw new Error(`${bundle} is missing — run \`npm run build:client\` before publishing`);
    if (statSync(p).mtimeMs < newestSrc) {
      throw new Error(`${bundle} is stale (a client/src file is newer) — run \`npm run build:client\` before publishing`);
    }
  }
}

try {
  assertClientBundleFresh();

  // 1. pack. npm publish --dry-run propagates npm_config_dry_run into this
  //    script's child npm, which would make the nested pack a no-op — pin
  //    dry-run off explicitly so the tarball is always really produced.
  sh("npm", ["pack", "--dry-run=false", "--pack-destination", tmp], root);
  const tarball = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
  if (tarball === undefined) throw new Error("no packed tarball produced");

  // 2. install the artifact + peers into the temp dir (mirrors a real profile);
  //    --dry-run=false again because npm publish --dry-run propagates the flag
  //    into child npm and a no-op install would leave nothing to import.
  sh("npm", ["install", "--no-audit", "--no-fund", "--dry-run=false", join(tmp, tarball), ...PEERS], tmp);

  // 3. import host + client from the INSTALLED fileset (name may be scoped:
  //    @scope/pkg installs under node_modules/@scope/pkg)
  const name = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name;
  const installed = join(tmp, "node_modules", ...name.split("/"));
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const host = await import(pathToFileURL(join(installed, manifest.main)).href);
  // resolveConfig is a deliberate public export (settings test builds the
  // real DEFAULTS from it); widen the host surface consciously, not silently.
  const expected = ["apply", "inject", "name", "resolveConfig"].sort().join(",");
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
