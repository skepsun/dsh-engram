/**
 * dsh-engram capture tests — failing test runs become high-signal `test`
 * memories; successful or non-test failures stay on the generic path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { makeCaptureHandler } from "../lib/capture.js";

const CONFIG = {
  autoCapture: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
  sessionSearch: true,
  maxRecallPerSession: 3,
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

test("failing npm test is captured as a test-tagged error memory", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const handler = makeCaptureHandler(domain, CONFIG, { warn: () => {} });
  handler(
    { name: "bash", agent: agent(), arguments: { command: "npm test" } },
    { isError: true, value: { stderr: "> dsh-engram@0.3.4 test\n/node --test ...\nnot ok 3 - recall ranks recency\n# fail 1\nAssertionError: expected 2 to equal 3" } },
  );
  await settle();
  const m = domain.listMemories("/ws");
  assert.equal(m.length, 1);
  assert.equal(m[0].kind, "error");
  assert.ok(m[0].tags.includes("test"));
  assert.ok(m[0].tags.includes("auto-captured"));
  assert.match(m[0].text, /^tests failed \(npm test\):/);
  assert.match(m[0].text, /not ok 3|fail 1|AssertionError/);
  await domain.close();
});

test("failing node --test and vitest are also captured; build failure is not", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const handler = makeCaptureHandler(domain, CONFIG, { warn: () => {} });
  handler(
    { name: "bash", agent: agent(), arguments: { command: "node --test test/retention.test.mjs" } },
    { isError: true, value: { stderr: "# fail 2\n✗ retention ranks by access" } },
  );
  handler(
    { name: "bash", agent: agent(), arguments: { command: "npx vitest run" } },
    { isError: true, value: { stderr: "Test Files  1 failed (1)\nAssertionError: expected true" } },
  );
  // A failing build is an error, but not a test-run failure.
  handler(
    { name: "bash", agent: agent(), arguments: { command: "npm run build" } },
    { isError: true, value: { stderr: "tsc: error TS2304: cannot find name 'x'" } },
  );
  await settle();
  const texts = domain.listMemories("/ws").map((m) => m.text);
  assert.ok(texts.some((t) => t.startsWith("tests failed (node --test):")));
  assert.ok(texts.some((t) => t.startsWith("tests failed (npx vitest):") || t.startsWith("tests failed (npm vitest):")));
  assert.ok(texts.some((t) => t.startsWith("bash failed:") && !t.startsWith("tests failed")));
  const testTags = domain.listMemories("/ws").filter((m) => m.tags.includes("test"));
  assert.equal(testTags.length, 2);
  await domain.close();
});

test("a passing test run is never captured", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const handler = makeCaptureHandler(domain, CONFIG, { warn: () => {} });
  handler(
    { name: "bash", agent: agent(), arguments: { command: "npm test" } },
    { isError: false, value: { stdout: "# tests 172\n# pass 172\n# fail 0" } },
  );
  await settle();
  assert.equal(domain.listMemories("/ws").length, 0);
  await domain.close();
});

test("failing test without a failure-y line still captured with the result head", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const handler = makeCaptureHandler(domain, CONFIG, { warn: () => {} });
  handler(
    { name: "bash", agent: agent(), arguments: { command: "npm test" } },
    { isError: true, value: { stderr: "some opaque crash without keywords" } },
  );
  await settle();
  const m = domain.listMemories("/ws")[0];
  assert.match(m.text, /^tests failed \(npm test\):/);
  assert.match(m.text, /some opaque crash/);
  await domain.close();
});
