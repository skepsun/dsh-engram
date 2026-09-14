/**
 * L0 counterfactual simulation for PROPOSAL-resultpack (BoundaryPrune):
 * "If we had pruned over-threshold tool results at goal/todo boundaries,
 *  how much replay exposure would have been saved — net of cache-break cost?"
 *
 * Inputs: the oracle report JSON (eval/oracle-analysis.mjs --out) — per-session
 * results [{chars, seq, name}], assistantMsgs (request seqs), compactionEndSeqs,
 * goalOps, todoWrites, spliceSeqs. Zero LLM, fully deterministic.
 *
 * Model (mirrors the proposal §L0):
 *  - Boundaries: goal operation "complete"/"block"; todo/write that strictly
 *    increases the completed count (step) or completes the list (done).
 *  - At boundary b, every earlier result with chars > threshold and not yet
 *    pruned by an earlier simulated boundary is pruned to head+marker+tail
 *    (DSH ToolResultPruner semantics; marker ≈ 42 chars).
 *  - Savings accrue for requests strictly after b and before that result's
 *    next compaction/end (history rewritten there anyway) — the M1 "cut" rule.
 *  - Accounting modes:
 *      naive      : charsSaved × requestsAfter (no cache pricing; upper bound)
 *      cacheAware : savings × cachePrice; one-time break cost =
 *                   livePrefixCharsAtFirstPrunedNode × (1 − cachePrice)
 *      rideFree   : same, but boundaries within BREAK_WINDOW requests after a
 *                   splice/compaction (prefix already cold) pay no break cost
 *  - Repayment: requests needed for discounted savings to repay the break
 *    cost — the runtime gate parameter (SoL-Pi Online Context Compact clock).
 *
 * Sweep: threshold configs × boundary strategies. Usage:
 *   node eval/simulate-boundary-prune.mjs [report.json]
 */

import fs from "node:fs";

const reportPath = process.argv[2] ?? "/tmp/oracle-full.json";
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

/** DSH ToolResultPruner-style configs: {threshold, head, tail}. */
const CONFIGS = [
  { name: "T8192 (DSH default)", threshold: 8192, head: 4096, tail: 1024 },
  { name: "T4096", threshold: 4096, head: 2048, tail: 512 },
  { name: "T2048", threshold: 2048, head: 1024, tail: 256 },
];
const STRATEGIES = ["goal-only", "todo-progress", "goal+todo"];
const CACHE_PRICE = 0.1; // cached read ≈ 1/10 of full price (provider-typical)
const MARKER_CHARS = 42;
/** A boundary within this many requests after a splice/compaction rides free. */
const BREAK_WINDOW = 5;

function boundariesFor(session, strategy) {
  const list = [];
  if (strategy !== "todo-progress") {
    for (const g of session.goalOps ?? []) {
      if (g.op === "complete" || g.op === "block") list.push({ seq: g.seq, kind: "goal" });
    }
  }
  if (strategy !== "goal-only") {
    const writes = session.todoWrites ?? [];
    let prevCompleted = 0;
    for (const w of writes) {
      if (w.completed > prevCompleted && w.completed >= w.total) {
        list.push({ seq: w.seq, kind: "todo-done" });
      } else if (w.completed > prevCompleted) {
        list.push({ seq: w.seq, kind: "todo-step" });
      }
      prevCompleted = Math.max(prevCompleted, w.completed);
    }
  }
  return list.sort((a, b) => a.seq - b.seq);
}

function simulate(session, config, strategy) {
  const results = (session.simResults ?? []).filter(
    (r) => r.name !== "engram_recall" && r.name !== "engram_detail",
  );
  const requestSeqs = (session.simAssistantMsgs ?? []).map((m) => m.seq);
  const assistantMsgs = session.simAssistantMsgs ?? [];
  const userMsgs = session.simUserMsgs ?? [];
  const compactionEnds = session.compactionEndSeqs ?? [];
  const spliceSeqs = session.spliceSeqs ?? [];
  const cutoffAfter = (seq) => {
    for (const c of compactionEnds) if (c > seq) return c;
    return Infinity;
  };
  const boundaries = boundariesFor(session, strategy);
  const pruned = new Set();
  const prunedSize = config.head + MARKER_CHARS + config.tail;

  const acc = {
    naive: 0, cacheNet: 0, rideFreeNet: 0,
    prunedCount: 0, fired: 0, boundaries: boundaries.length,
    repayments: [], // {repayRequests, ridesFree}
  };

  for (const b of boundaries) {
    let charsSavedTotal = 0;
    let firstPrunedSeq = Infinity;
    let naiveDelta = 0;
    let discountedDelta = 0;
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      if (pruned.has(i) || r.seq >= b.seq || r.chars <= config.threshold) continue;
      pruned.add(i);
      acc.prunedCount += 1;
      const charsSaved = r.chars - prunedSize;
      if (charsSaved <= 0) continue;
      firstPrunedSeq = Math.min(firstPrunedSeq, r.seq);
      const cutoff = cutoffAfter(r.seq);
      const requestsAfter = requestSeqs.filter((s) => s > b.seq && s < cutoff).length;
      naiveDelta += charsSaved * requestsAfter;
      discountedDelta += charsSaved * requestsAfter * CACHE_PRICE;
      charsSavedTotal += charsSaved;
    }
    if (charsSavedTotal <= 0) continue;
    acc.fired += 1;
    acc.naive += naiveDelta;

    // one-time cache-break cost: the live prefix at the first pruned node is
    // re-encoded once at full price instead of cache price.
    let prefixChars = 0;
    for (const r of results) if (r.seq < firstPrunedSeq) prefixChars += r.chars;
    for (const m of assistantMsgs) if (m.seq < firstPrunedSeq) prefixChars += m.chars;
    for (const m of userMsgs) if (m.seq < firstPrunedSeq) prefixChars += m.chars;
    const breakCost = prefixChars * (1 - CACHE_PRICE);

    // ride-free: boundary within BREAK_WINDOW requests after the latest
    // splice/compaction at or before it (the prefix is already cold).
    let lastBreakSeq = 0;
    for (const s of spliceSeqs) if (s <= b.seq && s > lastBreakSeq) lastBreakSeq = s;
    for (const s of compactionEnds) if (s <= b.seq && s > lastBreakSeq) lastBreakSeq = s;
    const requestsSinceBreak = requestSeqs.filter((s) => s > lastBreakSeq && s <= b.seq).length;
    const ridesFree = lastBreakSeq > 0 && requestsSinceBreak <= BREAK_WINDOW;

    acc.cacheNet += discountedDelta - breakCost;
    acc.rideFreeNet += ridesFree ? discountedDelta : discountedDelta - breakCost;
    acc.repayments.push({
      repayRequests: ridesFree ? 0 : Math.ceil(breakCost / Math.max(1, charsSavedTotal * CACHE_PRICE)),
      ridesFree,
    });
  }
  return acc;
}

const fmt = (n) => {
  if (!Number.isFinite(n)) return "n/a";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
};

// ---- run the sweep ---------------------------------------------------------
const sessions = report.sessions.filter((s) => (s.requests ?? 0) > 10);
const totalCutExposure = sessions.reduce((a, s) => a + (s.exposure?.results?.cut ?? 0), 0);

console.log(`L0 BoundaryPrune counterfactual — ${sessions.length} sessions (>10 reqs), M1 cut exposure ${fmt(totalCutExposure)}c`);
console.log(`cache price ${CACHE_PRICE}, break window ${BREAK_WINDOW} requests\n`);

for (const strategy of STRATEGIES) {
  for (const config of CONFIGS) {
    let naive = 0, cacheNet = 0, rideFreeNet = 0;
    let prunedCount = 0, fired = 0, totalBoundaries = 0, sessionsWithFire = 0;
    const repayments = [];
    for (const s of sessions) {
      const r = simulate(s, config, strategy);
      naive += r.naive; cacheNet += r.cacheNet; rideFreeNet += r.rideFreeNet;
      prunedCount += r.prunedCount; fired += r.fired; totalBoundaries += r.boundaries;
      if (r.fired > 0) sessionsWithFire += 1;
      repayments.push(...r.repayments);
    }
    const paying = repayments.filter((r) => !r.ridesFree);
    const ridesShare = repayments.length ? repayments.filter((r) => r.ridesFree).length / repayments.length : 0;
    const medRepay = (() => {
      if (paying.length === 0) return NaN;
      const v = paying.map((r) => r.repayRequests).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    })();
    const p90Repay = (() => {
      if (paying.length === 0) return NaN;
      const v = paying.map((r) => r.repayRequests).sort((a, b) => a - b);
      return v[Math.min(v.length - 1, Math.ceil(v.length * 0.9) - 1)];
    })();

    console.log(`[${strategy}] ${config.name}`);
    console.log(`  boundaries fired ${fired}/${totalBoundaries} (prunable present), sessions covered ${sessionsWithFire}/${sessions.length}, results pruned ${prunedCount}`);
    console.log(`  naive upper bound : ${fmt(naive)}c (${((naive / totalCutExposure) * 100).toFixed(1)}% of M1 cut exposure)`);
    console.log(`  cache-aware net   : ${fmt(cacheNet)}c   ride-free net: ${fmt(rideFreeNet)}c`);
    console.log(`  repayment         : median ${medRepay} / p90 ${p90Repay} requests to break even (paying boundaries); ${Math.round(ridesShare * 100)}% ride an existing break\n`);
  }
}
