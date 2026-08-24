/**
 * dsh-engram decision-point trigger tests (P0-A + P1).
 *
 * Covers:
 *   - pendingTodos extraction from todo_write arguments
 *   - the promote hint fires once per session, only when the funnel is narrow
 *   - the live mem-vs-esr balance restores the escalation nudge from a
 *     dead-table-free data source (in-memory recorder, not store.usageRows)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { renderEsr } from "../lib/index-block.js";
import { makeTriggerRecorder, pendingTodos, MEM_TOOLS, ESR_TOOLS } from "../lib/trigger.js";

/** In-memory storage-domain stand-in (mirrors test/basic.test.mjs). */
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
};

function execTool(name, cwd, args, sessionId = "s1") {
  return {
    name,
    agent: { session: { id: sessionId, header: { cwd } } },
    arguments: args,
  };
}

// ── pendingTodos ─────────────────────────────────────────────────────────────
test("pendingTodos extracts unfinished items, ignores done/empty/malformed", () => {
  assert.deepEqual(
    pendingTodos({
      todos: [
        { content: "a", status: "pending" },
        { content: "b", status: "in_progress" },
        { content: "c", status: "completed" },
        { content: "", status: "todo" },
        { name: "d", state: "done" },
        42,
        "e",
      ],
    }),
    ["a", "b", "e"],
  );
  assert.deepEqual(pendingTodos({}), []);
  assert.deepEqual(pendingTodos(null), []);
  assert.deepEqual(pendingTodos({ todos: "nope" }), []);
  // all done → nothing left to promote
  assert.deepEqual(
    pendingTodos({ todos: [{ content: "x", status: "completed" }, { content: "y", status: "complete" }] }),
    [],
  );
});

// ── promote hint (P0-A) ──────────────────────────────────────────────────────
test("promote hint appears once per session in the [ESR] block", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  rec.handle(
    execTool("todo_write", "/w", {
      todos: [
        { content: "fix boot", status: "pending" },
        { content: "add tests", status: "in_progress" },
        { content: "done item", status: "completed" },
      ],
    }),
    {},
  );

  const first = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.match(first, /promote: 2 pending todo\(s\) vs 0 ESR task\(s\)/);
  assert.match(first, /esr_task\(name="fix boot \/ add tests"\)/);

  // same session: hint is one-shot (no nagging)
  const second = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!second.includes("promote:"), "promote hint fires at most once per session");

  // a different session that never wrote todos gets nothing
  const other = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s9" });
  assert.ok(!other.includes("promote:"));

  // without a recorder (legacy preview) nothing changes
  const legacy = renderEsr(domain, "/w", CONFIG);
  assert.ok(!legacy.includes("promote:"));

  await domain.close();
});

test("promote hint only fires when the funnel is narrow (pending > active tasks)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  rec.handle(
    execTool("todo_write", "/w", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }] }),
    {},
  );

  // 2 pending vs 0 active → fires
  assert.ok(renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" }).includes("promote:"));
  // a fresh session, now with 2 active tasks → 2 pending is not > 2 active → no fire
  const rec2 = makeTriggerRecorder();
  rec2.handle(
    execTool("todo_write", "/w", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }] }, "s2"),
    {},
  );
  await domain.putTask({ id: "t1", workspace: "/w", name: "t1", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  await domain.putTask({ id: "t2", workspace: "/w", name: "t2", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  const wide = renderEsr(domain, "/w", CONFIG, { recorder: rec2, sessionId: "s2" });
  assert.ok(!wide.includes("promote:"), "funnel not narrow: no promote hint");
  // showOnce consumed by rec2 even when it did not fire? no: not marked → later window can fire
  assert.equal(rec2.promoteHint("s2", "/w", 3), "");

  await domain.close();
});

test("promote hint is per-workspace, driven by the writing session only", async () => {
  const rec = makeTriggerRecorder();
  rec.handle(
    execTool("todo_write", "/w1", { todos: [{ content: "p", status: "pending" }, { content: "q", status: "pending" }] }, "s1"),
    {},
  );
  // different workspace: no snapshot → no hint
  assert.equal(rec.promoteHint("s1", "/w2", 0), "");
  // same workspace, other session's plan belongs to that session only
  assert.equal(rec.promoteHint("s-other", "/w1", 0), "");
  // the writing session gets it
  assert.match(rec.promoteHint("s1", "/w1", 0), /^promote:/);
  // and only once
  assert.equal(rec.promoteHint("s1", "/w1", 0), "");
});

// ── live balance (P1) ────────────────────────────────────────────────────────
test("live balance drives the escalation nudge (appears, then disappears)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();

  // under-proactive: 4 mem ops vs 1 esr call (ratio 20% < 34%)
  for (let i = 0; i < 4; i++) rec.handle(execTool("engram_store", "/w", { text: "x" }), {});
  rec.handle(execTool("esr_node", "/w", { name: "svc" }), {});
  const esr = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(esr.includes("escalate:"), "recorder-fed nudge appears");
  assert.match(esr, /4 mem ops vs 1 esr calls/);

  // healthy balance (esr ≥ ~half of mem ops) → nudge disappears
  rec.handle(execTool("esr_task", "/w", { name: "t" }), {});
  rec.handle(execTool("esr_task", "/w", { name: "t2" }), {});
  rec.handle(execTool("esr_link", "/w", { source: "a", relation: "r", target: "b" }), {});
  const healthy = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!healthy.includes("escalate:"), "healthy after escalation: nudge gone");

  await domain.close();
});

test("recorder only counts mem/esr tools; other tools (incl. todo_write) are neutral", () => {
  const rec = makeTriggerRecorder();
  rec.handle(execTool("todo_write", "/w", { todos: [] }), {});
  rec.handle(execTool("bash", "/w", { command: "ls" }), {});
  assert.deepEqual(rec.recentBalance("/w"), { memCalls: 0, esrCalls: 0, days: 0 });
  rec.handle(execTool("engram_recall", "/w", { query: "q" }), {});
  rec.handle(execTool("esr_close", "/w", { task_id: "t", artifact: "a", evaluation: "e", memory_refs: ["m"] }), {});
  assert.deepEqual(rec.recentBalance("/w"), { memCalls: 1, esrCalls: 1, days: 1 });
  // tool name lists stay in sync with the balance classification
  assert.ok(MEM_TOOLS.includes("engram_store") && ESR_TOOLS.includes("esr_task"));
});

// ── root-cause hint (P0-B) ───────────────────────────────────────────────────
test("root-cause hint surfaces recurring failures once per session per error", async () => {
  const domain = await openEngramDomain(fakeFacility());
  // simulate a failure recurring across sessions: exact-repeat storeMemory
  // climbs the error hits counter (3 writes → hits 2)
  for (let i = 0; i < 3; i++) {
    await domain.storeMemory(
      { workspace: "/w", kind: "error", text: "build failed: cannot resolve symbol X", tags: ["error"], signal: 0.25, sessionId: "old", seq: i },
      CONFIG,
    );
  }
  const rec = makeTriggerRecorder();
  const esr = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.match(esr, /root-cause: .*cannot resolve symbol X.* ×2 — esr_task it so the pattern dies/);
  const second = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!second.includes("root-cause:"), "root-cause hint at most once per session per error");
  // a fresh session surfaces the same recurring failure again (dedup is per error id)
  const other = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s2" });
  assert.match(other, /root-cause: .*×2/);
  await domain.close();
});

test("root-cause requires hits >= minErrorHits; below it stays silent", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/w", kind: "error", text: "one-off failure", tags: ["error"], signal: 0.25, sessionId: "s", seq: 1 }, CONFIG);
  const rec = makeTriggerRecorder();
  const esr = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!esr.includes("root-cause:"), "single failure (hits 0) is not a root-cause candidate");
  await domain.close();
});

// ── closure hint (P3) ────────────────────────────────────────────────────────
test("closure hint fires once after todos complete, only with a READY task", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  await domain.putTask({
    id: "tsk_r", workspace: "/w", name: "ship", state: "active",
    artifact: "lib/index.js", evaluation: "tests pass", memoryRefs: ["m1"],
    sessionId: "s", createdAt: 1, updatedAt: 1,
  });
  // plan written with pending todos, then fully completed → work-done event
  rec.handle(execTool("todo_write", "/w", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }] }), {});
  rec.handle(execTool("todo_write", "/w", { todos: [{ content: "a", status: "completed" }, { content: "b", status: "completed" }] }), {});
  const esr = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(esr.includes("next: esr_close tsk_r"), "READY task gets the next line");
  assert.match(esr, /close: task tsk_r · ship — evidence complete, esr_close now/);
  const second = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!second.includes("close: task"), "closure hint at most once per session");
  await domain.close();
});

test("closure hint requires the pending→0 transition (no plan → no hint)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  await domain.putTask({
    id: "tsk_r", workspace: "/w", name: "ship", state: "active",
    artifact: "a", evaluation: "e", memoryRefs: ["m"], sessionId: "s", createdAt: 1, updatedAt: 1,
  });
  // first todo_write already has zero pending — that is NOT a completion event
  rec.handle(execTool("todo_write", "/w", { todos: [{ content: "a", status: "completed" }] }), {});
  const esr = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!esr.includes("close: task"), "no pending→0 transition → no closure hint");
  await domain.close();
});

// ── stale hint (P3) ──────────────────────────────────────────────────────────
test("stale hint surfaces an untouched active task, once per session per task", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  const old = Date.now() - 30 * 86_400_000;
  await domain.putTask({
    id: "tsk_s", workspace: "/w", name: "old work", state: "active",
    artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: old, updatedAt: old,
  });
  const cfg = { ...CONFIG, staleTaskDays: 14 };
  const esr = renderEsr(domain, "/w", cfg, { recorder: rec, sessionId: "s1" });
  assert.match(esr, /stale: tsk_s · old work — no update 30d/);
  const second = renderEsr(domain, "/w", cfg, { recorder: rec, sessionId: "s1" });
  assert.ok(!second.includes("stale: tsk_s"), "stale hint at most once per session per task");
  await domain.close();
});

test("stale respects staleTaskDays: fresh active task stays silent", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  const now = Date.now();
  await domain.putTask({
    id: "tsk_f", workspace: "/w", name: "fresh", state: "active",
    artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: now, updatedAt: now,
  });
  const esr = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!esr.includes("stale: tsk_f"), "recently-touched task is not stale");
  await domain.close();
});

// ── next-list ordering (P2) ──────────────────────────────────────────────────
test("READY tasks sort first and get a next: esr_close line", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.putTask({ id: "tsk_gap", workspace: "/w", name: "gap task", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 2, updatedAt: 2 });
  await domain.putTask({ id: "tsk_draft", workspace: "/w", name: "draft task", state: "draft", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 3, updatedAt: 1 });
  await domain.putTask({ id: "tsk_ready", workspace: "/w", name: "ready task", state: "active", artifact: "a", evaluation: "e", memoryRefs: ["m"], sessionId: "s", createdAt: 1, updatedAt: 5 });
  const esr = renderEsr(domain, "/w", CONFIG, { recorder: makeTriggerRecorder(), sessionId: "s1" });
  const idxReady = esr.indexOf("tsk_re");
  const idxGap = esr.indexOf("tsk_ga");
  const idxDraft = esr.indexOf("tsk_dr");
  assert.ok(idxReady > -1 && idxGap > -1 && idxDraft > -1);
  assert.ok(idxReady < idxGap && idxGap < idxDraft, "READY → active-with-gap → draft order");
  assert.ok(esr.includes("next: esr_close tsk_re"), "next line names the READY task");
  await domain.close();
});

// ── P4 conversion measurement ────────────────────────────────────────────────
test("hint lines carry stable #suggest-* tags", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  rec.handle(execTool("todo_write", "/w", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }] }), {});
  const esr1 = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(esr1.includes("#suggest-promote"), "promote hint tagged");
  // escalate tag (3 mem ops → unhealthy balance)
  for (let i = 0; i < 3; i++) rec.handle(execTool("engram_store", "/w", { text: `x${i}` }), {});
  const esr2 = renderEsr(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(esr2.includes("#suggest-escalate"), "escalate hint tagged");
  await domain.close();
});

test("conversion: esr_* within window converts the most recent hint", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const rec = makeTriggerRecorder();
  rec.emitHint("promote", "/w", "s1");
  rec.emitHint("stale", "/w", "s1");
  t.mock.timers.tick(5 * 60 * 1000); // still inside the 10 min window
  rec.handle(execTool("esr_task", "/w", { name: "t" }), {});
  let stats = rec.conversionStats("/w");
  assert.equal(stats.byKind.promote.converted, 1, "most recent pending hint converts");
  assert.equal(stats.byKind.promote.rate, 1);
  assert.equal(stats.byKind.stale.converted, 0, "only one hint is attributed per call");
  assert.equal(stats.byKind.stale.shown, 1);
  // past the window the stale exposure expires unconverted
  t.mock.timers.tick(11 * 60 * 1000);
  stats = rec.conversionStats("/w");
  assert.equal(stats.byKind.stale.shown, 1);
  assert.equal(stats.byKind.stale.converted, 0);
  assert.equal(stats.total.shown, 2);
  assert.equal(stats.total.converted, 1);
  assert.equal(stats.total.rate, 0.5);
  t.mock.timers.reset();
});

test("conversion is per-workspace and once per (ws, session, kind)", () => {
  const rec = makeTriggerRecorder();
  rec.emitHint("promote", "/a", "s1");
  rec.emitHint("promote", "/a", "s1"); // same → not double counted
  rec.emitHint("promote", "/a", "s2"); // fresh session, same ws
  rec.emitHint("promote", "/b", "s1"); // other ws
  rec.handle(execTool("esr_task", "/a", { name: "t" }, "s1"), {});
  const all = rec.conversionStats();
  assert.equal(all.byKind.promote.shown, 3);
  assert.equal(all.byKind.promote.converted, 1);
  const a = rec.conversionStats("/a");
  assert.equal(a.byKind.promote.shown, 2);
  assert.equal(a.byKind.promote.converted, 1);
  const b = rec.conversionStats("/b");
  assert.equal(b.byKind.promote.shown, 1);
  assert.equal(b.byKind.promote.converted, 0);
});

test("GUI preview renders hints without counting them as exposures", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  rec.handle(execTool("todo_write", "/w", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }] }), {});
  renderEsr(domain, "/w", CONFIG, { recorder: rec }); // no sessionId → preview path
  assert.deepEqual(rec.conversionStats("/w").byKind.promote, { shown: 0, converted: 0, rate: null });
  await domain.close();
});

test("exposure dedupes escalate like the other hints (once per session)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const rec = makeTriggerRecorder();
  for (let i = 0; i < 3; i++) rec.handle(execTool("engram_store", "/w", { text: `x${i}` }), {});
  rec.emitHint("escalate", "/w", "s1");
  rec.emitHint("escalate", "/w", "s1"); // second render of the same hint → no double count
  const stats = rec.conversionStats("/w");
  assert.equal(stats.byKind.escalate.shown, 1);
  t.mock.timers.reset();
});
