// F recon: what replay exposure lives in sessions that never fire a
// todo/goal boundary? Categorize each session by boundary activation and
// measure the tool-result bytes that boundary-prune would never touch.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { isBoundary, completedCount } from "/Users/sunchuxiong/dsh-loom/lib/boundary-prune.js";

const root = path.join(os.homedir(), ".dsh", "sessions");

async function* events(file) {
  const c = spawn("zstd", ["-dcq", file]);
  const rl = createInterface({ input: c.stdout });
  for await (const l of rl) {
    if (!l) continue;
    try { yield JSON.parse(l); } catch {}
  }
}

let sessions = 0, sessions10 = 0;
let hasBoundary = 0, noBoundary = 0;
let hasBoundaryBytes = 0, noBoundaryBytes = 0;
let noBoundaryBig = 0; // sessions without boundary but with >8192-c results

const samples = [];
for (const bucket of fs.readdirSync(root)) {
  if (!bucket.startsWith("--")) continue;
  const bdir = path.join(root, bucket);
  for (const sid of fs.readdirSync(bdir)) {
    const file = path.join(bdir, sid, "session.jsonl.zstd");
    try { if (fs.statSync(file).size === 0) continue; } catch { continue; }
    const workspace = decodeURIComponent(bucket.replace(/^--/, "").replace(/--$/, ""));
    const state = { todoCompleted: 0, requests: 0, prunes: 0, prunedResults: 0 };
    let reqs = 0, goalWrites = 0, todoWrites = 0, boundaryHits = 0;
    let resultChars = 0, overThreshChars = 0, overThreshCount = 0, bigResults = 0;
    let sawTodo = false;
    for await (const ev of events(file)) {
      if (ev?.type === "assistant/message") { reqs += 1; continue; }
      if (ev?.type === "goal/change") { goalWrites += 1; boundaryHits += isBoundary(ev, state) ? 1 : 0; continue; }
      if (ev?.type === "todo/write") { todoWrites += 1; sawTodo = true; boundaryHits += isBoundary(ev, state) ? 1 : 0; continue; }
      if (ev?.type === "tool/result") {
        let n = 0;
        for (const c of ev?.data?.message?.content ?? []) {
          if (typeof c?.text === "string") n += c.text.length;
          if (Array.isArray(c?.content)) for (const i of c.content) if (typeof i?.text === "string") n += i.text.length;
        }
        resultChars += n;
        if (n > 8192) { overThreshChars += n; overThreshCount += 1; bigResults += 1; }
      }
    }
    if (reqs === 0) continue;
    sessions += 1;
    if (reqs > 10) sessions10 += 1;
    if (boundaryHits > 0) {
      hasBoundary += 1; hasBoundaryBytes += overThreshChars;
    } else {
      noBoundary += 1; noBoundaryBytes += overThreshChars;
      if (overThreshCount > 0) noBoundaryBig += 1;
    }
    if (reqs > 30 && boundaryHits === 0) {
      samples.push({ sid: sid.slice(0, 13), reqs, overThreshCount, overThreshChars, todoWrites, goalWrites, workspace: workspace.split("/").pop() });
    }
  }
}

console.log(`sessions=${sessions}  sessions(>10 reqs)=${sessions10}`);
console.log(`  with boundary:        ${hasBoundary} sessions, over-threshold bytes≈${(hasBoundaryBytes / 1e6).toFixed(2)}M`);
console.log(`  without boundary:     ${noBoundary} sessions, over-threshold bytes≈${(noBoundaryBytes / 1e6).toFixed(2)}M (${noBoundaryBig} of them have >8192c results)`);
console.log("\nsessions(>30 reqs, no boundary, has over-threshold results):");
for (const s of samples.sort((a, b) => b.overThreshChars - a.overThreshChars).slice(0, 10)) {
  console.log(`  ${(s.overThreshChars / 1e3).toFixed(0).padStart(6)}Kc  n=${String(s.overThreshCount).padStart(3)}  reqs=${String(s.reqs).padStart(4)}  todo=${s.todoWrites} goal=${s.goalWrites}  ${s.workspace}/${s.sid}`);
}
