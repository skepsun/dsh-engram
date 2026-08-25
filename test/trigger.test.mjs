/**
 * dsh-engram decision-point trigger tests (pi-esr-aligned pull design).
 *
 * The [ESR] block is now a FROZEN per-session snapshot (hint-free); the
 * decision-point hints (promote / root-cause / close / stale / escalate) are
 * assembled ONLY on the `esr_status` pull path via `esrHintLines`. Covers:
 *   - pendingTodos extraction from todo_write arguments
 *   - the frozen block never contains #suggest-* hint lines
 *   - promote / root-cause / close / stale / escalate hints fire once per
 *     session, only when their trigger conditions hold
 *   - the live mem-vs-esr balance restores the escalation nudge from the
 *     in-memory recorder (dead-table-free data source)
 *   - P4 exposure counting moves to the pull path (GET /triggerstats)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { renderIndex, buildEsrSnapshot, buildFrozenEsrBlock, buildEsrStatusView, esrHintLines, esrMethodology } from "../lib/index-block.js";
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

// ── frozen snapshot is hint-free (pi-esr rule 2) ─────────────────────────────
test("frozen [ESR] snapshot is hint-free and deterministic per store state", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  rec.handle(
    execTool("todo_write", "/w", {
      todos: [
        { content: "fix boot", status: "pending" },
        { content: "add tests", status: "in_progress" },
      ],
    }),
    {},
  );
  await domain.putTask({ id: "tsk_1", workspace: "/w", name: "t1", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });

  const block = buildEsrSnapshot(domain, "/w", CONFIG, { sessionId: "s1" });
  assert.ok(!block.includes("#suggest-"), "no hint source tags in the frozen block");
  assert.ok(!block.includes("promote:") && !block.includes("escalate:"), "no decision-point hints in the frozen block");
  assert.ok(block.includes("WILL NOT auto-refresh"), "snapshot says it will not auto-refresh");
  assert.ok(block.includes("esr_status"), "snapshot points at the pull tool");
  assert.ok(block.includes("tsk_1"));

  // same store state → byte-identical
  assert.equal(buildEsrSnapshot(domain, "/w", CONFIG, { sessionId: "s1" }), block);

  // the hints live on the pull path only
  const hints = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(hints.some((h) => h.kind === "promote"), "promote hint surfaces via esrHintLines");
  await domain.close();
});

// ── promote hint (P0-A, on the pull path) ─────────────────────────────────────
test("promote hint appears once per session via esrHintLines (pull), appended into the frozen block", async () => {
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

  const first = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(first.some((h) => h.line.includes("promote: 2 pending todo(s) vs 0 ESR task(s)")));
  assert.ok(first.some((h) => h.line.includes('esr_task(name="fix boot / add tests")')));

  // same session: hint is one-shot (no nagging)
  const second = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!second.some((h) => h.kind === "promote"), "promote hint fires at most once per session");

  // a different session that never wrote todos gets nothing
  const other = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s9" });
  assert.ok(!other.some((h) => h.kind === "promote"));

  // without a recorder (legacy preview) nothing is derived
  const preview = esrHintLines(domain, "/w", CONFIG);
  assert.deepEqual(preview, []);

  await domain.close();
});

// ── frozen block + accumulated actionables (the hybrid the agent sees) ─────────
test("frozen block: snapshot stays pure; actionables append once when they mature and never vanish", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  const holder = { actionables: new Map() };
  const render = () => buildFrozenEsrBlock(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1", holder });

  // turn 1: no recorder state yet → pure snapshot, no actionables
  const turn1 = render();
  assert.ok(turn1.includes("[ESR] no open tasks — BE PROACTIVE"), "empty-state snapshot header");
  assert.ok(!turn1.includes("# this-session actionables"), "no actionables before anything matures");
  assert.ok(turn1.includes("WILL NOT auto-refresh"), "snapshot tail always present");

  // model writes a plan → next turn promote matures and is appended ONCE
  rec.handle(execTool("todo_write", "/w", { todos: [{ content: "fix boot", status: "pending" }, { content: "add tests", status: "in_progress" }] }), {});
  const turn2 = render();
  assert.ok(turn2.includes("promote:"), "promote appended into the block the moment it matures");
  assert.ok(turn2.includes("# this-session actionables (frozen)"));

  // subsequent turns: byte-identical (no re-append, no flash-vanish)
  const turn3 = render();
  assert.equal(turn3, turn2, "frozen block is stable per-turn once actionables are accumulated");
  assert.equal(holder.actionables.size, 1, "exactly one actionable accumulated so far");

  await domain.close();
});

test("frozen block: accumulates distinct new actionables across the session (monotonic growth)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  const holder = { actionables: new Map() };
  const render = () => buildFrozenEsrBlock(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1", holder });

  const old = Date.now() - 30 * 86_400_000;
  const staleCfg = { ...CONFIG, staleTaskDays: 14 };
  await domain.putTask({ id: "tsk_s", workspace: "/w", name: "old work", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: old, updatedAt: old });
  rec.handle(execTool("todo_write", "/w", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }] }), {});

  const block = render();
  assert.ok(block.includes("promote:") && block.includes("stale:"), "both matured actionables accumulate");
  assert.equal(holder.actionables.size, 2);
  // both stay through the session (monotonic — never removed even if condition clears)
  await domain.putTask({ id: "tsk_s", workspace: "/w", name: "old work", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: Date.now(), updatedAt: Date.now() });
  const later = render();
  assert.ok(later.includes("stale:"), "already-appended stale stays (frozen semantics, not live recompute)");
  assert.equal(later, block, "no re-render churn: actionables already appended → byte-identical");
  await domain.close();
});

test("frozen block: host passes the session-start snapshot — mid-session task writes never leak in", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  const holder = { actionables: new Map() };
  // first assembly: store is empty → this snapshot freezes for the session
  const snapshot = buildEsrSnapshot(domain, "/w", CONFIG, { sessionId: "s1" });
  const first = buildFrozenEsrBlock(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1", holder, snapshot });
  // the agent then creates a task mid-session (fresh → no stale actionable matures)
  await domain.putTask({ id: "tsk_new", workspace: "/w", name: "created later", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s1", createdAt: Date.now(), updatedAt: Date.now() });
  const second = buildFrozenEsrBlock(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1", holder, snapshot });
  assert.ok(!second.includes("tsk_new"), "frozen snapshot does not show mid-session tasks");
  assert.equal(second, first, "no new actionables matured → block byte-identical");
  // live state is available via the pull surface instead
  assert.ok(buildEsrStatusView(domain, "/w", CONFIG, { sessionId: "s1" }).includes("created later"), "esr_status covers the live task surface");
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
  assert.ok(esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" }).some((h) => h.kind === "promote"));
  // a fresh session, now with 2 active tasks → 2 pending is not > 2 active → no fire
  const rec2 = makeTriggerRecorder();
  rec2.handle(
    execTool("todo_write", "/w", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }] }, "s2"),
    {},
  );
  await domain.putTask({ id: "t1", workspace: "/w", name: "t1", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  await domain.putTask({ id: "t2", workspace: "/w", name: "t2", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  const wide = esrHintLines(domain, "/w", CONFIG, { recorder: rec2, sessionId: "s2" });
  assert.ok(!wide.some((h) => h.kind === "promote"), "funnel not narrow: no promote hint");
  // showOnce consumed by rec2 even when it did not fire? no: not marked → later window can fire
  assert.equal(rec2.promoteHint("s2", "/w", 3), "");

  await domain.close();
});

test("promote hint is per-workspace, driven by the writing session only", () => {
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

// ── live balance (P1, on the pull path) ───────────────────────────────────────
test("live balance drives the escalation nudge on the pull path (appears, then disappears)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();

  // under-proactive: 4 mem ops vs 1 esr call (ratio 20% < 34%)
  for (let i = 0; i < 4; i++) rec.handle(execTool("engram_store", "/w", { text: "x" }), {});
  rec.handle(execTool("esr_node", "/w", { name: "svc" }), {});
  const escalateSays = (recOrder, sessionId) =>
    esrHintLines(domain, "/w", CONFIG, { recorder: recOrder, sessionId }).filter((h) => h.kind === "escalate").map((h) => h.line);
  assert.ok(escalateSays(rec, "s1")[0]?.includes("escalate:"), "recorder-fed nudge appears on pull");
  assert.match(escalateSays(rec, "s1")[0], /4 mem ops vs 1 esr calls/);

  // healthy balance (esr ≥ ~half of mem ops) → nudge disappears
  rec.handle(execTool("esr_task", "/w", { name: "t" }), {});
  rec.handle(execTool("esr_task", "/w", { name: "t2" }), {});
  rec.handle(execTool("esr_link", "/w", { source: "a", relation: "r", target: "b" }), {});
  assert.deepEqual(escalateSays(rec, "s1"), [], "healthy after escalation: nudge gone");

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

// ── root-cause hint (P0-B, on the pull path) ───────────────────────────────────
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
  const lines = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(lines.some((h) => h.kind === "rootcause" && h.line.includes("×2") && h.line.includes("cannot resolve symbol X")));
  const second = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!second.some((h) => h.kind === "rootcause"), "root-cause hint at most once per session per error");
  // a fresh session surfaces the same recurring failure again (dedup is per error id)
  const other = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s2" });
  assert.ok(other.some((h) => h.kind === "rootcause"), "fresh session surfaces the recurring failure again");
  await domain.close();
});

test("root-cause requires hits >= minErrorHits; below it stays silent", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/w", kind: "error", text: "one-off failure", tags: ["error"], signal: 0.25, sessionId: "s", seq: 1 }, CONFIG);
  const rec = makeTriggerRecorder();
  const lines = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!lines.some((h) => h.kind === "rootcause"), "single failure (hits 0) is not a root-cause candidate");
  await domain.close();
});

// ── closure hint (P3, on the pull path) ───────────────────────────────────────
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
  const snapshot = buildEsrSnapshot(domain, "/w", CONFIG, { sessionId: "s1" });
  assert.ok(snapshot.includes("next: esr_close tsk_r"), "READY task gets the next line in the frozen snapshot");
  const lines = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(lines.some((h) => h.kind === "close" && h.line.includes("close: task tsk_r · ship — evidence complete, esr_close now")));
  const second = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!second.some((h) => h.kind === "close"), "closure hint at most once per session");
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
  const lines = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!lines.some((h) => h.kind === "close"), "no pending→0 transition → no closure hint");
  await domain.close();
});

// ── stale hint (P3, on the pull path) ──────────────────────────────────────────
test("stale hint surfaces an untouched active task, once per session per task", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  const old = Date.now() - 30 * 86_400_000;
  await domain.putTask({
    id: "tsk_s", workspace: "/w", name: "old work", state: "active",
    artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: old, updatedAt: old,
  });
  const cfg = { ...CONFIG, staleTaskDays: 14 };
  const lines = esrHintLines(domain, "/w", cfg, { recorder: rec, sessionId: "s1" });
  assert.ok(lines.some((h) => h.kind === "stale" && h.line.includes("stale: tsk_s · old work — no update 30d")));
  const second = esrHintLines(domain, "/w", cfg, { recorder: rec, sessionId: "s1" });
  assert.ok(!second.some((h) => h.kind === "stale"), "stale hint at most once per session per task");
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
  const lines = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(!lines.some((h) => h.kind === "stale"), "recently-touched task is not stale");
  await domain.close();
});

// ── next-list ordering (P2, in the frozen snapshot) ────────────────────────────
test("READY tasks sort first and get a next: esr_close line", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.putTask({ id: "tsk_gap", workspace: "/w", name: "gap task", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 2, updatedAt: 2 });
  await domain.putTask({ id: "tsk_draft", workspace: "/w", name: "draft task", state: "draft", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 3, updatedAt: 1 });
  await domain.putTask({ id: "tsk_ready", workspace: "/w", name: "ready task", state: "active", artifact: "a", evaluation: "e", memoryRefs: ["m"], sessionId: "s", createdAt: 1, updatedAt: 5 });
  const esr = buildEsrSnapshot(domain, "/w", CONFIG, { sessionId: "s1" });
  const idxReady = esr.indexOf("tsk_re");
  const idxGap = esr.indexOf("tsk_ga");
  const idxDraft = esr.indexOf("tsk_dr");
  assert.ok(idxReady > -1 && idxGap > -1 && idxDraft > -1);
  assert.ok(idxReady < idxGap && idxGap < idxDraft, "READY → active-with-gap → draft order");
  assert.ok(esr.includes("next: esr_close tsk_re"), "next line names the READY task");
  await domain.close();
});

// ── P4 conversion measurement (pull path) ──────────────────────────────────────
test("hint lines carry stable #suggest-* tags", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  rec.handle(execTool("todo_write", "/w", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }] }), {});
  const lines1 = esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(lines1.some((h) => h.line.includes("#suggest-promote")), "promote hint tagged");
  // escalate tag (3 mem ops → unhealthy balance)
  const rec2 = makeTriggerRecorder();
  for (let i = 0; i < 3; i++) rec2.handle(execTool("engram_store", "/w", { text: `x${i}` }), {});
  const lines2 = esrHintLines(domain, "/w", CONFIG, { recorder: rec2, sessionId: "s1" });
  assert.ok(lines2.some((h) => h.line.includes("#suggest-escalate")), "escalate hint tagged");
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

test("pull preview derives nothing and counts nothing without a session", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  rec.handle(execTool("todo_write", "/w", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }] }), {});
  esrHintLines(domain, "/w", CONFIG, { recorder: rec }); // no sessionId → preview path
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

// ── esr_status pull view (pi-esr rule 3: incremental read) ─────────────────────
test("esr_status: full view + revision; since_revision short-circuits unchanged state; actionables still surface", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.putTask({ id: "tsk_a", workspace: "/w", name: "a", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  const rec = makeTriggerRecorder();
  rec.handle(execTool("todo_write", "/w", { todos: [{ content: "p", status: "pending" }, { content: "q", status: "pending" }] }), {});

  const full = buildEsrStatusView(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" });
  assert.ok(full.includes("[ESR] tasks:"), "full view starts with the snapshot header");
  assert.ok(full.includes("ESR revision: "), "full view carries the revision");
  assert.ok(full.includes("#suggest-promote"), "actionables ride the pull response");

  const revision = domain.esrFingerprint("/w");
  const unchanged = buildEsrStatusView(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1", sinceRevision: revision });
  assert.ok(unchanged.includes("ESR state unchanged since revision") , "unchanged short response");
  assert.ok(!unchanged.includes("tsk_a"), "state section collapsed (no full snapshot)");
  assert.ok(unchanged.includes("ESR revision: "), "response still names the revision");
  // promote already consumed by the first pull → no actionables in the second
  assert.ok(!unchanged.includes("#suggest-promote"), "one-shot hint already shown");

  await domain.close();
});

test("esr_status: a stale revision returns the full view (state drifted)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.putTask({ id: "tsk_a", workspace: "/w", name: "a", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  const view = buildEsrStatusView(domain, "/w", CONFIG, { sinceRevision: "stale-old-revision" });
  assert.ok(view.includes("[ESR] tasks:"), "stale since_revision → full snapshot returned");
  await domain.close();
});

test("esr methodology is static text (does not depend on runtime state)", () => {
  const m1 = esrMethodology();
  const m2 = esrMethodology();
  assert.equal(m1, m2, "byte-identical static protocol");
  assert.ok(m1.includes("esr_task"), "teaches task creation");
  assert.ok(m1.includes("esr_close"), "teaches evidence-driven closure");
});

// [ESR] and [ENGRAM] render through separate per-session caches in the host
// (a shared WeakMap would hand the [ESR] section the cached [ENGRAM] block);
// here we only guard that the two block renderers stay distinct.
test("ESR snapshot and ENGRAM index render distinct blocks (no cross-cache collision)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.putTask({ id: "tsk_a", workspace: "/w", name: "a", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  const index = renderIndex(domain, "/w", "/w", CONFIG);
  const esr = buildEsrSnapshot(domain, "/w", CONFIG, { sessionId: "s1" });
  assert.ok(index.startsWith("[ENGRAM]"), "index block starts with [ENGRAM]");
  assert.ok(esr.startsWith("[ESR]"), "esr snapshot starts with [ESR]");
  assert.notEqual(index, esr, "the two frozen blocks are different documents");
  await domain.close();
});

// ── esr revision fingerprint (pi-esr rule 3: incremental pull) ────────────────
test("esr revision: fingerprint is stable for identical task surface, changes on task writes", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const r0 = domain.esrFingerprint("/w");
  const r1 = domain.esrFingerprint("/w");
  assert.equal(r0, r1, "no tasks yet → same empty fingerprint");
  await domain.putTask({ id: "tsk_a", workspace: "/w", name: "a", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  const r2 = domain.esrFingerprint("/w");
  assert.notEqual(r2, r0, "a new active task changes the revision");
  assert.equal(domain.esrFingerprint("/w"), r2, "deterministic: same surface → same revision");
  // timestamps are excluded — touching updatedAt alone must NOT change the revision
  await domain.putTask({ id: "tsk_a", workspace: "/w", name: "a", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: Date.now() + 1e6 });
  assert.equal(domain.esrFingerprint("/w"), r2, "updatedAt bump alone leaves the revision unchanged (timestamps excluded)");
  // evidence change DOES change the revision
  await domain.putTask({ id: "tsk_a", workspace: "/w", name: "a", state: "active", artifact: "a", evaluation: "e", memoryRefs: ["m"], sessionId: "s", createdAt: 1, updatedAt: 1 });
  assert.notEqual(domain.esrFingerprint("/w"), r2, "evidence change moves the revision");
  await domain.close();
});
