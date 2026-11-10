/**
 * Packaging consistency: every `scripts` entry that runs a repo-local file must
 * travel with it in `files[]` — unless the entry is declared source-only.
 *
 * The bug this pins (issue #9): `scripts.eval` pointed at
 * `eval/recall-bench.mjs` while `files[]` shipped only `eval/gate-audit.mjs`,
 * so `npm run eval` in an installed package died with MODULE_NOT_FOUND. The
 * working tree was fine; only the shipped fileset disagreed — which is why no
 * test in the repo noticed until a user ran it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/**
 * Scripts that legitimately cannot run from an installed package: they build,
 * typecheck, test or maintain the source tree itself. Anything NOT listed here
 * is treated as user-facing and must be runnable after `npm i dsh-engram`.
 */
const SOURCE_ONLY = new Set([
  "build:client", // client/src → lib/client.js (needs tools/.toolchain)
  "typecheck",
  "test",
  "i18n:check",
  "i18n:wrap",
  "quality:ab", // G6 A/B harness: eval/g6 is 5.5 MB of fixtures, runs real agents
]);

/** Repo-relative `.mjs`/`.js` paths a script command invokes. */
function localPaths(command) {
  const found = [];
  for (const match of command.matchAll(/(?:^|[\s"'=])([A-Za-z0-9_@./-]+\.m?js)(?=$|[\s"'])/g)) {
    const rel = match[1].replace(/^\.\//, "");
    if (rel.startsWith("/") || rel.includes("*")) continue; // absolute or a glob
    found.push(rel);
  }
  return found;
}

/** Does `files[]` ship this repo-relative path? (directory entry or exact file) */
function shipped(rel) {
  return (pkg.files ?? []).some((entry) => {
    const clean = String(entry).replace(/^\.\//, "").replace(/\/+$/, "");
    return rel === clean || rel.startsWith(`${clean}/`);
  });
}

test("every npm script either ships the file it runs, or is declared source-only", () => {
  for (const [name, command] of Object.entries(pkg.scripts)) {
    for (const rel of localPaths(command)) {
      if (SOURCE_ONLY.has(name)) {
        assert.equal(
          shipped(rel),
          false,
          `${name} is declared source-only but ${rel} ships — drop the declaration instead of shipping a script users cannot run`,
        );
      } else {
        assert.equal(
          shipped(rel),
          true,
          `npm run ${name} runs ${rel}, which files[] does not ship — an installed package fails with MODULE_NOT_FOUND (issue #9)`,
        );
      }
    }
  }
});

test("the source-only declaration never goes stale", () => {
  for (const name of SOURCE_ONLY) {
    assert.ok(pkg.scripts?.[name], `source-only entry "${name}" is not a script any more`);
  }
});

test("npm run eval is runnable from the published fileset", () => {
  // The one entry a reporting user is told to run. Read from scripts.eval
  // rather than hardcoding the path, so moving the bench keeps the guarantee.
  const rel = localPaths(pkg.scripts.eval)[0];
  assert.ok(rel, "scripts.eval invokes no local file");
  assert.equal(shipped(rel), true, `${rel} must be in files[]`);
});
