// F counterfactual: what if boundary-prune also fired on request-count cadence
// for sessions with no todo/goal boundary? Simulate: every N requests, if the
// repayment gate allows, prune all over-threshold results. Compare saved bytes.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { isBoundary, expectedSessionRequests, workspaceHistory } from "/Users/sunchuxiong/dsh-loom/lib/boundary-prune.js";

const root = path.join(os.homedir(), ".dsh", "sessions");
const history = workspaceHistory();
const PRUNED_SIZE = 4096 + 42 + 1024;

async function* events(file) {
  const c = spawn("zstd", ["-dcq", file]);
  const rl = createInterface({ input: c.stdout });
  for await (const l of rl) {
    if (!l) continue;
    try { yield JSON.parse(l); } catch {}
  }
}

// mode: "boundary-only" (baseline) | `{cadence: N}` adds request-count firing
function run(mode) {
  return (async () => {
    let totalSaved = 0, sessions = 0, firedSessions = 0, totalPruned = 0;
    for (const bucket of fs.readdirSync(root)) {
      if (!bucket.startsWith("--")) continue;
      for (const sid of fs.readdirSync(path.join(root, bucket))) {
        const file = path.join(root, bucket, sid, "session.jsonl.zstd");
        try { if (fs.statSync(file).size === 0) continue; } catch { continue; }
        const workspace = decodeURIComponent(bucket.replace(/^--/, "").replace(/--$/, ""));
        const state = { todoCompleted: 0, requests: 0, prunes: 0, prunedResults: 0 };
        const results = new Map();
        let fired = 0, pruned = 0, saved = 0, lastPruneReq = -1e9;
        for await (const ev of events(file)) {
          if (ev?.type === "assistant/message") {
            state.requests += 1;
            // request-count boundary (cadence) — fire at every N-th request
            if (mode !== "boundary-only") {
              const cadence = mode.cadence;
              if (state.requests % cadence === 0 && state.requests - lastPruneReq >= cadence) {
                const e = expectedSessionRequests(state.requests, history, workspace, 50);
                if (state.requests + 50 > e) continue;
                let p = 0, s = 0;
                for (const r of results.values()) {
                  if (!r.pruned && r.chars > 8192) { r.pruned = true; p += 1; s += r.chars - PRUNED_SIZE; }
                }
                if (p > 0) { fired += 1; pruned += p; saved += s; lastPruneReq = state.requests; }
              }
            }
            continue;
          }
          if (ev?.type === "tool/result") {
            let n = 0;
            for (const c of ev?.data?.message?.content ?? []) {
              if (typeof c?.text === "string") n += c.text.length;
              if (Array.isArray(c?.content)) for (const i of c.content) if (typeof i?.text === "string") n += i.text.length;
            }
            results.set(ev.seq, { chars: n, pruned: false });
            continue;
          }
          const b = isBoundary(ev, state);
          if (b === null) continue;
          const e = expectedSessionRequests(state.requests, history, workspace, 50);
          if (state.requests + 50 > e) continue;
          let p = 0, s = 0;
          for (const r of results.values()) {
            if (!r.pruned && r.chars > 8192) { r.pruned = true; p += 1; s += r.chars - PRUNED_SIZE; }
          }
          if (p > 0) { fired += 1; pruned += p; saved += s; lastPruneReq = state.requests; }
        }
        if (state.requests > 10) {
          sessions += 1;
          if (fired > 0) { firedSessions += 1; totalPruned += pruned; totalSaved += saved; }
        }
      }
    }
    return { sessions, firedSessions, totalPruned, totalSaved };
  })();
}

const baseline = await run("boundary-only");
console.log(`boundary-only:  fired=${baseline.firedSessions}/${baseline.sessions}  results=${baseline.totalPruned}  saved≈${(baseline.totalSaved / 1e6).toFixed(2)}M`);
for (const cadence of [75, 50, 30]) {
  const r = await run({ cadence });
  const delta = r.totalSaved - baseline.totalSaved;
  console.log(`+cadence ${String(cadence).padStart(3)}: fired=${r.firedSessions}/${r.sessions}  results=${r.totalPruned}  saved≈${(r.totalSaved / 1e6).toFixed(2)}M  (+${(delta / 1e6).toFixed(2)}M vs baseline)`);
}
