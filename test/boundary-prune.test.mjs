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
