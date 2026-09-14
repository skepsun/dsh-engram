/**
 * Dry-run the boundary-prune listener across ALL session logs: replay each
 * session's events through the real isBoundary/gate/pruner-shape logic and
 * report the mechanism's true activation surface (which sessions would fire,
 * how many results pruned, chars saved). No DSH host needed.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { isBoundary, expectedSessionRequests, workspaceHistory } from "/Users/sunchuxiong/dsh-loom/lib/boundary-prune.js";

const root = path.join(os.homedir(), ".dsh", "sessions");
const MIN_REMAINING = 50;
const TH = 8192, PRUNED_SIZE = 4096 + 42 + 1024; // DSH ToolResultPruner defaults
const history = workspaceHistory();

async function* events(file) {
  const child = spawn("zstd", ["-dcq", file], { stdio: ["ignore", "pipe", "ignore"] });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try { yield JSON.parse(line); } catch { /* torn */ }
  }
}

const summarize = [];
for (const bucket of fs.readdirSync(root)) {
  if (!bucket.startsWith("--")) continue;
  const bdir = path.join(root, bucket);
  for (const sid of fs.readdirSync(bdir)) {
    const file = path.join(bdir, sid, "session.jsonl.zstd");
    try { if (fs.statSync(file).size === 0) continue; } catch { continue; }
    const workspace = decodeURIComponent(bucket.replace(/^--/, "").replace(/--$/, ""));
    const state = { todoCompleted: 0, requests: 0, prunes: 0, prunedResults: 0 };
    const results = new Map();
    let fired = 0, gateBlocked = 0, prunedTotal = 0, savedTotal = 0;
    for await (const event of events(file)) {
      const type = event?.type;
      if (type === "assistant/message") { state.requests += 1; continue; }
      if (type === "tool/result") {
        const blocks = event?.data?.message?.content ?? [];
        let n = 0;
        for (const c of blocks) {
          if (typeof c?.text === "string") n += c.text.length;
          if (Array.isArray(c?.content)) for (const i of c.content) if (typeof i?.text === "string") n += i.text.length;
        }
        results.set(event.seq, { chars: n, pruned: false });
        continue;
      }
      const boundary = isBoundary(event, state);
      if (boundary === null) continue;
      const expectedTotal = expectedSessionRequests(state.requests, history, workspace, MIN_REMAINING);
      if (state.requests + MIN_REMAINING > expectedTotal) { gateBlocked += 1; continue; }
      let pruned = 0, saved = 0;
      for (const r of results.values()) {
        if (!r.pruned && r.chars > TH) { r.pruned = true; pruned += 1; saved += r.chars - PRUNED_SIZE; }
      }
      if (pruned > 0) { fired += 1; prunedTotal += pruned; savedTotal += saved; }
    }
    if (state.requests > 10) {
      summarize.push({ sid, workspace: workspace.split("/").pop(), requests: state.requests, fired, gateBlocked, prunedTotal, savedTotal });
    }
  }
}

summarize.sort((a, b) => b.savedTotal - a.savedTotal);
const fired = summarize.filter((s) => s.fired > 0);
const totalSaved = fired.reduce((a, s) => a + s.savedTotal, 0);
console.log(`sessions(>10 reqs)=${summarize.length}  fired-sessions=${fired.length} (${((fired.length / summarize.length) * 100).toFixed(0)}%)`);
console.log(`total results pruned=${fired.reduce((a, s) => a + s.prunedTotal, 0)}  chars saved≈${(totalSaved / 1e6).toFixed(2)}M`);
console.log("\ntop-8 sessions by saved chars:");
for (const s of fired.slice(0, 8)) {
  console.log(`  ${String(Math.round(s.savedTotal / 1e3)).padStart(7)}Kc  reqs=${String(s.requests).padStart(4)}  fired=${s.fired} pruned=${s.prunedTotal}  ${s.workspace}/${s.sid.slice(0, 13)}`);
}
console.log(`\ngate-blocked boundaries total: ${summarize.reduce((a, s) => a + s.gateBlocked, 0)}`);