/**
 * Activation telemetry tests (lib/pack-telemetry.js) — pure FS bookkeeping
 * under a temp home. Zero LLM, deterministic.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  engramHome,
  recordBoundaryPruneFire,
  readBoundaryPruneStats,
  recordRecallInjection,
  readRecallInjections,
  readPackTelemetry,
} from "../lib/pack-telemetry.js";

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpack-telemetry-"));
  return dir;
}

test("engramHome defaults to ~/.dsh/engram", () => {
  assert.equal(engramHome(), path.join(os.homedir(), ".dsh", "engram"));
  assert.equal(engramHome("/x"), "/x");
});

test("recordBoundaryPruneFire: cumulative across fires, byKind breakdown", () => {
  const home = tmpHome();
  let st = readBoundaryPruneStats({ home });
  assert.equal(st, null, "no file yet → null");

  const r1 = { pruned: [{}, {}, {}], charsRemoved: 12000 };
  const st1 = recordBoundaryPruneFire({ home, boundary: { kind: "todo" }, report: r1, workspace: "/ws", now: 1000 });
  assert.equal(st1.fires, 1);
  assert.equal(st1.prunedResults, 3);
  assert.equal(st1.charsRemoved, 12000);
  assert.equal(st1.byKind.todo, 1);
  assert.equal(st1.lastWorkspace, "/ws");
  assert.equal(st1.lastFire, 1000);

  const r2 = { pruned: [{}], charsRemoved: 500 };
  recordBoundaryPruneFire({ home, boundary: { kind: "goal" }, report: r2, workspace: "/ws", now: 2000 });
  const st2 = readBoundaryPruneStats({ home });
  assert.equal(st2.fires, 2);
  assert.equal(st2.prunedResults, 4);
  assert.equal(st2.charsRemoved, 12500);
  assert.equal(st2.byKind.todo, 1);
  assert.equal(st2.byKind.goal, 1);
  assert.equal(st2.lastFire, 2000);

  fs.rmSync(home, { recursive: true, force: true });
});

test("recordBoundaryPruneFire: degenerate report does not crash (zero/absent fields)", () => {
  const home = tmpHome();
  const st = recordBoundaryPruneFire({ home, boundary: null, report: null });
  assert.equal(st.fires, 1);
  assert.equal(st.prunedResults, 0);
  assert.equal(st.byKind.unknown, 1);
  // a second record on the same file still works
  const st2 = recordBoundaryPruneFire({ home, boundary: { kind: "todo" }, report: { pruned: [{}], charsRemoved: 10 } });
  assert.equal(st2.fires, 2);
  assert.equal(st2.byKind.todo, 1);
  fs.rmSync(home, { recursive: true, force: true });
});

test("recordRecallInjection: cumulative + hit counts", () => {
  const home = tmpHome();
  let r = readRecallInjections({ home });
  assert.equal(r, null);

  recordRecallInjection({ home, workspace: "/ws", hits: 3 });
  recordRecallInjection({ home, workspace: "/ws", hits: 0 });
  const r2 = readRecallInjections({ home });
  assert.equal(r2.injections, 2);
  assert.equal(r2.hitInjections, 1);
  assert.equal(r2.hitsInjected, 3);

  fs.rmSync(home, { recursive: true, force: true });
});

test("readPackTelemetry aggregates both records", () => {
  const home = tmpHome();
  recordBoundaryPruneFire({ home, boundary: { kind: "todo" }, report: { pruned: [{}], charsRemoved: 10 } });
  recordRecallInjection({ home, hits: 1 });
  const agg = readPackTelemetry({ home });
  assert.equal(agg.boundaryPrune.fires, 1);
  assert.equal(agg.recall.injections, 1);
  fs.rmSync(home, { recursive: true, force: true });
});

test("telemetry writes are atomic tmp+rename and never throw on bad home", () => {
  // an unwritable home must not throw — best-effort telemetry
  const missingParent = path.join(os.tmpdir(), "no-such-dir-xyz", "deep", "home");
  const st = recordBoundaryPruneFire({ home: missingParent, boundary: { kind: "todo" }, report: { pruned: [{}] } });
  assert.ok(st, "returns the computed stats even when the write failed");
});
