#!/usr/bin/env node
/**
 * G7 — the ledger's own cost.
 *
 * The Context Ledger runs inside the request path (per tool result: tick +
 * noteInjection; per prune: notePrune + estimatePrefixChars, which walks the
 * whole surface). The gate says < 0.5% of request latency. This measures the
 * per-call cost against real step latencies from the machine's session logs,
 * so the denominator is this user's actual harness, not a guess.
 *
 *   node eval/ledger-bench.mjs [--sessions N]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLedger, estimatePrefixChars } from "../lib/ledger.js";
import { decodeZstd, sessionLogFile, sessionsRoot } from "../lib/usage.js";

const DEFAULT_STEP_BUDGET_MS = 900; // conservative fallback if no logs exist

/** p-quantile of a sorted-ish numeric array. */
function quantile(values, q) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

/** Real per-step latency: step/start → step/end, from the newest sessions. */
function stepLatencies(limit = 6) {
  const root = sessionsRoot();
  const files = [];
  for (const bucket of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    if (!bucket.startsWith("--")) continue;
    const dir = path.join(root, bucket);
    for (const id of fs.readdirSync(dir)) {
      const file = sessionLogFile(path.join(dir, id));
      if (fs.existsSync(file)) files.push({ file, mtime: fs.statSync(file).mtimeMs });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const latencies = [];
  for (const { file } of files.slice(0, limit)) {
    let events;
    try {
      events = decodeZstd(file)
        .split("\n")
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      continue;
    }
    let start = 0;
    for (const event of events) {
      if (event.type === "step/start") start = Number(event.time ?? event.at ?? 0);
      else if (event.type === "step/end" && start > 0) {
        const end = Number(event.time ?? event.at ?? 0);
        if (end > start) latencies.push(end - start);
        start = 0;
      }
    }
  }
  return latencies.filter((ms) => ms > 0 && ms < 10 * 60 * 1000);
}

/** A session surface big enough that walking it is visible. */
function fakeSession(messages = 300, charsPerMessage = 400) {
  const nodes = Array.from({ length: messages }, (_, i) => i + 1);
  const events = new Map(
    nodes.map((seq) => [seq, { type: "tool/result", content: [{ type: "text", text: "x".repeat(charsPerMessage) }] }]),
  );
  return {
    surface: { nodes },
    eventAt: (seq) => events.get(seq),
    deriveEventMessage: (event) => ({ content: event.content }),
  };
}

function bench(label, iterations, fn) {
  for (let i = 0; i < Math.min(50, iterations); i += 1) fn(i); // warm up
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) fn(i);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return { label, iterations, totalMs: elapsedMs, perCallUs: (elapsedMs * 1000) / iterations };
}

const args = process.argv.slice(2);
const sessionArg = args.indexOf("--sessions");
const sessionCount = sessionArg >= 0 ? Number(args[sessionArg + 1]) || 6 : 6;

const home = fs.mkdtempSync(path.join(os.tmpdir(), "engram-bench-"));
const ledger = createLedger({ home, flushEvery: 0 });
const session = fakeSession();

// 200 concurrent sessions: tick() scans nothing per-session, but noteInjection
// and the adaptive-gate read summarize the map — size it like a busy machine.
for (let i = 0; i < 200; i += 1) ledger.noteInjection(`sess-${i}`, `/repo/ws-${i % 7}`, "index", 120);

const results = [
  bench("tick()", 20000, (i) => ledger.tick(`sess-${i % 200}`, `/repo/ws-${i % 7}`)),
  bench("noteInjection(600c prompt)", 20000, (i) =>
    ledger.noteInjection(`sess-${i % 200}`, `/repo/ws-${i % 7}`, "index", 600),
  ),
  bench("notePrune(8k tool result)", 2000, (i) =>
    ledger.notePrune(`sess-${i % 200}`, `/repo/ws-${i % 7}`, { charsRemoved: 8192, rewriteChars: 4096 }),
  ),
  bench("estimatePrefixChars(300 msgs ≈120KB)", 500, () => estimatePrefixChars(session)),
  bench("summary()", 500, () => ledger.summary()),
];
ledger.flush();
const persistHome = fs.mkdtempSync(path.join(os.tmpdir(), "engram-bench-flush-"));
const persisting = createLedger({ home: persistHome, flushEvery: 0 });
for (let i = 0; i < 5; i += 1) persisting.tick(`s${i}`, "/repo/ws");
// A flush only writes when something changed — measure the real cost of
// "accumulate one request, then persist", which is what the plugin does.
results.push(
  bench("tick + flush (atomic write, 5 rows)", 200, (i) => {
    persisting.tick(`s${i % 5}`, "/repo/ws");
    persisting.flush();
  }),
);

const latencies = stepLatencies(sessionCount);
const p50 = latencies.length > 0 ? quantile(latencies, 0.5) : DEFAULT_STEP_BUDGET_MS;
const p95 = latencies.length > 0 ? quantile(latencies, 0.95) : DEFAULT_STEP_BUDGET_MS;

// One tool result ≈ tick + noteInjection (+ a prune on boundaries).
const perResult = results[0].perCallUs + results[1].perCallUs;
const perPrune = results[2].perCallUs + results[3].perCallUs;
const shareOfStep = (us) => (us / 1000 / p50) * 100;

console.log(`ledger bench · ${latencies.length} real step latencies (${sessionCount} newest sessions)`);
console.log(`  step p50 ${p50.toFixed(0)}ms · p95 ${p95.toFixed(0)}ms${latencies.length === 0 ? " (no logs — fallback budget)" : ""}\n`);
console.log("  operation                                   per-call         % of p50 step");
for (const row of results) {
  console.log(
    `  ${row.label.padEnd(42)} ${row.perCallUs.toFixed(2).padStart(8)}µs ${shareOfStep(row.perCallUs).toFixed(4).padStart(10)}%`,
  );
}
console.log(
  `  ${"per tool result (tick + inject)".padEnd(42)} ${perResult.toFixed(2).padStart(8)}µs ${shareOfStep(perResult).toFixed(4).padStart(10)}%`,
);
console.log(
  `  ${"per boundary prune (prune + prefix walk)".padEnd(42)} ${perPrune.toFixed(2).padStart(8)}µs ${shareOfStep(perPrune).toFixed(4).padStart(10)}%`,
);

const worst = Math.max(shareOfStep(perResult), shareOfStep(perPrune));
// A step p50 of several seconds makes any instrumentation look free. Report a
// strict floor too — a fast 300ms request — so the verdict is not an artifact
// of long tool calls inflating the denominator.
const strictFloorMs = 300;
const worstStrict = (perPrune / 1000 / strictFloorMs) * 100;
console.log(
  `\n  strict floor: worst op ${worstStrict.toFixed(4)}% of a ${strictFloorMs}ms request (no tool time in the denominator)`,
);
const gate = 0.5;
const strictPass = worstStrict < gate;
console.log(
  `  G7  ${worst < gate && strictPass ? "PASS" : "FAIL"}  worst ${worst.toFixed(4)}% of a p50 step · ${worstStrict.toFixed(4)}% of a 300ms request (gate < ${gate}%)`,
);

for (const dir of [home, persistHome]) fs.rmSync(dir, { recursive: true, force: true });
process.exitCode = worst < gate && strictPass ? 0 : 1;
