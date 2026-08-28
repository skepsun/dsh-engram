/**
 * dsh-engram session-end todo auto-sink tests (audit follow-up).
 *
 * Covers the closed loop that was missing before: a session disposed with
 * pending todos lands them as ESR DRAFT tasks. Verifies:
 *   - pendingTodosFromSession reads the LAST todo/write snapshot from the
 *     session log (per-session truth, not the process-local recorder)
 *   - planTodoSink dedupes by existing name (case-insensitive), within-list
 *     duplicates once, and honours maxTasksPerWorkspace
 *   - sinkPendingTodos writes drafts (never active) with the 「源自会话计划」
 *     description, capped and never duplicating existing tasks
 *   - drafts stay out of the [ESR] active rows (buildEsrSnapshot)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { buildEsrSnapshot } from "../lib/index-block.js";
import { pendingTodosFromSession, planTodoSink, sinkPendingTodos, SINK_DESCRIPTION } from "../lib/todo-sink.js";

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

function fakeSession(events) {
  return { id: "sess-1", header: { cwd: "/w" }, events };
}

function todoWrite(todos) {
  return { type: "todo/write", seq: 0, data: { todos } };
}

// ── pendingTodosFromSession ──────────────────────────────────────────────────
test("pendingTodosFromSession returns [] when the session never wrote todos", () => {
  assert.deepEqual(pendingTodosFromSession(fakeSession([])), []);
  assert.deepEqual(pendingTodosFromSession(fakeSession([{ type: "turn/start", data: {} }])), []);
  assert.deepEqual(pendingTodosFromSession(null), []);
  assert.deepEqual(pendingTodosFromSession({}), []);
  assert.deepEqual(pendingTodosFromSession({ events: "nope" }), []);
});

test("pendingTodosFromSession uses the LAST todo/write snapshot and skips done items", () => {
  const session = fakeSession([
    todoWrite([
      { content: "old", status: "pending" },
      { content: "done-old", status: "completed" },
    ]),
    { type: "turn/start", data: {} },
    todoWrite([
      { content: "fix boot", status: "pending" },
      { content: "add tests", status: "in_progress" },
      { content: "shipped", status: "completed" },
      "plain string todo",
    ]),
  ]);
  assert.deepEqual(pendingTodosFromSession(session), ["fix boot", "add tests", "plain string todo"]);
});

test("pendingTodosFromSession returns [] once the final plan is fully completed", () => {
  const session = fakeSession([
    todoWrite([{ content: "x", status: "pending" }]),
    todoWrite([{ content: "x", status: "completed" }]),
  ]);
  assert.deepEqual(pendingTodosFromSession(session), []);
});

// ── planTodoSink ─────────────────────────────────────────────────────────────
test("planTodoSink dedupes by existing non-stable task name (case-insensitive, trimmed)", () => {
  const plan = planTodoSink(
    ["  Fix Boot  ", "fix boot", "add tests"],
    [{ name: "FIX BOOT" }, { name: " unrelated " }],
    { maxTasks: 40, activeCount: 1 },
  );
  assert.deepEqual(plan.toCreate, ["add tests"]);
  assert.deepEqual(plan.existed, ["Fix Boot"]);
  assert.deepEqual(plan.atCap, []);
});

test("planTodoSink sinks within-list duplicates only once", () => {
  const plan = planTodoSink(["a", "a", "b"], [], { maxTasks: 40, activeCount: 0 });
  assert.deepEqual(plan.toCreate, ["a", "b"]);
  assert.deepEqual(plan.existed, []);
  assert.deepEqual(plan.atCap, []);
});

test("planTodoSink honours the workspace cap and reports the overflow", () => {
  const plan = planTodoSink(["a", "b", "c"], [], { maxTasks: 2, activeCount: 0 });
  assert.deepEqual(plan.toCreate, ["a", "b"]);
  assert.deepEqual(plan.atCap, ["c"]);
  // already at cap → nothing creates
  const capped = planTodoSink(["a", "b"], [], { maxTasks: 2, activeCount: 2 });
  assert.deepEqual(capped.toCreate, []);
  assert.deepEqual(capped.atCap, ["a", "b"]);
});

test("planTodoSink ignores empty/whitespace todo names", () => {
  const plan = planTodoSink(["", "   ", "real"], [], { maxTasks: 40, activeCount: 0 });
  assert.deepEqual(plan.toCreate, ["real"]);
});

test("planTodoSink is safe against malformed input", () => {
  assert.deepEqual(planTodoSink(null, null, {}).toCreate, []);
  assert.deepEqual(planTodoSink(undefined, "nope", { maxTasks: 0 }).toCreate, []);
});

// ── sinkPendingTodos against the real store ──────────────────────────────────
test("sinkPendingTodos lands drafts (never active) with the auto-sink description", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const report = await sinkPendingTodos(domain, "/w", ["fix boot", "add tests"], {
    sessionId: "sess-9",
    maxTasks: 40,
    now: 1000,
  });
  assert.deepEqual(report.created, ["fix boot", "add tests"]);
  assert.deepEqual(report.existed, []);
  assert.deepEqual(report.atCap, []);

  const tasks = domain.listTasks("/w", { includeStable: false });
  assert.equal(tasks.length, 2);
  for (const t of tasks) {
    assert.equal(t.state, "draft", "auto-sunk tasks are drafts, not active");
    assert.equal(t.description, SINK_DESCRIPTION);
    assert.equal(t.sessionId, "sess-9");
    assert.equal(t.artifact, null);
    assert.equal(t.evaluation, null);
    assert.deepEqual(t.memoryRefs, []);
  }
  await domain.close();
});

test("sinkPendingTodos never duplicates an existing task and collapses repeats", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.putTask({ id: "tsk_1", workspace: "/w", name: "Fix Boot", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1, stateChangedAt: 0, deps: [], assignee: null, claimedAt: null });
  const report = await sinkPendingTodos(domain, "/w", ["fix boot", "fix boot", "new one"], {
    sessionId: "sess-9",
    maxTasks: 40,
    now: 1000,
  });
  assert.deepEqual(report.created, ["new one"]);
  assert.deepEqual(report.existed, ["fix boot"]);
  assert.equal(domain.listTasks("/w", { includeStable: false }).length, 2);
  await domain.close();
});

test("sinkPendingTodos stops at the workspace cap", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.putTask({ id: "tsk_a", workspace: "/w", name: "existing", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1, stateChangedAt: 0, deps: [], assignee: null, claimedAt: null });
  const report = await sinkPendingTodos(domain, "/w", ["a", "b"], {
    sessionId: "sess-9",
    maxTasks: 2, // 1 active existing + 1 draft = 2 → second skipped
    now: 1000,
  });
  assert.deepEqual(report.created, ["a"]);
  assert.deepEqual(report.atCap, ["b"]);

  // drafts count toward the cap too — a second sink creates nothing new
  const again = await sinkPendingTodos(domain, "/w", ["c"], { sessionId: "sess-9", maxTasks: 2, now: 1001 });
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.atCap, ["c"]);
  await domain.close();
});

test("sinkPendingTodos no-ops without todos or domain and survives domain absence", async () => {
  const domain = await openEngramDomain(fakeFacility());
  assert.deepEqual(await sinkPendingTodos(domain, "/w", [], { maxTasks: 40 }), { created: [], existed: [], atCap: [] });
  assert.deepEqual(await sinkPendingTodos(null, "/w", ["a"], { maxTasks: 40 }), { created: [], existed: [], atCap: [] });
  await domain.close();
});

test("auto-sunk drafts stay out of the [ESR] active count (draft row, never counted active)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await sinkPendingTodos(domain, "/w", ["fix boot"], { sessionId: "sess-9", maxTasks: 40, now: 1000 });
  const block = buildEsrSnapshot(domain, "/w", CONFIG, { sessionId: "s1" });
  assert.ok(block.includes("0 active / 0 stable / 1 draft"), "draft counted separately, not as active");
  assert.ok(block.includes("fix boot") && block.includes("DRAFT"), "sunk plan visible as a DRAFT row (not active)");
  assert.ok(!/1 active/.test(block), "the draft never contributes to the active count");
  assert.ok(block.includes("esr_status"), "snapshot still points at the pull tool");
  await domain.close();
});
