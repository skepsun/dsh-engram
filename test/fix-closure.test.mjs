/**
 * dsh-engram failure→fix closure tests — a command that previously failed and
 * now succeeds sediments a `procedure` memory and resolves the earlier error
 * rows. Pure reducer unit tests + makeCaptureHandler integration. Zero LLM.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { cmdTag, fixClosureEntry, makeCaptureHandler } from "../lib/capture.js";

const CONFIG = {
  autoCapture: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
  sessionSearch: true,
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

function agent(cwd = "/ws") {
  return { session: { id: "s1", header: { cwd }, events: { length: 10 } } };
}

function settle() {
  return new Promise((r) => setTimeout(r, 40));
}

test("cmdTag normalizes commands to a stable signature", () => {
  assert.equal(cmdTag("npm test"), "cmd:npm_test");
  assert.equal(cmdTag("  npm   run build --watch "), "cmd:npm_run");
  assert.equal(cmdTag(""), null);
  assert.equal(cmdTag(null), null);
});

test("fixClosureEntry fires only on success-after-failure of the same command", () => {
  const failing = [
    { id: "e1", kind: "error", status: "active", tags: ["error", "auto-captured", "cmd:npm_test"] },
    { id: "e2", kind: "error", status: "archived", tags: ["error", "auto-captured", "cmd:npm_test"] },
  ];
  // success + one ACTIVE match → procedure + that id resolved
  const fix = fixClosureEntry("bash", "npm test", { isError: false }, failing);
  assert.ok(fix !== null);
  assert.equal(fix.entry.kind, "procedure");
  assert.match(fix.entry.text, /fixed: npm test/);
  assert.deepEqual(fix.resolvedIds, ["e1"]); // archived row not resolved
  assert.ok(fix.entry.tags.includes("cmd:npm_test"));
  assert.ok(fix.entry.tags.includes("test"), "test run tagged");

  // running again after resolution is deduped at the store — reducer still fine
  const again = fixClosureEntry("bash", "npm test", {}, failing);
  assert.ok(again !== null);

  // no prior failure → null
  assert.equal(fixClosureEntry("bash", "npm test", {}, []), null);
  // still failing → null
  assert.equal(fixClosureEntry("bash", "npm test", { isError: true }, failing), null);
  // non-shell tool → null
  assert.equal(fixClosureEntry("read", "npm test", {}, failing), null);
});

test("integration: failing then passing npm test closes the loop (procedure + resolved)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const handler = makeCaptureHandler(domain, CONFIG, { warn: () => {} });

  handler(
    { name: "bash", agent: agent(), arguments: { command: "npm test" } },
    { isError: true, value: { stderr: "not ok 3 - recall ranks recency\n# fail 1" } },
  );
  await settle();
  const errors = domain.listMemories("/ws").filter((m) => m.kind === "error");
  assert.equal(errors.length, 1);
  assert.ok(errors[0].tags.includes("cmd:npm_test"), "failure carries the cmd signature");

  handler(
    { name: "bash", agent: agent(), arguments: { command: "npm test" } },
    { isError: false, value: { stdout: "pass 184\n# fail 0" } },
  );
  await settle();
  const all = domain.listMemories("/ws");
  const procedure = all.find((m) => m.kind === "procedure");
  assert.ok(procedure, "a procedure memory is sedimented");
  assert.match(procedure.text, /fixed: npm test/);
  assert.ok(procedure.tags.includes("cmd:npm_test"));

  const resolved = all.find((m) => m.id === errors[0].id);
  assert.ok(resolved.tags.includes("resolved"), "prior error is tagged resolved");
  await domain.close();
});

test("integration: a passing run with no prior failure stores nothing", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const handler = makeCaptureHandler(domain, CONFIG, { warn: () => {} });
  handler(
    { name: "bash", agent: agent(), arguments: { command: "npm test" } },
    { isError: false, value: { stdout: "pass 184" } },
  );
  await settle();
  assert.equal(domain.listMemories("/ws").length, 0);
  await domain.close();
});
