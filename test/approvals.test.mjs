/**
 * v0.8-D: the approval gate between "evidence says this worked" and "a file the
 * host advertises says this is the way".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { approvedIds, isApproved, loadApprovals, recordApproval, revokeApproval } from "../lib/approvals.js";

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "engram-approvals-"));
}

test("a missing approvals file means nothing is approved", () => {
  const home = tmpHome();
  const state = loadApprovals(home);
  assert.deepEqual(approvedIds(state, "/ws"), []);
  assert.equal(isApproved(state, "/ws", "m1"), false);
});

test("approval is recorded per workspace and survives a reload", () => {
  const home = tmpHome();
  recordApproval(home, "/ws", "m1", { note: "checked by hand", at: 123 });
  const state = loadApprovals(home);
  assert.equal(isApproved(state, "/ws", "m1"), true);
  assert.equal(isApproved(state, "/other", "m1"), false);
  assert.deepEqual(state.workspaces["/ws"].m1, { at: 123, note: "checked by hand" });
});

test("revoking removes only that id and drops an empty workspace", () => {
  const home = tmpHome();
  recordApproval(home, "/ws", "m1");
  recordApproval(home, "/ws", "m2");
  revokeApproval(home, "/ws", "m1");
  const state = loadApprovals(home);
  assert.deepEqual(approvedIds(state, "/ws"), ["m2"]);
  revokeApproval(home, "/ws", "m2");
  assert.equal(loadApprovals(home).workspaces["/ws"], undefined);
});

test("a corrupt approvals file degrades to nothing approved, not a crash", () => {
  const home = tmpHome();
  fs.writeFileSync(path.join(home, "playbook-approvals.json"), "{ not json");
  assert.deepEqual(approvedIds(loadApprovals(home), "/ws"), []);
});

test("approve refuses an empty id", () => {
  const home = tmpHome();
  assert.throws(() => recordApproval(home, "/ws", ""), /memory id/);
});
