/**
 * Workspace-key parity: session RENDER paths vs every write path.
 *
 * WHY: `workspaceKey()` is the single writer-side key — on win32 it lowercases
 * the whole path (`F:\x` → `f:\x`), because drive letters are uppercase by
 * default. A read path that uses a raw `path.resolve(cwd)` instead then looks
 * up a key nobody wrote:
 *
 *   - `[ENGRAM]` index block renders "" and `sessionCache` freezes it for the
 *     whole session — dead on Windows as shipped (issue #10);
 *   - `[RESUME]` brief is built from the same workspace, so it is silent for
 *     every Windows user even with recent episodes in the store (issue #9
 *     follow-up: "episode 已恢复，但 [RESUME] 一次都没见到");
 *   - `[ESR]` snapshot/frozen block take the workspace the same way.
 *
 * The two tests below reproduce the mismatch without a Windows host: the key
 * pair is computed with `process.platform` redefined only for that call (the
 * renderers themselves never read the platform). The last test locks the call
 * sites so a future edit cannot reintroduce a second key derivation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { workspaceKey } from "../lib/util.js";
import { openEngramDomain } from "../lib/store.js";
import { renderIndex, renderResumeBrief } from "../lib/index-block.js";

const CONFIG = {
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
};

function fakeFacility() {
  const tables = new Map();
  return {
    open(spec) {
      for (const name of Object.keys(spec.tables)) if (!tables.has(name)) tables.set(name, new Map());
      return Promise.resolve({
        table(name) {
          const map = tables.get(name);
          return {
            get: (k) => map.get(k),
            put: (k, v) => Promise.resolve(map.set(k, v)),
            delete: (k) => Promise.resolve(map.delete(k)),
            entries: () => map.entries(),
          };
        },
        close: () => Promise.resolve(),
      });
    },
  };
}

/** Run `fn` while `process.platform` reads as `value` (restored afterwards). */
function withPlatform(value, fn) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

/* A POSIX-shaped absolute path that exercises the same mechanism as
 * `F:\wendang\...`: on win32 the writer lowercases the whole key. */
const CWD = "/tmp/Ws/Proj";
const windowsKeys = () =>
  withPlatform("win32", () => ({ stored: workspaceKey(CWD), raw: resolvePath(CWD) }));

test("precondition: on win32 the writer key and a raw resolve disagree", () => {
  const { stored, raw } = windowsKeys();
  assert.notEqual(stored, raw, "the Windows bug depends on these differing");
  assert.equal(stored, raw.toLowerCase());
});

test("renderIndex finds rows stored under workspaceKey (issue #10)", async () => {
  const { stored, raw } = windowsKeys();
  const d = await openEngramDomain(fakeFacility());
  const { stored: row } = await d.storeMemory(
    { workspace: stored, kind: "fact", text: "windows index probe", tags: ["probe"], sessionId: "s1" },
    CONFIG,
  );

  // The bug shape: keyed by the raw path, the renderer sees an empty workspace
  // — which is what every Windows user got (and then the empty string is
  // frozen into sessionCache for the rest of the session).
  assert.equal(renderIndex(d, raw, CWD, CONFIG), "");

  const block = renderIndex(d, stored, CWD, CONFIG);
  assert.match(block, /^\[ENGRAM\] workspace: Proj/);
  assert.match(block, new RegExp(`#${row.id.slice(0, 8)}`));
});

test("renderResumeBrief sees an episode stored under workspaceKey (issue #9)", async () => {
  const { stored, raw } = windowsKeys();
  const now = new Date("2026-11-06T14:20:19").getTime();
  const d = await openEngramDomain(fakeFacility());
  await d.storeMemory(
    {
      workspace: stored,
      kind: "episode",
      text: "session episode 2026-11-06 14:18: files a.ts · open ship",
      tags: ["episode"],
      sessionId: "s1",
      createdAt: now - 3600_000,
    },
    CONFIG,
  );

  assert.equal(renderResumeBrief(d, raw, {}, { now }), "", "raw-keyed lookup is the silent case");
  const brief = renderResumeBrief(d, stored, {}, { now });
  assert.match(brief, /^\[RESUME\] last episode/);
  assert.match(brief, /files a\.ts/);
});

test("source invariant: the session workspace is derived with workspaceKey only", () => {
  const source = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /resolvePath\(cwd\)/, "no raw path.resolve on a session cwd");
  assert.doesNotMatch(source, /from "node:path"/, "lib/index.js needs no node:path at all");
  const uses = source.match(/wk\(cwd\)/g) ?? [];
  assert.ok(uses.length >= 4, `expected the render paths + ledger to share wk(cwd) (got ${uses.length})`);
});
