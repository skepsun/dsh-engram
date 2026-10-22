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

test("G1 counts net-positive sessions from ledger rows; G2 counts activated mounted sessions", () => {
  const home = tmpDir("engram-home-");
  const root = tmpDir("engram-sessions-");

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
        s1: { sessionId: "s1", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 10, injectedChars: 100, avoidedChars: 5000, rewriteCount: 0, rewriteChars: 0 },
        s2: { sessionId: "s2", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 2, injectedChars: 900, avoidedChars: 0, rewriteCount: 0, rewriteChars: 0 },
        s3: { sessionId: "s3", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 8, injectedChars: 100, avoidedChars: 4000, rewriteCount: 0, rewriteChars: 0 },
        s4: { sessionId: "s4", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 6, injectedChars: 100, avoidedChars: 3000, rewriteCount: 0, rewriteChars: 0 },
        s5: { sessionId: "s5", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 5, injectedChars: 100, avoidedChars: 2000, rewriteCount: 0, rewriteChars: 0 },
        s6: { sessionId: "s6", workspace: "/ws", firstDay: day, lastDay: day, updatedAt: Date.now(), requests: 4, injectedChars: 100, avoidedChars: 1000, rewriteCount: 0, rewriteChars: 0 },
      },
    }),
    "utf8",
  );

  // s1: mounted + activated + one hit recall + one detail + a [RECALL] header.
  seedSession(root, "--p--", "s1", [
    { type: "session", cwd: "/ws" },
    { type: "tool/call", data: { name: "engram_recall", callId: "c1" } },
    R4("c1", '# recall: "build" (1)\n- 3b9840b5 [error] fix build'),
    { type: "tool/call", data: { name: "engram_detail", callId: "c2" } },
    R4("c2", "record"),
    { type: "request/header", data: { messages: [{ content: "[RECALL] recall · 1 hit(s) · first msg: build → #3b9840b5" }] } },
  ]);
  // s2: mounted but no engram/esr call (a miss for the activation gate).
  seedSession(root, "--p--", "s2", [
    { type: "session", cwd: "/ws" },
    { type: "tool/call", data: { name: "bash", callId: "c3" } },
    R4("c3", "ok"),
  ]);

  const report = auditGates({ home, root, days: 14 });
  const byId = Object.fromEntries(report.gates.map((g) => [g.id, g]));
  assert.equal(report.ledger.rows, 6);
  assert.equal(byId.G1.value, "83.3%", "five of six sessions are net-positive");
  assert.equal(byId.G1.verdict, "PASS", "83.3% meets the pre-declared floor");
  assert.equal(byId.G1b.verdict, "未测", "no ≥200-request session yet — not a pass");
  assert.equal(byId.G2.value, "50.0%");
  assert.equal(byId.G2.verdict, "FAIL", "below the 60% activation floor");
  assert.equal(report.activation.pushFired, 1, "the [RECALL] header is counted");
  assert.equal(report.drill.detailCalls, 1);
  assert.equal(report.drill.recallWithHits, 1);
  assert.equal(byId.G3.value, "1.00");
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
