/**
 * dsh-engram Oracle Analysis — quantify token-waste sources in REAL session
 * logs, SoL-Pi methodology (measure headroom before building a mechanism).
 *
 * Three headline metrics over `~/.dsh/sessions/&lt;bucket&gt;/&lt;sid&gt;/session.jsonl.zstd`:
 *
 *  M1 Replay exposure (ObservationPack headroom, SoL-Pi C11/C23):
 *     every tool result replays in each later request until compaction
 *     prunes it. exposure = Σ resultChars × requestsAfter (upper bound, no
 *     cutoff) and a cutoff variant that stops replay at the next
 *     compaction/end. Composition split: results vs assistant text vs user.
 *     Plus fixed overhead: (system + tools schema) × requests.
 *  M2 Action-fusion headroom (SoL-Pi "Action Fusion"): consecutive tool
 *     calls where an edit-type call (edit/write/str_replace_editor) is
 *     followed by a bash call in a LATER step (a model round-trip sits
 *     between them and carried no new information).
 *  M3 Mechanism activation (SoL-Pi M15 "prove the mechanism fires"):
 *     dsh-loom sessions where the plugin's tools are mounted vs sessions
 *     that actually called engram_recall/engram_detail/esr_* — and how many
 *     recalls returned hits.
 *
 * Streaming: prefers the system `zstd` CLI (spawn, constant memory) and falls
 * back to the lib's decodeZstd when unavailable. Zero LLM, deterministic.
 *
 * Run: node eval/oracle-analysis.mjs [--root DIR] [--out JSON] [--bucket SUBSTR]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const EDIT_TOOLS = new Set(["edit", "write", "str_replace_editor"]);
const EXEC_TOOLS = new Set(["bash", "run"]);
const ENGRAM_PREFIXES = ["engram_", "esr_"];

function parseArgs(argv) {
  const out = { root: path.join(os.homedir(), ".dsh", "sessions"), out: "", bucket: "" };
  for (let i = 2; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--root") out.root = v;
    else if (k === "--out") out.out = v;
    else if (k === "--bucket") out.bucket = v;
    else { console.error(`unknown flag ${k}`); process.exit(2); }
  }
  return out;
}

/** Stream a session log as an async iterator of parsed JSON events. */
async function* events(file) {
  const hasZstd = spawnSync("zstd", ["--version"], { encoding: "utf8" }).status === 0;
  if (hasZstd) {
    const { spawn } = await import("node:child_process");
    const { createInterface } = await import("node:readline");
    const child = spawn("zstd", ["-dcq", file], { stdio: ["ignore", "pipe", "ignore"] });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      try { yield JSON.parse(line); } catch { /* skip torn lines */ }
    }
    await new Promise((resolve) => child.on("close", resolve));
  } else {
    const { decodeZstd } = await import("../lib/usage.js");
    for (const line of decodeZstd(file).split("\n")) {
      if (!line) continue;
      try { yield JSON.parse(line); } catch { /* skip */ }
    }
  }
}

const blockString = (content) => {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const c of content) {
    if (typeof c?.text === "string") out += c.text;
    // `tool/result` wraps the payload in an inner content array
    // ({type:"tool-result", content:[{type:"text", text}]}).
    if (Array.isArray(c?.content)) {
      for (const inner of c.content) if (typeof inner?.text === "string") out += inner.text;
    }
  }
  return out;
};

async function analyzeSession(file, bucket, sid, mtimeMs) {
  const s = {
    bucket, sid, mtimeMs,
    cwd: null, model: null, provider: null,
    systemChars: 0, toolsChars: 0, toolNames: [], hasEngramTools: false,
    requests: 0, turns: 0, steps: 0, userMessages: 0, userChars: 0,
    assistantChars: 0, reasoningChars: 0,
    totalCalls: 0, callsByTool: {},
    resultCount: 0, resultChars: 0, resultsByTool: {},
    compactionCycles: 0, compactionPrunes: 0,
    spliceTotal: 0, spliceMidRun: 0,
    // L0 simulation inputs: boundary + cache-break events
    goalOps: [], // {seq, op, phase}
    todoWrites: [], // {seq, completed, total}
    spliceSeqs: [],
    // rolling state
    callNameByld: new Map(),
    results: [], // {chars, reqIdx}
    assistantMsgs: [], // {chars, reqIdx}
    userMsgs: [], // {chars, reqIdx}
    calls: [], // {name, step, seq}
    compactionEndSeqs: [],
    engram: { recall: 0, recallWithHits: 0, detail: 0, store: 0, esr: 0 },
    firstTurnStartSeq: null,
  };

  for await (const j of events(file)) {
    const t = j?.type;
    const seq = j?.seq ?? 0;
    const d = j?.data ?? {};
    switch (t) {
      case "session": s.cwd = j.cwd ?? null; break;
      case "request/header": {
        const h = d.header ?? {};
        const tools = Array.isArray(h.tools) ? h.tools : [];
        const chars = JSON.stringify(tools).length;
        if (chars > s.toolsChars) { // keep the richest header (subagents log minimal ones)
          s.toolsChars = chars;
          s.systemChars = typeof h.system === "string" ? h.system.length : 0;
          s.toolNames = tools.map((x) => x?.name).filter(Boolean);
          s.hasEngramTools = s.toolNames.some((n) => ENGRAM_PREFIXES.some((p) => n.startsWith(p)));
          s.model = h.config?.model ?? s.model;
          s.provider = h.config?.provider ?? s.provider;
        }
        break;
      }
      case "request/context":
        s.model = d.model ?? s.model; s.provider = d.provider ?? s.provider; break;
      case "turn/start":
        s.turns += 1;
        if (s.firstTurnStartSeq === null) s.firstTurnStartSeq = seq;
        break;
      case "step/start": s.steps += 1; break;
      case "user/message":
        s.userMessages += 1;
        s.userMsgs.push({ chars: blockString(d.content).length, reqIdx: s.requests, seq });
        break;
      case "assistant/message": {
        s.requests += 1;
        const msg = d.message ?? {};
        const content = Array.isArray(msg.content) ? msg.content : [];
        let text = 0; let reasoning = 0;
        for (const c of content) {
          if (c?.type === "reasoning" && typeof c.text === "string") reasoning += c.text.length;
          else if (c?.type === "text" && typeof c.text === "string") text += c.text.length;
        }
        s.assistantChars += text;
        s.reasoningChars += reasoning;
        s.assistantMsgs.push({ chars: text + reasoning, reqIdx: s.requests, seq });
        break;
      }
      case "tool/call": {
        const name = d.name ?? "?";
        s.totalCalls += 1;
        s.callsByTool[name] = (s.callsByTool[name] ?? 0) + 1;
        s.calls.push({ name, step: d.step ?? 0, seq });
        s.callNameByld.set(d.callId, name);
        if (name === "engram_recall") s.engram.recall += 1;
        else if (name === "engram_detail") s.engram.detail += 1;
        else if (name === "engram_store") s.engram.store += 1;
        else if (name.startsWith("esr_")) s.engram.esr += 1;
        break;
      }
      case "tool/result": {
        const msg = d.message ?? {};
        const text = blockString(msg.content);
        const name = s.callNameByld.get(msg.source?.callId) ?? "?";
        s.resultCount += 1;
        s.resultChars += text.length;
        s.resultsByTool[name] = (s.resultsByTool[name] ?? 0) + text.length;
        s.results.push({ chars: text.length, reqIdx: s.requests, seq, name });
        if (name === "engram_recall") {
          const rows = (text.match(/\n- /g) ?? []).length + (text.startsWith("- ") ? 1 : 0);
          if (rows > 0 && !/^\s*(no active memories|no memories for entity)/i.test(text)) {
            s.engram.recallWithHits += 1;
          }
        }
        break;
      }
      case "compaction/start": s.compactionCycles += 1; break;
      case "compaction/prune": s.compactionPrunes += 1; break;
      case "compaction/end": s.compactionEndSeqs.push(seq); break;
      case "agent/inbox/spliced": {
        s.spliceTotal += 1;
        s.spliceSeqs.push(seq);
        if (s.firstTurnStartSeq !== null && seq > s.firstTurnStartSeq) s.spliceMidRun += 1;
        break;
      }
      case "goal/change":
        s.goalOps.push({ seq, op: d.operation ?? "?", phase: d.goal?.phase ?? "?" });
        break;
      case "todo/write": {
        const todos = Array.isArray(d.todos) ? d.todos : [];
        s.todoWrites.push({
          seq,
          completed: todos.filter((t) => t?.status === "completed").length,
          total: todos.length,
        });
        break;
      }
      default: break;
    }
  }

  // ---- derived metrics -----------------------------------------------------
  const cutoffAfter = (seq) => {
    // first compaction/end strictly after this event, else Infinity
    for (const c of s.compactionEndSeqs) if (c > seq) return c;
    return Infinity;
  };
  const exposureNaive = (arr) => {
    let total = 0;
    for (const { chars, reqIdx } of arr) total += chars * (s.requests - reqIdx);
    return total;
  };
  // Cutoff exposure: a payload only replays across requests that happen after
  // it and before the next compaction/end rewrites history.
  const exposureCut = (arr) => {
    let total = 0;
    for (const { chars, seq } of arr) {
      const stop = cutoffAfter(seq);
      let n = 0;
      for (const m of s.assistantMsgs) if (m.seq > seq && m.seq < stop) n += 1;
      total += chars * n;
    }
    return total;
  };
  const expResults = { naive: exposureNaive(s.results), cut: exposureCut(s.results) };
  const expAssistant = { naive: exposureNaive(s.assistantMsgs), cut: exposureCut(s.assistantMsgs) };
  const expUser = { naive: exposureNaive(s.userMsgs), cut: exposureCut(s.userMsgs) };
  const fixedOverhead = (s.systemChars + s.toolsChars) * s.requests;

  // Action-fusion candidates: consecutive calls, next in a later step.
  let fusionCandidates = 0;
  const fusionFollowups = {};
  for (let i = 1; i < s.calls.length; i += 1) {
    const prev = s.calls[i - 1]; const next = s.calls[i];
    if (EDIT_TOOLS.has(prev.name) && EXEC_TOOLS.has(next.name) && next.step > prev.step) {
      fusionCandidates += 1;
      const key = next.name;
      fusionFollowups[key] = (fusionFollowups[key] ?? 0) + 1;
    }
  }
  const editCalls = s.calls.filter((c) => EDIT_TOOLS.has(c.name)).length;
  const bashCalls = s.callsByTool.bash ?? 0;

  // Top-10 largest results share (ObservationPack archives the head, not the tail).
  const sorted = [...s.results].sort((a, b) => b.chars - a.chars);
  const top10 = sorted.slice(0, 10).reduce((a, r) => a + r.chars, 0);
  const top10Share = s.resultChars > 0 ? top10 / s.resultChars : 0;

  const out = {
    bucket, sid, mtimeMs, cwd: s.cwd, model: s.model, provider: s.provider,
    requests: s.requests, turns: s.turns, steps: s.steps,
    userMessages: s.userMessages,
    systemChars: s.systemChars, toolsChars: s.toolsChars, toolCount: s.toolNames.length,
    hasEngramTools: s.hasEngramTools,
    totalCalls: s.totalCalls, callsByTool: s.callsByTool,
    resultCount: s.resultCount, resultChars: s.resultChars, resultsByTool: s.resultsByTool,
    assistantChars: s.assistantChars, reasoningChars: s.reasoningChars,
    compactionCycles: s.compactionCycles, compactionPrunes: s.compactionPrunes,
    spliceTotal: s.spliceTotal, spliceMidRun: s.spliceMidRun,
    goalOps: s.goalOps, todoWrites: s.todoWrites, spliceSeqs: s.spliceSeqs,
    // L0 simulation inputs (trimmed): per-event positions and sizes only.
    simResults: s.results.map((r) => ({ chars: r.chars, seq: r.seq, name: r.name })),
    simAssistantMsgs: s.assistantMsgs.map((m) => ({ chars: m.chars, seq: m.seq })),
    simUserMsgs: s.userMsgs.map((m) => ({ chars: m.chars, seq: m.seq })),
    compactionEndSeqs: s.compactionEndSeqs,
    exposure: {
      results: expResults, assistant: expAssistant, user: expUser,
      fixedOverhead,
      totalNaive: expResults.naive + expAssistant.naive + expUser.naive + fixedOverhead,
    },
    top10ResultShare: Number(top10Share.toFixed(4)),
    fusion: { candidates: fusionCandidates, editCalls, bashCalls, followups: fusionFollowups },
    engram: { ...s.engram },
  };
  return out;
}

function fmt(n) {
  if (!Number.isFinite(n)) return "n/a";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}
const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) + "%" : "n/a");
const tok = (chars) => chars / 4; // rough chars→tokens estimate

async function main() {
  const args = parseArgs(process.argv);
  const sessions = [];
  const buckets = fs.readdirSync(args.root).filter((b) => b.startsWith("--"));
  for (const bucket of buckets) {
    if (args.bucket && !bucket.includes(args.bucket)) continue;
    const bdir = path.join(args.root, bucket);
    for (const sid of fs.readdirSync(bdir)) {
      const file = path.join(bdir, sid, "session.jsonl.zstd");
      try {
        const st = fs.statSync(file);
        if (st.size > 0) sessions.push({ file, bucket, sid, mtimeMs: st.mtimeMs });
      } catch { /* no log */ }
    }
  }
  sessions.sort((a, b) => a.mtimeMs - b.mtimeMs);
  console.error(`[oracle] ${sessions.length} session logs under ${args.root}`);

  const results = [];
  for (let i = 0; i < sessions.length; i += 1) {
    const { file, bucket, sid, mtimeMs } = sessions[i];
    try {
      const r = await analyzeSession(file, bucket, sid, mtimeMs);
      results.push(r);
      console.error(`[oracle] ${i + 1}/${sessions.length} ${sid.slice(0, 13)} reqs=${r.requests} calls=${r.totalCalls} results=${fmt(r.resultChars)}c`);
    } catch (e) {
      console.error(`[oracle] SKIP ${sid}: ${e.message}`);
    }
  }

  // ---------------- global rollup ----------------
  const T = (f) => results.reduce((a, r) => a + (f(r) || 0), 0);
  const total = {
    sessions: results.length,
    requests: T((r) => r.requests),
    calls: T((r) => r.totalCalls),
    resultChars: T((r) => r.resultChars),
    expResultsNaive: T((r) => r.exposure.results.naive),
    expResultsCut: T((r) => r.exposure.results.cut),
    expAssistantNaive: T((r) => r.exposure.assistant.naive),
    expUserNaive: T((r) => r.exposure.user.naive),
    fixedOverhead: T((r) => r.exposure.fixedOverhead),
    fusionCandidates: T((r) => r.fusion.candidates),
    editCalls: T((r) => r.fusion.editCalls),
    bashCalls: T((r) => r.fusion.bashCalls),
    compactionCycles: T((r) => r.compactionCycles),
    spliceMidRun: T((r) => r.spliceMidRun),
  };
  total.expTotalNaive = total.expResultsNaive + total.expAssistantNaive + total.expUserNaive + total.fixedOverhead;

  const loom = results.filter((r) => r.bucket.includes("dsh-loom"));
  const loomMounted = loom.filter((r) => r.hasEngramTools);
  const loomActive = loomMounted.filter((r) => r.engram.recall + r.engram.detail + r.engram.store + r.engram.esr > 0);
  const loomRecall = loom.filter((r) => r.engram.recall > 0);
  const loomDetail = loom.filter((r) => r.engram.detail > 0);

  console.error("\n================ ORACLE ANALYSIS ================");
  console.error(`sessions=${total.sessions}  requests=${fmt(total.requests)}  toolCalls=${fmt(total.calls)}  compactionCycles=${total.compactionCycles}  midRunSplices=${total.spliceMidRun}`);
  console.error("\n-- M1 replay exposure (chars×requestsAfter) --");
  console.error(`tool results replay : ${fmt(total.expResultsNaive)}c naive / ${fmt(total.expResultsCut)}c post-compaction-cutoff  (~${fmt(tok(total.expResultsCut))}–${fmt(tok(total.expResultsNaive))} tok)`);
  console.error(`assistant replay    : ${fmt(total.expAssistantNaive)}c   user replay: ${fmt(total.expUserNaive)}c`);
  console.error(`fixed sys+tools     : ${fmt(total.fixedOverhead)}c  (~${fmt(tok(total.fixedOverhead))} tok)`);
  console.error(`results share of total replay+fixed: ${pct(total.expResultsCut, total.expTotalNaive)} (cut) – ${pct(total.expResultsNaive, total.expTotalNaive)} (naive)`);
  const medTop10 = (() => {
    const v = results.filter((r) => r.resultChars > 100_000).map((r) => r.top10ResultShare).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : NaN;
  })();
  console.error(`median top-10-results share of result chars (sessions >100Kc): ${pct(medTop10, 1)}`);
  console.error("\n-- M2 action-fusion headroom --");
  console.error(`edit→exec candidates: ${total.fusionCandidates} / ${total.calls} calls (${pct(total.fusionCandidates, total.calls)}), ${pct(total.fusionCandidates, total.bashCalls)} of bash calls, after ${total.editCalls} edit calls (SoL-Pi baseline: 12.3% of transitions)`);
  console.error("\n-- M3 engram mechanism activation (dsh-loom) --");
  console.error(`sessions=${loom.length}  plugin-mounted=${loomMounted.length}  any-engram-call=${loomActive.length} (${pct(loomActive.length, loomMounted.length)} of mounted)  recall-sessions=${loomRecall.length}  detail-sessions=${loomDetail.length}`);
  console.error(`recall calls=${T((r) => r.engram.recall)}  with-hits=${T((r) => r.engram.recallWithHits)}  detail calls=${T((r) => r.engram.detail)}  store=${T((r) => r.engram.store)}  esr=${T((r) => r.engram.esr)}`);

  const payload = { generatedAt: Date.now(), root: args.root, total, sessions: results };
  const outFile = args.out || path.join("eval", "oracle-report.json");
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 1));
  console.error(`\n[oracle] full report -> ${outFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).then(() => process.exit(0));
