/**
 * v0.8-A: evidence-based procedures.
 *
 * A `fixed:` procedure is a HYPOTHESIS until it keeps holding:
 *   - one success never earns an index line (no generalization from n=1);
 *   - ≥3 verified successes within 14 days promote it;
 *   - the moment the same command fails again it is invalidated, because a
 *     just-broken procedure is worse than none — the next agent copies it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { makeCaptureHandler, procedureOutcome } from "../lib/capture.js";
import { renderIndex, selectIndexMemories, procedureInvalidated, isProvenProcedure } from "../lib/index-block.js";

const DAY = 24 * 60 * 60 * 1000;

const CONFIG = {
  autoCapture: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
  sessionSearch: true,
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  procedureMinEvidence: 3,
  procedureMaxAgeDays: 14,
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

const agent = () => ({ session: { id: "s1", header: { cwd: "/ws" }, events: { length: 10 } } });
const settle = () => new Promise((r) => setTimeout(r, 40));
const run = (handler, command, isError, value) =>
  handler({ name: "bash", agent: agent(), arguments: { command } }, { isError, value });

async function seeded() {
  const domain = await openEngramDomain(fakeFacility());
  const handler = makeCaptureHandler(domain, CONFIG, { warn: () => {} });
  run(handler, "npm test", true, { stderr: "not ok 1\n# fail 1" }); // the failure
  await settle();
  run(handler, "npm test", false, { stdout: "pass 184" }); // the fix
  await settle();
  return { domain, handler };
}

const procedures = (domain) => domain.listMemories("/ws").filter((m) => m.kind === "procedure");
const indexed = (domain, config = CONFIG) =>
  selectIndexMemories(domain, "/ws", config).filter((m) => m.kind === "procedure");

test("a fix closure starts with one evidence point and does NOT enter the index", async () => {
  const { domain } = await seeded();
  const [procedure] = procedures(domain);
  assert.equal(procedure.evidenceCount, 1, "one observed success is one data point");
  assert.ok(procedure.lastVerifiedAt > 0);
  assert.equal(indexed(domain).length, 0, "n=1 never earns an index line");
  assert.ok(!renderIndex(domain, "/ws", "/ws", CONFIG).includes("fb fixed:"), "not rendered in [ENGRAM]");
  await domain.close();
});

test("three verified successes promote it into the index", async () => {
  const { domain, handler } = await seeded();
  run(handler, "npm test", false, { stdout: "pass 184" });
  await settle();
  run(handler, "npm test", false, { stdout: "pass 184" });
  await settle();
  const [procedure] = procedures(domain);
  assert.equal(procedure.evidenceCount, 3);
  assert.equal(indexed(domain).length, 1, "3 verified successes earn the line");
  assert.match(renderIndex(domain, "/ws", "/ws", CONFIG), /✓.*fixed: npm test|fixed: npm test/);
  await domain.close();
});

test("a later failure invalidates immediately and drops it out of the index", async () => {
  const { domain, handler } = await seeded();
  run(handler, "npm test", false, { stdout: "pass 184" });
  await settle();
  run(handler, "npm test", false, { stdout: "pass 184" });
  await settle();
  assert.equal(indexed(domain).length, 1, "precondition: promoted");

  run(handler, "npm test", true, { stderr: "not ok 1\n# fail 1" });
  await settle();
  const [procedure] = procedures(domain);
  assert.ok(procedure.lastFailedAt >= procedure.lastVerifiedAt, "failure is newer than the last verification");
  assert.ok(procedure.invalidatedBy, "the failure that invalidated it is recorded");
  assert.ok(procedure.signal <= 0.2, "demoted");
  assert.equal(procedureInvalidated(procedure), true);
  assert.equal(indexed(domain).length, 0, "a just-broken procedure must not be copied");
  await domain.close();
});

test("verification older than 14 days expires the promotion, the memory stays", async () => {
  const { domain, handler } = await seeded();
  run(handler, "npm test", false, { stdout: "pass 184" });
  await settle();
  run(handler, "npm test", false, { stdout: "pass 184" });
  await settle();
  const stale = { ...CONFIG, nowMs: Date.now() + 15 * DAY };
  assert.equal(indexed(domain, stale).length, 0, "14-day freshness window");
  assert.equal(procedures(domain).length, 1, "stale is not deleted — still drill-able");
  await domain.close();
});

test("a manual procedure with no evidence fields keeps the hits-based path", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const { stored } = await domain.storeMemory(
    {
      workspace: "/ws",
      kind: "procedure",
      text: "release: bump version, npm test, npm pack, install into profile",
      tags: ["procedure", "release"],
      signal: 0.6,
      sessionId: "s1",
      seq: 1,
    },
    CONFIG,
  );
  for (let i = 0; i < 3; i += 1) await domain.touchMemory("/ws", stored.id);
  const [row] = procedures(domain);
  assert.equal(isProvenProcedure(row, CONFIG), true, "hand-written procedures are not demoted by the new gate");
  await domain.close();
});

test("procedureOutcome targets only the same command signature", async () => {
  const { domain } = await seeded();
  const rows = domain.listMemories("/ws");
  assert.equal(procedureOutcome("bash", "npm test", { isError: false }, rows)?.ok, true);
  assert.equal(procedureOutcome("bash", "npm test", { isError: true }, rows)?.ok, false);
  assert.equal(procedureOutcome("bash", "npm run build", { isError: false }, rows), null, "different command");
  assert.equal(procedureOutcome("read", "npm test", { isError: false }, rows), null, "not a command run");
  await domain.close();
});
