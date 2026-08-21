/**
 * dsh-engram filePath anchor tests (assessment P1 — coding-value add).
 *
 * filePath anchors a memory to a file. Deterministic, zero-LLM:
 *   1. stored on create (and defaulted null);
 *   2. SAME-FILE error revival uses a looser overlap threshold (0.35 vs 0.6)
 *      — a same-file re-run that drifts in wording is still the same root
 *      cause; a different file with equal wording stays its own memory;
 *   3. engram_store file_path arg lands in the store;
 *   4. recall/detail render the path;
 *   5. auto-capture stamps filePath for file edits/reads/errors.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { makeCaptureHandler } from "../lib/capture.js";
import { registerTools } from "../lib/tools.js";

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

const CONFIG = {
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
  maxRecallPerSession: 3,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("filePath: stored on create, null by default", async () => {
  const d = await openEngramDomain(fakeFacility());
  const withPath = await d.storeMemory(
    { workspace: "/w", kind: "error", text: "npm build tsc exploded", tags: [], sessionId: "s", seq: 1, filePath: "/src/a.ts" },
    CONFIG,
  );
  assert.equal(d.getMemory("/w", withPath.id).filePath, "/src/a.ts");
  const plain = await d.storeMemory(
    { workspace: "/w", kind: "fact", text: "plain memory without file", tags: [], sessionId: "s", seq: 2 },
    CONFIG,
  );
  assert.equal(d.getMemory("/w", plain.id).filePath, null);
  await d.close();
});

test("filePath: same-file revival uses the looser overlap gate", async () => {
  const d = await openEngramDomain(fakeFacility());
  const write = (text, filePath, seq) =>
    d.storeMemory({ workspace: "/w", kind: "error", text, tags: [], sessionId: "s", seq, filePath }, CONFIG);
  const aText = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
  const bText = "alpha bravo charlie delta echo mike november oscar papa quebec romeo sierra"; // ~0.5 overlap

  const first = await write(aText, "/src/a.ts", 1);
  // Same file, wording drifts ~50%: still the same root cause → revived row.
  const same = await write(bText, "/src/a.ts", 2);
  assert.equal(same.revived, true);
  assert.equal(same.id, first.id, "same-file near-repeat revives, no new row");
  assert.equal(d.listMemories("/w").length, 1);
  assert.equal(d.getMemory("/w", first.id).hits, 1);

  // Different file, identical wording: NOT the same root cause → own memory.
  const other = await write(bText, "/src/b.ts", 3);
  assert.ok(!other.revived, "create path has no revived flag");
  assert.equal(other.duplicated, false);
  assert.equal(d.listMemories("/w").length, 2);
  assert.equal(d.getMemory("/w", other.id).filePath, "/src/b.ts");

  // NOTE: filePath is a LOOSENING gate, never a tightening one — a >=0.6
  // overlap revives across files too (old semantics); the sub-0.6 cross-file
  // case is asserted above via `other`.
  await d.close();
});

test("filePath: engram_store file_path arg lands + recall renders it", async () => {
  const d = await openEngramDomain(fakeFacility());
  const service = { config: CONFIG, getDomain: () => Promise.resolve(d), openedDomain: () => d, log: { warn: () => {} } };
  const tools = new Map();
  const ctx = { effect: (fn) => fn(), tools: { register: (t) => { tools.set(t.name, t); return () => {}; } } };
  registerTools(ctx, service);
  const agent = { session: { id: "s1", header: { cwd: "/w" }, events: { length: 5 } } };

  const out = await tools.get("engram_store").execute(
    { text: "handlers.ts keeps failing on the token parse", kind: "error", file_path: "/src/handlers.ts" },
    { agent, signal: undefined },
  );
  assert.match(out, /stored|memory/);

  const mems = d.listMemories("/w");
  assert.equal(mems.length, 1);
  assert.equal(mems[0].filePath, "/src/handlers.ts");

  const rec = await tools.get("engram_recall").execute({ query: "handlers token parse" }, { agent, signal: undefined });
  assert.match(rec, /\/src\/handlers\.ts/, "recall line renders the file path");
  await d.close();
});

test("filePath: auto-capture stamps file edits and errors", async () => {
  const d = await openEngramDomain(fakeFacility());
  const log = { warn: () => {} };
  const handler = makeCaptureHandler(d, CONFIG, log);
  const agent = { session: { id: "sess", header: { cwd: "/ws" }, events: { length: 10 } } };
  handler(
    { name: "str_replace_editor", agent, arguments: { command: "str_replace", path: "/ws/AGENTS.md" } },
    { isError: false },
  );
  handler(
    { name: "str_replace_editor", agent, arguments: { command: "str_replace", path: "/ws/lib/util.js" } },
    { isError: true, value: { stderr: "oops syntax" } },
  );
  await sleep(60);
  const mems = d.listMemories("/ws");
  const edit = mems.find((m) => m.text.includes("AGENTS.md"));
  const err = mems.find((m) => m.text.includes("failed"));
  assert.equal(edit?.filePath, "/ws/AGENTS.md");
  assert.equal(err?.filePath, "/ws/lib/util.js");
  await d.close();
});
