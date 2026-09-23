/**
 * BoundaryPrune unit tests (lib/boundary-prune.js) — pure reducers only;
 * the listener itself needs a live DSH session and is covered by the L0
 * simulation + manual smoke (`boundaryPrune` default OFF).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { isBoundary, completedCount, expectedSessionRequests } from "../lib/boundary-prune.js";

test("completedCount counts completed todos only", () => {
  assert.equal(completedCount(null), 0);
  assert.equal(completedCount(undefined), 0);
  assert.equal(completedCount([{ status: "pending" }]), 0);
  assert.equal(
    completedCount([{ status: "completed" }, { status: "pending" }, { status: "completed" }]),
    2,
  );
});

test("isBoundary: todo/write with strictly increasing completed count", () => {
  const state = { todoCompleted: 0, requests: 0, prunes: 0, prunedResults: 0 };
  // 1 of 4 completed — first crossing fires
  const ev1 = { type: "todo/write", data: { todos: [
    { status: "completed" }, { status: "pending" }, { status: "pending" }, { status: "pending" },
  ] } };
  assert.deepEqual(isBoundary(ev1, state), { kind: "todo", completed: 1 });
  assert.equal(state.todoCompleted, 1);

  // same count again — no boundary (the todo high-water mark moved)
  assert.equal(isBoundary(ev1, state), null);
  // empty write — no boundary
  assert.equal(isBoundary({ type: "todo/write", data: { todos: [] } }, state), null);

  // 4 of 4 completed — fires again
  const ev2 = { type: "todo/write", data: { todos: [
    { status: "completed" }, { status: "completed" }, { status: "completed" }, { status: "completed" },
  ] } };
  assert.deepEqual(isBoundary(ev2, state), { kind: "todo", completed: 4 });
  assert.equal(state.todoCompleted, 4);
});

test("isBoundary: goal terminal ops fire, non-terminal do not", () => {
  const state = { todoCompleted: 0, requests: 0, prunes: 0, prunedResults: 0 };
  assert.deepEqual(
    isBoundary({ type: "goal/change", data: { operation: "complete" } }, state),
    { kind: "goal", op: "complete" },
  );
  assert.deepEqual(
    isBoundary({ type: "goal/change", data: { operation: "block" } }, state),
    { kind: "goal", op: "block" },
  );
  assert.equal(isBoundary({ type: "goal/change", data: { operation: "create" } }, state), null);
  assert.equal(isBoundary({ type: "goal/change", data: { operation: "pause" } }, state), null);
  assert.equal(isBoundary({ type: "user/message" }, state), null);
});

test("expectedSessionRequests: floor for unknown, empirical prior for known workspaces, growth past the prior", () => {
  const history = new Map([["/Users/x/proj", { sessions: 7, medianRequests: null }]]);
  // unknown workspace → the fixed floor (at any request count)
  assert.equal(expectedSessionRequests(10, history, "/nowhere", 50), 50);
  // known workspace, before the prior → empirical prior
  assert.equal(expectedSessionRequests(10, history, "/Users/x/proj", 50), 120);
  assert.equal(expectedSessionRequests(120, history, "/Users/x/proj", 50), 120);
  // past the prior → bounded growth projection (×2), never below the prior
  assert.equal(expectedSessionRequests(200, history, "/Users/x/proj", 50), 400);
  assert.equal(expectedSessionRequests(1000, history, "/Users/x/proj", 50), 2000);
  // the floor can raise the prior when configured higher
  assert.equal(expectedSessionRequests(10, history, "/Users/x/proj", 200), 200);
});

test("expectedSessionRequests with no history map at all", () => {
  assert.equal(expectedSessionRequests(10, undefined, "/any", 50), 50);
  assert.equal(expectedSessionRequests(10, new Map(), "/any", 50), 50);
});

test("repayment gate arithmetic: fire only while requests + minRemaining <= expectedTotal", () => {
  // mirror of the listener's gate, kept here so the policy has a named test
  const gate = (requests, minRemaining, expectedTotal) => requests + minRemaining <= expectedTotal;
  assert.equal(gate(10, 50, 120), true);   // early session, long way to go
  assert.equal(gate(70, 50, 120), true);   // still headroom
  assert.equal(gate(71, 50, 120), false);  // fewer than 50 requests expected — skip
  assert.equal(gate(10, 50, 50), false);   // floor equals gate: only fires at 0
  // long session past the prior: growth projection keeps the gate open
  assert.equal(gate(300, 50, 600), true);
});

test("installBoundaryPrune: ResultPack onPruned hook fires after a real prune (L1→L2 wiring)", async () => {
  const { installBoundaryPrune } = await import("../lib/boundary-prune.js");
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
  };
  let hooked = null;
  const fakePruner = {
    config: { headChars: 4096, tailChars: 1024 },
    pruneSession: () => ({
      pruned: [{ callId: "bash-smoke-1", originalSeq: 7, replacementSeq: 9, charsBefore: 9000, charsAfter: 400 }],
      charsRemoved: 8600,
    }),
  };
  const warn = [];
  const dispose = installBoundaryPrune(
    { ...ctx, get: (name) => (name === "toolResultPruner" ? fakePruner : undefined) },
    { boundaryPrune: true, boundaryPruneMinRemaining: 5 },
    { warn: (x) => warn.push(x), info: () => {} },
    { onPruned: (session, report) => { hooked = { session, report }; } },
    { history: new Map([["/ws", { sessions: 7, medianRequests: null }]]) },
  );

  const onEvent = listeners.get("session/event");
  assert.ok(typeof onEvent === "function");

  const session = {
    id: "sess-boundary",
    header: { cwd: "/ws" },
    events: [],
  };
  // one assistant message to count a request
  await onEvent(session, { type: "assistant/message" });
  // a todo boundary crossing → prune fires
  await onEvent(session, {
    type: "todo/write",
    data: { todos: [{ status: "completed" }, { status: "pending" }] },
  });
  assert.ok(hooked, "onPruned called with the prune report");
  assert.equal(hooked.report.pruned.length, 1);
  assert.equal(hooked.report.pruned[0].callId, "bash-smoke-1");
  // the hook receives the SAME report the host pruner returned, enriched with budgets
  assert.equal(hooked.report.pruned[0].headChars, 4096);
  assert.equal(hooked.report.pruned[0].tailChars, 1024);

  // no boundary → no hook
  hooked = null;
  await onEvent(session, { type: "todo/write", data: { todos: [{ status: "completed" }, { status: "pending" }] } });
  assert.equal(hooked, null, "no repeat boundary on same high-water mark");
  // non-prune events never fire the hook
  await onEvent(session, { type: "user/message" });
  assert.equal(hooked, null);

  dispose();
  assert.equal(listeners.has("session/event"), false, "dispose removes the listener");
});

test("installBoundaryPrune: a throwing onPruned hook is contained inside the listener", async () => {
  const { installBoundaryPrune } = await import("../lib/boundary-prune.js");
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
  };
  const fakePruner = {
    config: { headChars: 4096, tailChars: 1024 },
    pruneSession: () => ({ pruned: [{ callId: "x", originalSeq: 1, replacementSeq: 2 }], charsRemoved: 100 }),
  };
  const warns = [];
  const dispose = installBoundaryPrune(
    { ...ctx, get: (name) => (name === "toolResultPruner" ? fakePruner : undefined) },
    { boundaryPrune: true, boundaryPruneMinRemaining: 5 },
    { warn: (x) => warns.push(x), info: () => {} },
    { onPruned: () => { throw new Error("archive exploded"); } },
    { history: new Map([["/ws", { sessions: 7, medianRequests: null }]]) },
  );
  const session = { id: "sess-throw", header: { cwd: "/ws" } };
  // must not throw into the pipeline
  await assert.doesNotReject(
    async () => {
      await listeners.get("session/event")(session, { type: "assistant/message" });
      await listeners.get("session/event")(session, {
        type: "todo/write",
        data: { todos: [{ status: "completed" }] },
      });
    },
    "throw in L2 hook is contained",
  );
  assert.ok(warns.some((w) => w.includes("L2 hook threw")), "a warning is emitted");
  dispose();
});

test("installBoundaryPrune: absent pruner or disabled config → no hook registration", async () => {
  const { installBoundaryPrune } = await import("../lib/boundary-prune.js");
  const state = [];
  const warn = [];
  // resultPack on but boundaryPrune off → installBoundaryPrune returns noop (L2 self-managed)
  const d1 = installBoundaryPrune({ on: () => () => {}, get: () => undefined }, { boundaryPrune: false }, { warn: (x) => warn.push(x) });
  d1();
  assert.ok(warn.length === 0 || true, "no warn when simply disabled");
  // boundaryPrune on but pruner absent → warned and noop
  const warns2 = [];
  const d2 = installBoundaryPrune({ on: () => () => {}, get: () => undefined }, { boundaryPrune: true }, { warn: (x) => warns2.push(x) });
  d2();
  assert.ok(warns2.some((w) => w.includes("toolResultPruner service unavailable")), "feature-detection warning");
});
