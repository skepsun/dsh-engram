/**
 * dsh-engram prefix-stability tests — lock the empty-branch byte invariant.
 *
 * WHY: the harness renders prompt sections with `renderPrompt` =
 *   sections.map(interpolate).filter(text => text.length > 0).join('\n\n')
 * (packages/core/system-prompt/src/index.ts). Empty sections are DROPPED —
 * zero bytes, no wrapper. That means an empty block must be EXACTLY `""`:
 * a would-be "harmless" whitespace return like `" "` is NOT filtered (its
 * length is > 0) and injects a stray blank section that drifts the prefix
 * every turn. Non-empty blocks must carry no leading/trailing whitespace so
 * the `\n\n` join is the only boundary edge.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { renderIndex, renderEsr } from "../lib/index-block.js";

const CONFIG = {
  autoCapture: true,
  sessionSearch: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
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
      for (const name of Object.keys(spec.tables)) tables.set(name, new Map());
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

test("[ENGRAM] empty workspace renders EXACTLY '' (harness drops empty sections)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const block = renderIndex(domain, "/ws", "/ws", CONFIG);
  assert.equal(block, "", "empty block must be zero bytes — a whitespace here would survive renderPrompt's length filter");
  // Deterministic across calls (frozen-prefix premise).
  assert.equal(renderIndex(domain, "/ws", "/ws", CONFIG), block);
  await domain.close();
});

test("[ENGRAM] non-empty block has no leading/trailing whitespace", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/ws", kind: "fact", text: "cache prefix stability", tags: [], sessionId: "s", seq: 1, signal: 0.7 }, CONFIG);
  const block = renderIndex(domain, "/ws", "/ws", CONFIG);
  assert.ok(block.length > 0);
  assert.ok(block.startsWith("[ENGRAM]"), "block starts at the header, no leading pad");
  assert.equal(block.trim(), block, "no surrounding whitespace");
  assert.ok(!block.endsWith("\n"), "no trailing newline");
  await domain.close();
});

test("[ESR] block is always non-empty and trimmed (never a blank orphan)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const emptyEsr = renderEsr(domain, "/ws", CONFIG);
  assert.ok(emptyEsr.length > 0, "static ESR guidance is always injected");
  assert.equal(emptyEsr.trim(), emptyEsr);
  await domain.close();
});
