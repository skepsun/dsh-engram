#!/usr/bin/env node
/**
 * Gate audit — turn docs/PROPOSAL-evolution.zh.md §6 into numbers you can read
 * off the machine instead of remembering.
 *
 * WHY (v0.7.5): the proposal pre-declared six gates, but nothing computed them.
 * The ledger aggregated per session into a daily rollup, so the first gate
 * ("净收益 > 0 的会话 ≥ 50%") was arithmetically unanswerable. Two failure
 * modes cost us a week each already (session-log rename #8, `session.events`
 * removal in 0.2.x): both were invisible because nobody read the number that
 * would have been zero.
 *
 * Everything here is a READ over local data — no model, no network (unless you
 * pass `--api` to pull the exact rendered block size from a running server):
 *
 *   ~/.dsh/engram/ledger.json          per-session net rows
 *   ~/.dsh/sessions/**\/session*.zstd  tool calls, injected headers
 *   ~/.dsh/storages/dsh_engram.json    memory rows (stale share)
 *
 * Usage:
 *   node eval/gate-audit.mjs                    # last 14 days, this machine
 *   node eval/gate-audit.mjs --days 30 --md     # markdown table
 *   node eval/gate-audit.mjs --api http://127.0.0.1:3080/api/dsh-engram
 *   node eval/gate-audit.mjs --out docs/GATES.zh.md --md
 *
 * Verdicts are `PASS` / `FAIL` / `未测` — never a guess. A gate with no data
 * says so; that is the whole point (「结果态优先」).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { decodeZstd, readToolResult, recallStatsFromOutput, sessionLogFile, sessionsRoot } from "../lib/usage.js";
import { readLedger } from "../lib/ledger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const LONG_SESSION_REQUESTS = 200;
/** Below this many rows a share is noise: one short session must not paint the
 *  gate FAIL (or PASS). The gate says 未测 until there is a distribution. */
const MIN_SESSION_ROWS = 5;
const MIN_LONG_ROWS = 3; // §6: 长会话 = ≥200 请求
// G2's population floor: "installed sessions". Below this the rate is a coin
// flip dressed as a percentage.
const MIN_ACTIVATION_SESSIONS = 5;
const ENGRAM_TOOL_RE = /^(engram_|esr_)/;

function parseArgs(argv) {
  const out = { days: 14, md: false, out: null, api: null, home: null, g7: null, g6: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--days") out.days = Number(argv[++i]) || 14;
    else if (arg === "--md") out.md = true;
    else if (arg === "--out") out.out = argv[++i] ?? null;
    else if (arg === "--api") out.api = (argv[++i] ?? "").replace(/\/+$/, "") || null;
    // `npm run bench:ledger` prints the worst per-operation share; feed it back
    // so the gate is a measurement, not a "未测" placeholder.
    else if (arg === "--g7") out.g7 = Number(argv[++i]);
    else if (arg === "--g6") out.g6 = argv[++i] ?? null;
    else if (arg === "--home") out.home = argv[++i] ?? null;
    // Diagnostics: which sessions are in the denominator, and what each one
    // actually did. A rate without its population is a number you cannot act on.
    else if (arg === "--explain") out.explain = true;
  }
  return out;
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Facts we can read from one session log (bounded: one pass, no retention). */
function scanSession(file) {
  const raw = decodeZstd(file);
  if (typeof raw !== "string" || raw.length === 0) return null;
  const recallCallIds = new Set();
  const facts = {
    workspace: "",
    tools: new Map(),
    recallQueries: 0,
    recallWithHits: 0,
    detailCalls: 0,
    headers: 0,
    pushSeen: false,
  };
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === "session") {
      if (typeof event.cwd === "string" && event.cwd.length > 0) facts.workspace = event.cwd;
      continue;
    }
    if (event?.type === "tool/call") {
      const name = event.data?.name;
      if (typeof name !== "string" || name.length === 0) continue;
      facts.tools.set(name, (facts.tools.get(name) ?? 0) + 1);
      if (name === "engram_detail") facts.detailCalls += 1;
      const callId = event.data?.callId;
      if (name === "engram_recall" && typeof callId === "string") recallCallIds.add(callId);
      continue;
    }
    if (event?.type === "tool/result") {
      const parsed = readToolResult(event);
      if (parsed === null || typeof parsed.callId !== "string") continue;
      // Only recall results count: the tally is call-correlated, so a text
      // match on "- " alone is not evidence of a hit.
      if (!recallCallIds.has(parsed.callId)) continue;
      facts.recallQueries += 1;
      if (recallStatsFromOutput(parsed.text).withHits > 0) facts.recallWithHits += 1;
      continue;
    }
    // The push leg's own signature: the block only renders when the host-side
    // recall produced hits. Where it lands depends on the host generation:
    //   · request/header — the assembled system prompt for each request;
    //   · system/message — the section re-sent after a compaction / new turn.
    // Both are prompt-side, so assistant text quoting the block never counts.
    if (event?.type === "request/header" || event?.type === "system/message") {
      if (event.type === "request/header") facts.headers += 1;
      if (!facts.pushSeen && PUSH_RE.test(JSON.stringify(event.data ?? ""))) facts.pushSeen = true;
    }
  }
  return facts;
}

/**
 * Which savings paths are actually armed? NetTokens has two sides and the
 * credit side is wired to services that may not exist on a given host:
 *   · L1 BoundaryPrune needs a `toolResultPruner` service;
 *   · compaction credit needs engram to BE the compaction provider.
 * When neither is armed nothing can ever be credited, so `net` can only be
 * ≤ 0 — a FAIL there blames the mechanism for a configuration, and a PASS is
 * impossible. Report it as unmeasurable instead of guessing.
 */
function readCreditPaths(engramHome, live = void 0) {
  // The live instance is authoritative: the on-disk snapshot is written by
  // whichever plugin instance settles LAST, and a sibling instance that lost
  // the `compaction` provider writes "unavailable" over a working host. Prefer
  // the running plugin's own view when the caller passed --api.
  if (live?.compaction !== void 0) {
    const c = live.compaction;
    const presets = (c?.web?.presets ?? []).filter((p) => p?.action !== "skipped");
    const prune = c?.boundaryPrune?.armed === true;
    const hostCompaction = c?.host === "context-gc" || c?.host === "default";
    const webCompaction = (c?.web?.action === "wired" || c?.web?.action === "already") && presets.length > 0;
    return {
      known: true,
      armed: prune || hostCompaction || webCompaction,
      note: `live · L1 ${prune ? "armed" : "off"} · host compaction ${c?.host ?? "?"} · web ${c?.web?.action ?? "?"}`,
    };
  }
  const file = path.join(engramHome ?? path.join(os.homedir(), ".dsh", "engram"), "context-gc.status.json");
  let status;
  try {
    status = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { known: false, armed: false, note: "no context-gc.status.json — credit paths unknown" };
  }
  const prune = status?.boundaryPrune?.armed === true;
  const hostCompaction = status?.host === "context-gc" || status?.host === "default";
  // "wired" only counts when it names the presets it rewrote: a report with no
  // presets changed nothing, and a preset row that fails to load looks exactly
  // like one that works until a compaction is attempted (see the attempt log).
  // "already" = the row was in place from an earlier provisioning pass; only a
  // preset with a custom layout is skipped, and those are listed separately.
  const webAction = status?.web?.action;
  const webPresets = (status?.web?.presets ?? []).filter((p) => p?.action !== "skipped");
  const webCompaction = (webAction === "wired" || webAction === "already") && webPresets.length > 0;
  const armed = prune || hostCompaction || webCompaction;
  const parts = [
    `L1 ${prune ? "armed" : "off"}`,
    `host compaction ${status?.host ?? "?"}`,
    `web ${status?.web?.action ?? "?"}`,
  ];
  return { known: true, armed, note: parts.join(" · ") };
}

function scanSessions({ root = sessionsRoot(), days = 14, now = Date.now() } = {}) {
  const cutoff = now - days * DAY_MS;
  const sessions = [];
  for (const bucket of listDir(root)) {
    if (!bucket.startsWith("--")) continue;
    const bdir = path.join(root, bucket);
    for (const sid of listDir(bdir)) {
      const file = sessionLogFile(path.join(bdir, sid));
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoff) continue;
      const facts = scanSession(file);
      if (facts === null) continue;
      sessions.push({ sessionId: sid, dir: path.join(bdir, sid), mtime: st.mtimeMs, ...facts });
    }
  }
  return sessions.sort((a, b) => b.mtime - a.mtime);
}

/**
 * How many memories each workspace has, so a session can be asked the only
 * question that makes push rate meaningful: was there anything to push?
 */
function countMemoriesByWorkspace(dshHome) {
  const candidates = [
    path.join(dshHome, "storages", "dsh_engram.json"),
    path.join(dshHome, ".dsh", "storages", "dsh_engram.json"),
  ];
  for (const file of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const table = parsed?.tables?.memories;
    if (table === null || table === void 0 || typeof table !== "object") continue;
    const counts = new Map();
    for (const row of Object.values(table)) {
      if (row === null || typeof row !== "object" || row.kind === "episode") continue;
      if (typeof row.workspace !== "string" || row.workspace.length === 0) continue;
      counts.set(row.workspace, (counts.get(row.workspace) ?? 0) + 1);
    }
    return counts;
  }
  return new Map();
}

/** Stale share over the memory table (read-only; the store stays the truth). */
function readMemoryShare(dshHome) {
  const candidates = [
    path.join(dshHome, "storages", "dsh_engram.json"),
    path.join(dshHome, ".dsh", "storages", "dsh_engram.json"),
  ];
  for (const file of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const table = parsed?.tables?.memories;
    if (table === null || table === void 0 || typeof table !== "object") continue;
    const rows = Object.values(table).filter((row) => row !== null && typeof row === "object" && row.kind !== "episode");
    const stale = rows.filter((row) => Array.isArray(row.tags) && row.tags.includes("stale"));
    const superseded = rows.filter((row) => typeof row.supersededBy === "string" && row.supersededBy.length > 0);
    return { file, total: rows.length, stale: stale.length, superseded: superseded.length };
  }
  return null;
}

function pct(part, whole) {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return (part / whole) * 100;
}

function fmtPct(value) {
  return value === null ? "未测" : `${value.toFixed(1)}%`;
}

function fmtNum(value) {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

function verdict(ok) {
  return ok === null ? "未测" : ok ? "PASS" : "FAIL";
}

/** The §6 gate table, computed from whatever data actually exists. */
/**
 * Read a G6 artifact (`quality:ab run` → runs.json).
 *
 * The gate is only as honest as its input: an unparsable file is reported as
 * absent, never guessed. A run below the pair floor carries its own `未测`
 * verdict from the harness, so the floor rule lives in one place (the tool that
 * produced the number).
 */
function readG6(file) {
  if (file === null || file === undefined) return null;
  try {
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    if (report === null || typeof report !== "object") return null;
    return { ...report, source: path.relative(process.cwd(), file) };
  } catch {
    return null;
  }
}

export function auditGates({ days = 14, now = Date.now(), home = void 0, api = null, root = void 0, live = void 0, g7 = null, g6 = null } = {}) {
  const engramHome = home ?? void 0;
  const ledger = readLedger({ home: engramHome });
  const sessions = scanSessions({ root: root ?? sessionsRoot(), days, now });
  const dshHome = home !== void 0 ? home : (process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"));
  const store = readMemoryShare(dshHome);
  // The gate's credit side: without an armed savings path, `avoided` is 0 by
  // construction and NetTokens measures only what engram costs.
  const credit = readCreditPaths(engramHome, live);

  // ── G1 NetTokens: per-session distribution (rows only; no rows = no claim)
  const rows = ledger.sessions.filter((row) => row.requests > 0);
  // G1's denominator is the sessions that HAD something to save. A session
  // with no prune and no compaction can only be net-negative (it pays injection
  // and credits nothing), so counting it measures "did the mechanism run here",
  // not "did it pay off". 14 days on this machine: 21 of 33 mounted sessions
  // had a saving opportunity — the other 12 are structurally negative.
  const opportunityRows = rows.filter((row) => (row.prunedChars ?? 0) + (row.compactedChars ?? 0) > 0);
  const positive = opportunityRows.filter((row) => row.netChars > 0);
  const longRows = opportunityRows.filter((row) => row.requests >= LONG_SESSION_REQUESTS);
  const longPositive = longRows.filter((row) => row.netChars > 0);
  const netShare = pct(positive.length, opportunityRows.length);
  const longShare = pct(longPositive.length, longRows.length);

  // ── G2 Activation: installed sessions where any engram/esr tool fired
  //
  // "installed" used to be `tools.size > 0` — that is "the session ran SOME
  // tool", which is true of every session and says nothing about engram. On this
  // machine that put three Kototoro sessions in the denominator whose tool list
  // (bash, read, edit… — no engram_*, no esr_*) shows the plugin was never
  // loaded there: they could not fire, and counting them measured the install
  // state of a workspace, not activation. Evidence of a live mechanism is one of:
  // the prompt carried the [ENGRAM]/[RECALL] block, the ledger counted requests,
  // or an engram tool was actually called.
  const ledgerLive = new Set(rows.map((row) => row.sessionId));
  const engramFired = (session) => [...session.tools.keys()].some((name) => ENGRAM_TOOL_RE.test(name));
  const installed = sessions.filter((s) => s.pushSeen || ledgerLive.has(s.sessionId) || engramFired(s));
  const activated = installed.filter(engramFired);
  const pushFired = installed.filter((s) => s.pushSeen);
  const memoryCounts = countMemoriesByWorkspace(dshHome);
  // The opportunity axis: a session whose workspace HAS memories is a session
  // where the push leg had something to say. Below that, "no push" is not evidence.
  const hadSomethingToPush = installed.filter((s) => (memoryCounts.get(s.workspace) ?? 0) > 0);
  const pushWherePossible = hadSomethingToPush.filter((s) => s.pushSeen);
  const activation = pct(activated.length, installed.length);
  const pushShare = pct(pushFired.length, installed.length);
  const pushOpportunityShare = pct(pushWherePossible.length, hadSomethingToPush.length);

  // ── G3 DrillRate: detail calls per recall-with-hits
  const recallWithHits = sessions.reduce((sum, s) => sum + s.recallWithHits, 0);
  const detailCalls = sessions.reduce((sum, s) => sum + s.detailCalls, 0);
  const drillRate = recallWithHits > 0 ? detailCalls / recallWithHits : null;

  // ── G4 StaleRate: superseded rows still present (index exclusion is the gate)
  const staleRate = store === null ? null : pct(store.superseded, store.total);

  return {
    auditedAt: now,
    // "mounted" now means what the word says: engram was actually live in the
    // session. The old count (sessions that ran any tool) is kept beside it so a
    // reader can see how much of the population the fix removed.
    window: {
      days,
      now,
      sessions: sessions.length,
      mounted: installed.length,
      anyTool: sessions.filter((s) => s.tools.size > 0).length,
    },
    ledger: {
      rows: rows.length,
      opportunityRows: opportunityRows.length,
      totals: ledger.totals,
      positive: positive.length,
      longRows: longRows.length,
    },
    activation: {
      activated: activated.length,
      share: activation,
      pushFired: pushFired.length,
      pushShare,
    },
    drill: { recallWithHits, detailCalls, rate: drillRate },
    store,
    staleRate,
    api,
    gates: [
      {
        id: "G1",
        name: "NetTokens · 净收益 > 0 的会话占比（有节省机会的会话）",
        value: fmtPct(netShare),
        target: "≥ 50%",
        verdict:
          !credit.armed || opportunityRows.length < MIN_SESSION_ROWS ? "未测" : verdict(netShare >= 50),
        note: !credit.armed
          ? `${positive.length}/${opportunityRows.length} opportunity rows, but no savings path is armed (${credit.note}) — net can only be ≤ 0`
          : opportunityRows.length < MIN_SESSION_ROWS
            ? `${positive.length}/${opportunityRows.length} opportunity rows of ${rows.length} — need ≥ ${MIN_SESSION_ROWS} for a distribution`
            : `${positive.length}/${opportunityRows.length} sessions with a saving opportunity (${rows.length} rows total)`,
      },
      {
        id: "G1b",
        name: "NetTokens · 长会话（≥200 请求）占比",
        value: fmtPct(longShare),
        target: "≥ 70%",
        verdict:
          !credit.armed || longRows.length < MIN_LONG_ROWS ? "未测" : verdict(longShare >= 70),
        note: `${longPositive.length}/${longRows.length} long opportunity sessions`, 
      },
      {
        id: "G2",
        name: "Activation · 机制激活率（装上了 engram 的会话 fire ≥1 次）",
        value: fmtPct(activation),
        target: "≥ 60%",
        // Enough sessions to judge: below the floor the honest answer is 未测.
        // n=3 would read 100% PASS and mean nothing.
        verdict:
          installed.length < MIN_ACTIVATION_SESSIONS ? "未测" : verdict(activation >= 60),
        note:
          installed.length < MIN_ACTIVATION_SESSIONS
            ? `${activated.length}/${installed.length} installed sessions — 样本不足（需 ≥ ${MIN_ACTIVATION_SESSIONS}）；旧口径 ${sessions.filter((s) => s.tools.size > 0).length} 个"有工具"会话里有 ${sessions.filter((s) => s.tools.size > 0 && !s.pushSeen && !ledgerLive.has(s.sessionId) && !engramFired(s)).length} 个根本没装 engram`
            : `${activated.length}/${installed.length} installed sessions`,
      },
      {
        id: "G2b",
        name: "Push · [RECALL] 注入命中会话占比",
        value: fmtPct(pushShare),
        target: "观测项（无预声明门）",
        verdict: installed.length === 0 ? "未测" : "—",
        note: `${pushFired.length}/${installed.length} installed sessions carry a [RECALL] block in their prompt`,
      },
      {
        id: "G2c",
        name: "Push opportunity · 有记忆可推的会话里推送腿渲染占比",
        value: fmtPct(pushOpportunityShare),
        target: "观测项（无预声明门）",
        verdict: hadSomethingToPush.length === 0 ? "未测" : "—",
        // The only push number that can be read as a miss: the workspace had
        // memories and the block still never rendered.
        note: `${pushWherePossible.length}/${hadSomethingToPush.length} sessions whose workspace has ≥1 memory`,
      },
      {
        id: "G3",
        name: "DrillRate · detail / recall-with-hits",
        value: drillRate === null ? "未测" : drillRate.toFixed(2),
        target: "观测项（推送是否被采纳）",
        verdict: drillRate === null ? "未测" : "—",
        note: `${detailCalls} detail / ${recallWithHits} recall-with-hits`,
      },
      {
        id: "G4",
        name: "StaleRate · 被 supersede 的行占比",
        value: fmtPct(staleRate),
        target: "< 1%",
        verdict: staleRate === null ? "未测" : verdict(staleRate < 1),
        note: store === null ? "no storage file" : `${store.superseded}/${store.total} memories (${store.stale} tagged stale)`,
      },
      {
        id: "G5",
        name: "索引 ≤ 700 chars",
        value: "未测",
        target: "≤ 700c",
        verdict: "未测",
        note: api === null ? "pass --api <base>?workspace=<ws> to read the rendered block size" : `via ${api}/preview`,
      },
      {
        id: "G6",
        name: "Quality Δ · 配对任务成功率差",
        // G6 cannot be derived from logs: it needs the paired A/B artifact. Read
        // it from `quality:ab run`'s runs.json — never from a hand-typed number.
        value: g6 === null || g6.deltaPp === null || g6.deltaPp === undefined ? "未测" : `${g6.deltaPp.toFixed(1)}pp`,
        target: g6?.gate?.target ?? "Δ ≥ −2pp",
        verdict: g6 === null ? "未测" : (g6.gate?.verdict ?? "未测"),
        note: g6 === null
          ? "needs paired A/B runs (not derivable from logs) — pass --g6 <runs.json>"
          : `${g6.paired?.pairs ?? 0} 对配对 · ${g6.tasks?.length ?? 0} 任务 × ${g6.seeds ?? 1} 种子 · ${g6.source ?? ""}`.trim() +
            // A control row that went and read the answer key is not evidence.
            // If the artifact dropped some, the number on this dashboard is only
            // honest when the drop is visible next to it.
            (g6.notBlindExcluded > 0 ? ` · 已剔除 ${g6.notBlindExcluded} 行不盲控制臂` : ""),
      },
      {
        id: "G7",
        name: "账本自身开销",
        value: Number.isFinite(g7) ? `${g7.toFixed(4)}%` : "未测",
        target: "< 0.5% 请求时延",
        verdict: Number.isFinite(g7) ? (g7 < 0.5 ? "PASS" : "FAIL") : "未测",
        note: Number.isFinite(g7)
          ? "from `npm run bench:ledger` (worst op vs a 300ms request floor)"
          : "run `npm run bench:ledger` and pass --g7 <pct>",
      },
    ],
  };
}

/**
 * Fill G5 from the running host: the rendered [ENGRAM] block size is a
 * render-time fact, not something the disk can answer. Offline → 未测.
 */
/** `[RECALL] recall · 3 hit(s)` / `[RECALL] newest memory · 3 hit(s)` — the
 *  rendered block, never the static `drill: use [RECALL] below` instruction. */
const PUSH_RE = /\[RECALL\] (?:recall|newest memory) · \d+ hit\(s\)/;

/** The running plugin's own compaction view (authoritative over the file). */
async function fetchLiveCompaction(api) {
  if (api === null || api === void 0) return void 0;
  const [base, query = ""] = String(api).split("?");
  const workspace = new URLSearchParams(query).get("workspace") ?? process.cwd();
  try {
    const response = await fetch(`${base}/overview?workspace=${encodeURIComponent(workspace)}`);
    if (!response.ok) return void 0;
    const body = await response.json();
    return body?.compaction === void 0 ? void 0 : { compaction: body.compaction };
  } catch {
    return void 0;
  }
}

async function fillIndexGate(report) {
  const gate = report.gates.find((entry) => entry.id === "G5");
  if (gate === void 0 || report.api === null || report.api === void 0) return;
  const [base, query = ""] = String(report.api).split("?");
  const workspace = new URLSearchParams(query).get("workspace") ?? process.cwd();
  const url = `${base}/preview?workspace=${encodeURIComponent(workspace)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const chars = body?.meta?.engram?.chars;
    if (!Number.isFinite(chars)) throw new Error("no meta.engram.chars");
    gate.value = `${chars}c`;
    if (chars === 0) {
      // An empty block trivially fits the budget — that is not the gate talking.
      gate.verdict = "未测";
      gate.note = `${workspace} · empty [ENGRAM] block (no memories for this workspace) — pass ?workspace=<repo>`;
    } else {
      gate.verdict = chars <= 700 ? "PASS" : "FAIL";
      gate.note = `${workspace} · ${body?.meta?.counts?.memories ?? "?"} memories · ${body?.meta?.engram?.lines ?? "?"} lines`;
    }
  } catch (error) {
    gate.note = `api unreachable (${String(error.message)}) — offline`;
  }
}

/** Newest per-session rows, for eyeballing what the gates averaged over. */
function renderRows(ledger, limit = 10) {
  const rows = ledger.sessions.filter((row) => row.requests > 0).slice(0, limit);
  if (rows.length === 0) return "_no per-session rows yet — restart the host so v0.7.5 starts writing them_";
  const lines = ["| session | requests | injected | avoided | net | workspace |", "|---|---|---|---|---|---|"];
  for (const row of rows) {
    lines.push(
      `| ${row.sessionId.slice(0, 14)}… | ${fmtNum(row.requests)} | ${fmtNum(row.injectedChars)}c | ${fmtNum(row.avoidedChars)}c | ${fmtNum(row.netChars)}c | ${row.workspace.split("/").pop()} |`,
    );
  }
  return lines.join("\n");
}

function renderMarkdown(report) {
  const out = [];
  out.push(`# 门审计（gate audit）· ${new Date(report.auditedAt ?? Date.now()).toISOString().slice(0, 10)}`);
  out.push("");
  out.push(`窗口：最近 ${report.window.days} 天 · 扫描 ${report.window.sessions} 个会话（其中 ${report.window.mounted} 个装了 engram；"用过任意工具"的会话 ${report.window.anyTool} 个）· 账本行 ${report.ledger.rows} 条`);
  out.push("");
  out.push("| 门 | 指标 | 实测 | 目标 | 判定 | 备注 |");
  out.push("|---|---|---|---|---|---|");
  for (const gate of report.gates) {
    out.push(`| ${gate.id} | ${gate.name} | ${gate.value} | ${gate.target} | **${gate.verdict}** | ${gate.note} |`);
  }
  out.push("");
  out.push("## 账本合计");
  out.push("");
  const t = report.ledger.totals;
  out.push(`- injected ${fmtNum(t.injectedChars)}c（≈${fmtNum(t.injectedTokens)} tok）· avoided ${fmtNum(t.avoidedChars)}c（≈${fmtNum(t.avoidedTokens)} tok）`);
  out.push(`- rewrites ${fmtNum(t.rewriteCount)} 次 / ${fmtNum(t.rewriteChars)}c（按 cacheDiscount 计罚 ${fmtNum(t.rewritesCostChars)}c）`);
  out.push(`- **net ${fmtNum(t.netChars)}c ≈ ${fmtNum(t.netTokens)} tok**；开源会话 ${report.ledger.rows} 条，其中净收益为正 ${report.ledger.positive} 条`);
  out.push("");
  out.push("## 最近会话（按会话落行）");
  out.push("");
  out.push(renderRows({ sessions: report.ledgerRows ?? [] }));
  out.push("");
  out.push("> 口径：token = chars/4（与 GUI 一致）；rewrites 罚金 = 前缀字符 ×（1 − cacheDiscount），默认 0.1。");
  out.push("> 未测即未测——不猜。G5 需要运行中的宿主（`--api`），G7 需要 `npm run bench:ledger` + `--g7 <pct>`，");
  out.push("> G6 需要配对实验：`npm run quality:ab -- run …`（协议见 docs/G6-quality-ab.zh.md，< 10 对配对一律报未测）。");
  out.push("> G1 的分母是「有节省机会」的会话（`prunedChars + compactedChars > 0`）：没有任何剪枝/压缩的会话结构上必为负，");
  out.push("> 把它们算进分母测的是激活率而不是收益。机会会话 < 5 时只报数值、不给判定：一个会话不是分布。");
  out.push("> 绝对值说明：injected 按名义价逐请求记，而宿主前缀缓存实际约 10% 付费；");
  out.push("> 两侧同比例缩放不改变 net 的**正负号**（G1 判的就是符号），所以门不受影响，但「节省 token」的绝对量偏悲观。");
  return out.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const home = args.home ?? void 0;
  const live = await fetchLiveCompaction(args.api);
  const report = auditGates({ days: args.days, home, api: args.api, live, g7: args.g7, g6: readG6(args.g6) });
  await fillIndexGate(report);
  const ledger = readLedger({ home });
  report.ledgerRows = ledger.sessions;

  if (args.md || args.out !== null) {
    const md = renderMarkdown(report);
    if (args.out !== null) {
      fs.mkdirSync(path.dirname(args.out), { recursive: true });
      fs.writeFileSync(args.out, `${md}\n`, "utf8");
      console.log(`wrote ${args.out}`);
    }
    if (args.md || args.out === null) console.log(md);
    return;
  }

  if (args.explain) {
    const sessions = scanSessions({ days: args.days, root: sessionsRoot() });
    const byId = new Map(ledger.sessions.map((row) => [row.sessionId, row]));
    console.log("session      ws                     req  push  tools  engram-tools        recall/hit  detail  all-tools");
    for (const s of sessions) {
      const row = byId.get(s.sessionId) ?? {};
      const engramTools = [...s.tools.keys()].filter((name) => ENGRAM_TOOL_RE.test(name));
      console.log(
        [
          s.sessionId.slice(0, 8).padEnd(12),
          path.basename(s.workspace || "?").slice(0, 20).padEnd(22),
          String(row.requests ?? 0).padStart(3),
          String(s.pushSeen ? "yes" : "-").padStart(5),
          String(s.tools.size).padStart(6),
          (engramTools.join(",") || "-").slice(0, 18).padEnd(18),
          ([...s.tools.keys()].join(",") || "-").slice(0, 46).padEnd(46),
          `${s.recallQueries}/${s.recallWithHits}`.padStart(11),
          String(s.detailCalls).padStart(6),
        ].join("  "),
      );
    }
    console.log("");
  }
  console.log(`gate audit · last ${report.window.days}d · ${report.window.sessions} sessions (${report.window.mounted} with engram live, ${report.window.anyTool} with any tool) · ${report.ledger.rows} ledger rows`);
  for (const gate of report.gates) {
    console.log(`  ${gate.id.padEnd(4)} ${gate.verdict.padEnd(4)} ${gate.value.padEnd(8)} ≤/≥ ${gate.target.padEnd(10)} ${gate.name}`);
  }
  const t = report.ledger.totals;
  console.log(`  net ${fmtNum(t.netChars)}c ≈ ${fmtNum(t.netTokens)} tok · injected ${fmtNum(t.injectedChars)}c · avoided ${fmtNum(t.avoidedChars)}c`);
  console.log("  (--md for the table, --out docs/GATES.zh.md to write it)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
