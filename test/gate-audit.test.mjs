/**
 * Gate audit tests (eval/gate-audit.mjs) — the §6 gates must be computable from
 * local data, and must say 「未测」 instead of guessing when data is missing.
 *
 * The bug this pins: /stats and the audit both read only the v3 tool-result
 * shape, so on DSH 0.2.x every failure count and recall-hits tally was a silent
 * zero. A gate that always reads 0 is worse than no gate.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";

import { auditGates } from "../eval/gate-audit.mjs";
import { ledgerFile } from "../lib/ledger.js";

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** One session log in the v4 (DSH 0.2.x) shape. */
function seedSession(root, bucket, sid, lines) {
  const dir = path.join(root, bucket, sid);
  fs.mkdirSync(dir, { recursive: true });
  const payload = lines.map((line) => `${JSON.stringify(line)}\n`).join("");
  fs.writeFileSync(path.join(dir, "session.v4.jsonl.zstd"), zstdCompressSync(Buffer.from(payload)));
}

const R4 = (callId, text, isError = false) => ({
  type: "tool/result",
  data: {
    message: { role: "tool", source: { kind: "tool", callId }, toolCallId: callId, isError, content: [{ type: "text", text }] },
  },
});

test("gates read 未测 when nothing has run — never a fake PASS", () => {
  const home = tmpDir("engram-home-");
  const root = tmpDir("engram-sessions-");
  const report = auditGates({ home, root, days: 14 });
  const byId = Object.fromEntries(report.gates.map((g) => [g.id, g]));
  assert.equal(byId.G1.verdict, "未测");
  assert.equal(byId.G1b.verdict, "未测");
  assert.equal(byId.G2.verdict, "未测");
  assert.equal(byId.G3.verdict, "未测");
  assert.equal(byId.G6.verdict, "未测", "quality delta is never derivable from logs");
});

test("G1 counts net-positive sessions from ledger rows; G2 counts activated INSTALLED sessions", () => {
  const home = tmpDir("engram-home-");
  const root = tmpDir("engram-sessions-");
  // An armed savings path: without one, nothing can ever be credited and G1
  // refuses to judge (see the test below).
  fs.writeFileSync(
    path.join(home, "context-gc.status.json"),
    JSON.stringify({ version: 1, host: "context-gc", web: { action: "wired" }, boundaryPrune: { armed: false } }),
    "utf8",
  );

  // Six ledger rows: five profitable, one cost-only. Five is the minimum the
  // gate will judge (a single session is not a distribution).
  const day = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    ledgerFile(home),
    JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      workspaces: {},
      sessions: {
        // Six sessions WITH a saving opportunity (a prune or compaction ran).
        s1: { sessionId: "s1", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 10, injectedChars: 100, avoidedChars: 5000, prunedChars: 4000, rewriteCount: 0, rewriteChars: 0 },
        s2: { sessionId: "s2", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 2, injectedChars: 900, avoidedChars: 0, prunedChars: 500, rewriteCount: 0, rewriteChars: 0 },
        s3: { sessionId: "s3", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 8, injectedChars: 100, avoidedChars: 4000, prunedChars: 3000, rewriteCount: 0, rewriteChars: 0 },
        s4: { sessionId: "s4", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 6, injectedChars: 100, avoidedChars: 3000, prunedChars: 2000, rewriteCount: 0, rewriteChars: 0 },
        s5: { sessionId: "s5", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 5, injectedChars: 100, avoidedChars: 2000, prunedChars: 1000, rewriteCount: 0, rewriteChars: 0 },
        s6: { sessionId: "s6", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 4, injectedChars: 100, avoidedChars: 1000, prunedChars: 800, rewriteCount: 0, rewriteChars: 0 },
        // Two sessions with NO opportunity: nothing was pruned or compacted, so
        // they can only be net-negative. Counting them would measure activation,
        // not payoff — the G1 denominator must ignore them.
        n1: { sessionId: "n1", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 10, injectedChars: 700, avoidedChars: 0, rewriteCount: 0, rewriteChars: 0 },
        n2: { sessionId: "n2", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 10, injectedChars: 800, avoidedChars: 0, rewriteCount: 0, rewriteChars: 0 },
      },
    }),
    "utf8",
  );

  // x1: engram live + activated + one hit recall + one detail + a [RECALL] header.
  // (Deliberately NOT "s1"/"s2": those ids carry ledger rows, and a ledger row is
  // itself evidence that the plugin was running — an id collision would smuggle
  // the second session into G2's denominator.)
  seedSession(root, "--p--", "x1", [
    { type: "session", cwd: "/ws" },
    { type: "tool/call", data: { name: "engram_recall", callId: "c1" } },
    R4("c1", '# recall: "build" (1)\n- 3b9840b5 [error] fix build'),
    { type: "tool/call", data: { name: "engram_detail", callId: "c2" } },
    R4("c2", "record"),
    { type: "request/header", data: { messages: [{ content: "[RECALL] recall · 1 hit(s) · first msg: build → #3b9840b5" }] } },
  ]);
  // x2: some other tool ran, but nothing engram — not in the population at all.
  seedSession(root, "--p--", "x2", [
    { type: "session", cwd: "/ws" },
    { type: "tool/call", data: { name: "bash", callId: "c3" } },
    R4("c3", "ok"),
  ]);

  const report = auditGates({ home, root, days: 14 });
  const byId = Object.fromEntries(report.gates.map((g) => [g.id, g]));
  assert.equal(report.ledger.rows, 8, "all flushed rows");
  assert.equal(report.ledger.opportunityRows, 6, "only rows with a prune/compaction pay G1's denominator");
  assert.equal(byId.G1.value, "83.3%", "five of six opportunity sessions are net-positive");
  assert.match(byId.G1.note, /5\/6 sessions with a saving opportunity \(8 rows total\)/);
  assert.equal(byId.G1.verdict, "PASS", "83.3% meets the pre-declared floor");
  assert.equal(byId.G1b.verdict, "未测", "no ≥200-request session yet — not a pass");
  // x2 ran `bash` and nothing else: no engram tool, no [RECALL] block, no ledger
  // row. It is not an activation miss — the plugin was never loaded in it, so it
  // cannot be in the denominator (that proxy put three real sessions on this
  // machine into G2 and read 50% while the truth was 3/3).
  assert.equal(report.window.mounted, 1, "only x1 has engram live");
  assert.equal(report.window.anyTool, 2, "both sessions ran some tool — the old, wrong denominator");
  assert.equal(byId.G2.value, "100.0%");
  assert.equal(byId.G2.verdict, "未测", "one installed session is not a distribution");
  assert.match(byId.G2.note, /1\/1 installed sessions .*样本不足/);
  assert.match(byId.G2.note, /1 个根本没装 engram/);
  assert.equal(report.activation.pushFired, 1, "the [RECALL] header is counted");
  assert.equal(report.drill.detailCalls, 1);
  assert.equal(report.drill.recallWithHits, 1);
  assert.equal(byId.G3.value, "1.00");
});

test("G1 refuses to judge when neither savings path is armed — FAIL would blame the config", () => {
  const home = tmpDir("engram-home-");
  const root = tmpDir("engram-sessions-");
  const day = new Date().toISOString().slice(0, 10);
  const rows = {};
  for (let i = 1; i <= 6; i += 1) {
    // A prune happened (so the row is in G1's denominator) but nothing was
    // credited — exactly the shape of "the savings path is not armed".
    rows[`s${i}`] = { sessionId: `s${i}`, workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 10, injectedChars: 900, avoidedChars: 0, prunedChars: 500, rewriteCount: 0, rewriteChars: 0 };
  }
  fs.writeFileSync(ledgerFile(home), JSON.stringify({ version: 1, updatedAt: Date.now(), workspaces: {}, sessions: rows }), "utf8");
  // The live shape from a profile that reverted Context GC to opt-in: L1 off,
  // host compaction not engram's, web plane disabled.
  fs.writeFileSync(
    path.join(home, "context-gc.status.json"),
    JSON.stringify({
      version: 1,
      host: "unavailable",
      web: { action: "disabled", presets: [] },
      boundaryPrune: { armed: false, reason: "no toolResultPruner service in the host plane" },
    }),
    "utf8",
  );

  const byId = Object.fromEntries(auditGates({ home, root, days: 14 }).gates.map((g) => [g.id, g]));
  assert.equal(byId.G1.value, "0.0%", "the cost side still reads out");
  assert.equal(byId.G1.verdict, "未测", "no credit path → no verdict, even with 6 rows");
  assert.match(byId.G1.note, /no savings path is armed/);
  assert.equal(byId.G1b.verdict, "未测");
});

test("G4 flags superseded rows in the memory table", () => {
  const home = tmpDir("engram-home-");
  const root = tmpDir("engram-sessions-");
  const storages = path.join(home, "storages");
  fs.mkdirSync(storages, { recursive: true });
  fs.writeFileSync(
    path.join(storages, "dsh_engram.json"),
    JSON.stringify({
      unit: { name: "dsh_engram", version: 1 },
      tables: {
        memories: {
          a: { id: "a", kind: "fact", tags: [], supersededBy: "b" },
          b: { id: "b", kind: "fact", tags: [] },
          c: { id: "c", kind: "episode", tags: [] },
        },
      },
    }),
    "utf8",
  );
  const report = auditGates({ home, root, days: 14 });
  const g4 = report.gates.find((g) => g.id === "G4");
  assert.match(g4.note, /1\/2 memories/, "episodes are excluded from the share");
  assert.equal(g4.value, "50.0%");
  assert.equal(g4.verdict, "FAIL");
});

test("G7 stays 未测 without a measurement, and reports the bench number when given", () => {
  // G7 is a benchmark, not a log-derived metric: it must never invent a PASS.
  const untested = auditGates({ home: "/nonexistent-engram-home-for-test", days: 14 });
  assert.equal(untested.gates.find((g) => g.id === "G7").verdict, "未测");

  const measured = auditGates({ home: "/nonexistent-engram-home-for-test", days: 14, g7: 0.2137 });
  const gate = measured.gates.find((g) => g.id === "G7");
  assert.equal(gate.verdict, "PASS");
  assert.match(gate.value, /0\.2137%/);

  const failing = auditGates({ home: "/nonexistent-engram-home-for-test", days: 14, g7: 1.2 });
  assert.equal(failing.gates.find((g) => g.id === "G7").verdict, "FAIL");
});

test("G2's opportunity row only counts sessions whose workspace has memories", () => {
  const home = tmpDir("engram-home-");
  const root = tmpDir("engram-sessions-");
  // Two workspaces: one with a memory, one without.
  fs.mkdirSync(path.join(home, "storages"), { recursive: true });
  fs.writeFileSync(
    path.join(home, "storages", "dsh_engram.json"),
    JSON.stringify({
      version: 1,
      tables: {
        memories: {
          m1: { id: "m1", workspace: "/with-memory", kind: "fact", text: "x", tags: [], createdAt: Date.now() },
        },
      },
    }),
    "utf8",
  );
  // Both sessions are installed (engram tool present) and neither pushed.
  for (const [bucket, sid, ws] of [["--a--", "no-memory", "/empty"], ["--b--", "has-memory", "/with-memory"]]) {
    seedSession(root, bucket, sid, [
      { type: "session", cwd: ws },
      { type: "tool/call", data: { name: "engram_status", callId: `c-${sid}` } },
    ]);
  }
  const report = auditGates({ home, root, days: 14 });
  const byId = Object.fromEntries(report.gates.map((g) => [g.id, g]));
  assert.equal(report.window.mounted, 2, "both sessions have engram live");
  assert.equal(byId.G2b.value, "0.0%", "neither rendered a block");
  assert.equal(byId.G2c.value, "0.0%");
  // The point of the row: the workspace WITHOUT memories is not a push miss, so
  // it must not dilute the opportunity denominator.
  assert.equal(byId.G2c.note, "0/1 sessions whose workspace has ≥1 memory");
});
