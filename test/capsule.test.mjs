/**
 * v0.8-C (advisory): subagent handoff capsules.
 *
 * These tests pin the two honest claims: the capsule keeps the conclusion /
 * evidence / open questions / next step, and it says how much it compressed.
 * They do NOT claim the parent's prompt shrinks — the host exposes no
 * result-mutation channel (see lib/capsule.js).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCapsule, isSubagentTool, resultText } from "../lib/capsule.js";
import { openEngramDomain } from "../lib/store.js";
import { makeCaptureHandler } from "../lib/capture.js";

const CONFIG = {
  autoCapture: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 4000,
  maxTasksPerWorkspace: 40,
  capsuleMinSourceChars: 300,
  capsuleMaxChars: 900,
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

const settle = () => new Promise((r) => setTimeout(r, 40));
const agent = () => ({ session: { id: "s1", header: { cwd: "/ws" }, events: { length: 10 } } });

const REPORT = `## Summary

The recall benchmark reranks by recency and the fix is a stable tie-break.

- tests pass 184/184 after the change (npm test)
- touched lib/rerank.js and test/rerank.test.mjs
- open question: should BM25 weight decay with age?
- next step: measure the CI wall-clock delta

${"filler line that the capsule should drop because it carries no structure. ".repeat(20)}
Done.`;

test("capsule keeps conclusion, evidence, open question and next step", () => {
  const { capsule, sourceChars, capsuleChars } = buildCapsule(REPORT, { maxChars: 900 });
  assert.match(capsule, /\*\*结论\*\*：The recall benchmark reranks/);
  assert.match(capsule, /npm test/);
  assert.match(capsule, /\*\*未决\*\*/);
  assert.match(capsule, /should BM25 weight decay/);
  assert.match(capsule, /\*\*下一步\*\*/);
  assert.match(capsule, /measure the CI wall-clock/);
  assert.ok(!capsule.includes("filler line"), "unstructured filler is dropped");
  assert.ok(capsuleChars < sourceChars, "and it is actually smaller");
  assert.match(capsule, /胶囊：.*→.*字符/);
});

test("an unstructured report keeps both ends instead of pretending to summarize", () => {
  const text = ["first line of the report", "second line", "third line", "x".repeat(400), "last words here"].join("\n");
  const { capsule } = buildCapsule(text, { maxChars: 600 });
  assert.match(capsule, /无结构可提炼/);
  assert.match(capsule, /first line of the report/);
  assert.match(capsule, /last words here/);
});

test("capsule respects maxChars", () => {
  const long = `${"a".repeat(5000)}`;
  const { capsule } = buildCapsule(long, { maxChars: 400 });
  assert.ok(capsule.length <= 400 + 200, `capsule length ${capsule.length}`);
});

test("resultText reads string values, content blocks and nested text", () => {
  assert.equal(resultText({ value: "plain" }), "plain");
  assert.equal(resultText({ content: [{ type: "text", text: "block" }] }), "block");
  assert.equal(resultText({ value: { content: [{ type: "text", text: "nested" }] } }), "nested");
  assert.equal(resultText({ value: { text: "field" } }), "field");
  assert.equal(resultText({}), null);
});

test("only subagent tools are treated as capsule sources", () => {
  assert.equal(isSubagentTool("subagent"), true);
  assert.equal(isSubagentTool("subagent_fork"), true);
  assert.equal(isSubagentTool("bash"), false);
});

test("capture stores a long subagent report as a handoff capsule", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const handler = makeCaptureHandler(domain, CONFIG, { warn: () => {} });
  handler(
    { name: "subagent", agent: agent(), arguments: { description: "rerank review", prompt: "review rerank" } },
    { isError: false, value: REPORT },
  );
  await settle();
  const rows = domain.listMemories("/ws");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "handoff");
  assert.ok(rows[0].tags.includes("subagent-capsule"));
  assert.match(rows[0].text, /结论/);
  await domain.close();
});

test("a short subagent report is not captured (nothing to compress)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const handler = makeCaptureHandler(domain, CONFIG, { warn: () => {} });
  handler(
    { name: "subagent", agent: agent(), arguments: { description: "tiny", prompt: "x" } },
    { isError: false, value: "ok, done." },
  );
  await settle();
  assert.equal(domain.listMemories("/ws").length, 0);
  await domain.close();
});
