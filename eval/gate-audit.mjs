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
const ENGRAM_TOOL_RE = /^(engram_|esr_)/;

function parseArgs(argv) {
  const out = { days: 14, md: false, out: null, api: null, home: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--days") out.days = Number(argv[++i]) || 14;
    else if (arg === "--md") out.md = true;
    else if (arg === "--out") out.out = argv[++i] ?? null;
    else if (arg === "--api") out.api = (argv[++i] ?? "").replace(/\/+$/, "") || null;
    else if (arg === "--home") out.home = argv[++i] ?? null;
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
export function auditGates({ days = 14, now = Date.now(), home = void 0, api = null, root = void 0, live = void 0 } = {}) {
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
  const positive = rows.filter((row) => row.netChars > 0);
  const longRows = rows.filter((row) => row.requests >= LONG_SESSION_REQUESTS);
  const longPositive = longRows.filter((row) => row.netChars > 0);
  const netShare = pct(positive.length, rows.length);
  const longShare = pct(longPositive.length, longRows.length);

  // ── G2 Activation: mounted sessions where any engram/esr tool fired
  const mounted = sessions.filter((s) => s.tools.size > 0);
  const activated = mounted.filter((s) => [...s.tools.keys()].some((name) => ENGRAM_TOOL_RE.test(name)));
  const pushFired = mounted.filter((s) => s.pushSeen);
  const activation = pct(activated.length, mounted.length);
  const pushShare = pct(pushFired.length, mounted.length);

  // ── G3 DrillRate: detail calls per recall-with-hits
  const recallWithHits = sessions.reduce((sum, s) => sum + s.recallWithHits, 0);
  const detailCalls = sessions.reduce((sum, s) => sum + s.detailCalls, 0);
  const drillRate = recallWithHits > 0 ? detailCalls / recallWithHits : null;

  // ── G4 StaleRate: superseded rows still present (index exclusion is the gate)
  const staleRate = store === null ? null : pct(store.superseded, store.total);

  return {
    auditedAt: now,
    window: { days, now, sessions: sessions.length, mounted: mounted.length },
    ledger: { rows: rows.length, totals: ledger.totals, positive: positive.length, longRows: longRows.length },
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
        name: "NetTokens · 净收益 > 0 的会话占比",
        value: fmtPct(netShare),
        target: "≥ 50%",
        verdict:
          !credit.armed || rows.length < MIN_SESSION_ROWS ? "未测" : verdict(netShare >= 50),
        note: !credit.armed
          ? `${positive.length}/${rows.length} rows, but no savings path is armed (${credit.note}) — net can only be ≤ 0`
          : rows.length < MIN_SESSION_ROWS
            ? `${positive.length}/${rows.length} rows — need ≥ ${MIN_SESSION_ROWS} flushed sessions for a distribution`
            : `${positive.length}/${rows.length} sessions with ledger rows`,
      },
      {
        id: "G1b",
        name: "NetTokens · 长会话（≥200 请求）占比",
        value: fmtPct(longShare),
        target: "≥ 70%",
        verdict:
          !credit.armed || longRows.length < MIN_LONG_ROWS ? "未测" : verdict(longShare >= 70),
        note: `${longPositive.length}/${longRows.length} long sessions`,
      },
      {
        id: "G2",
        name: "Activation · 机制激活率（挂载会话 fire ≥1 次）",
        value: fmtPct(activation),
        target: "≥ 60%",
        verdict: mounted.length === 0 ? "未测" : verdict(activation >= 60),
        note: `${activated.length}/${mounted.length} mounted sessions`,
      },
      {
        id: "G2b",
        name: "Push · [RECALL] 注入命中会话占比",
        value: fmtPct(pushShare),
        target: "观测项（无预声明门）",
        verdict: mounted.length === 0 ? "未测" : "—",
        note: `${pushFired.length}/${mounted.length} sessions carry a [RECALL] block in their prompt`,
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
        value: "未测",
        target: "≤ 2pp",
        verdict: "未测",
        note: "needs paired A/B runs (not derivable from logs)",
      },
      {
        id: "G7",
        name: "账本自身开销",
        value: "未测",
        target: "< 0.5% 请求时延",
        verdict: "未测",
        note: "in-memory accumulation; needs a timed benchmark",
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
  out.push(`窗口：最近 ${report.window.days} 天 · 扫描 ${report.window.sessions} 个会话（其中 ${report.window.mounted} 个挂载了工具）· 账本行 ${report.ledger.rows} 条`);
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
  out.push("> 未测即未测——不猜。G5 需要运行中的宿主（`--api`），G6/G7 需要配对实验。");
  out.push("> G1 在行数 < 5 时只报数值、不给判定：一个会话不是分布。");
  out.push("> 绝对值说明：injected 按名义价逐请求记，而宿主前缀缓存实际约 10% 付费；");
  out.push("> 两侧同比例缩放不改变 net 的**正负号**（G1 判的就是符号），所以门不受影响，但「节省 token」的绝对量偏悲观。");
  return out.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const home = args.home ?? void 0;
  const live = await fetchLiveCompaction(args.api);
  const report = auditGates({ days: args.days, home, api: args.api, live });
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

  console.log(`gate audit · last ${report.window.days}d · ${report.window.sessions} sessions (${report.window.mounted} mounted) · ${report.ledger.rows} ledger rows`);
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
