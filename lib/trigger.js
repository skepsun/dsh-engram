/**
 * dsh-engram: decision-point ESR triggers (P0-A + P1).
 *
 * The old mem-vs-esr escalation nudge (`escalationHint`) read the per-
 * (workspace, day) `usage` table, but assessment P3 removed the per-call
 * write path (observability moved to on-demand session-log scans), leaving
 * the nudge with a dead data source. This module restores that balance
 * signal with a cheap in-memory counter fed by the SAME tools/result
 * subscription — zero I/O per prompt render, zero LLM — and adds the P0-A
 * decision-point trigger:
 *
 *   Watch the native `todo_write` calls, snapshot the session's pending
 *   todos, and let the [ESR] block emit a concrete "promote to esr_task"
 *   hint — at most once per session, only when the funnel is actually
 *   narrow (pending todos > active ESR tasks). This mirrors the GUI's
 *   "沉淀到 ESR" button on the model side, firing exactly where the
 *   todo→esr routing decision happens.
 *
 * All state is process-local (resets on host reload — acceptable for a
 * nudge, same trade-off as a short-lived cache). Fully contained: handle()
 * never throws, so a trigger bug can never disturb the tool pipeline.
 */

import { workspaceKey as wk, truncate } from "./util.js";
import { dayKey } from "./usage.js";

/** Tools that count as memory-ops in the mem-vs-esr balance. */
export const MEM_TOOLS = [
  "engram_store",
  "engram_recall",
  "engram_detail",
  "loom_store",
  "loom_recall",
  "loom_detail",
];
/** Tools that count as ESR-ops in the mem-vs-esr balance. */
export const ESR_TOOLS = ["esr_task", "esr_node", "esr_close", "esr_link", "esr_gc"];

/** Keep at most this many workspace snapshots (todo + usage) in memory. */
const WORKSPACE_CAP = 200;
/** Balance rolling window (days). */
const BALANCE_DAYS = 14;
const DAY_MS = 86_400_000;
/** Healthy once esr exceeds ~a third of memory-ops volume (matches P0-era). */
const HEALTHY_RATIO = 0.34;
/** Under this many memory ops a nudge is lecturing noise. */
const SAMPLE_FLOOR = 3;

/** Statuses a todo item wears when it is still unfinished. */
const DONE_STATUSES = new Set(["completed", "done", "complete", "closed"]);

/**
 * Stable per-hint source tags (P4). Appended to every nudge line so the
 * model can reference them and any log watcher can attribute which hint was
 * shown; `emitHint`/`conversionStats` measure hint → esr_* action conversion.
 */
export const HINT_TAGS = {
  promote: "#suggest-promote",
  rootcause: "#suggest-rootcause",
  close: "#suggest-close",
  stale: "#suggest-stale",
  escalate: "#suggest-escalate",
};

/** A hint counts as "converted" when an esr_* tool runs within this window. */
const CONVERSION_WINDOW_MS = 10 * 60 * 1000;

/**
 * Deterministically extract the list of unfinished todo names from a
 * `todo_write` arguments object. Never throws; returns [] for anything else.
 */
export function pendingTodos(args) {
  if (args === null || typeof args !== "object") return [];
  const raw = Array.isArray(args.todos) ? args.todos : [];
  const names = [];
  for (const item of raw) {
    if (item === null || item === void 0) continue;
    if (typeof item === "string") {
      const c = item.trim();
      if (c.length > 0) names.push(c);
      continue;
    }
    if (typeof item !== "object") continue;
    const status = String(item.status ?? item.state ?? "").toLowerCase();
    if (DONE_STATUSES.has(status)) continue;
    const content = String(item.content ?? item.name ?? item.title ?? "").trim();
    if (content.length > 0) names.push(content);
  }
  return names;
}

/**
 * The decision-point recorder. Feed every tools/result event to `handle()`;
 * read back the live balance via `recentBalance(workspace)` and the one-shot
 * promote prompt via `promoteHint(sessionId, workspace, activeTasks)`.
 */
export function makeTriggerRecorder(config = {}) {
  const minTodosForPromote = config.minTodosForPromote ?? 2;
  const todoPromoteRatio = config.todoPromoteRatio ?? 1;
  /** workspace -> Map<day, {mem, esr}> (live balance, replaces dead usage table). */
  const usage = new Map();
  /** workspace -> { sessionId, count, names, updatedAt } (pending-todo plan). */
  const todos = new Map();
  /** `ws::sessionId` already got its promote hint this session. */
  const promoted = new Set();
  /** `ws::sessionId::errId` — root-cause hint already shown for that mem. */
  const errorSeen = new Set();
  /** `ws::sessionId` — its todos went pending → 0 (work finished). */
  const workDone = new Set();
  /** `ws::sessionId` — closure hint already shown. */
  const closureSeen = new Set();
  /** `ws::sessionId::taskId` — stale hint already shown for that task. */
  const staleSeen = new Set();
  /** `ws::sessionId::kind` — hint already emitted for that session (P4). */
  const hintSeen = new Set();
  /** ws -> Map<kind, shown|converted> — conversion measurement (P4). */
  const shownCounts = new Map();
  const convertedCounts = new Map();
  /** Unconverted hints within the window: {kind, ws, session, shownAt}. */
  const pending = [];

  function bump(workspace, key) {
    const day = dayKey();
    let buckets = usage.get(workspace);
    if (buckets === void 0) {
      buckets = new Map();
      usage.set(workspace, buckets);
    }
    const cur = buckets.get(day) ?? { mem: 0, esr: 0 };
    cur[key] += 1;
    buckets.set(day, cur);
    if (buckets.size > BALANCE_DAYS + 2) {
      const oldest = dayKey(Date.now() - BALANCE_DAYS * DAY_MS);
      for (const d of [...buckets.keys()]) if (d < oldest) buckets.delete(d);
    }
    if (usage.size > WORKSPACE_CAP) {
      const first = usage.keys().next().value;
      usage.delete(first);
    }
  }

  /** Count one tool call toward the mem/esr balance (no-op for other tools). */
  function record(name, workspace) {
    if (!workspace) return;
    if (MEM_TOOLS.includes(name)) bump(workspace, "mem");
    else if (ESR_TOOLS.includes(name)) bump(workspace, "esr");
  }

  /** tools/result listener. Fire-and-forget; never throws. */
  function handle(exec, result) {
    // eslint-disable-next-line no-unused-vars
    void result;
    try {
      const name = String(exec?.name ?? "").toLowerCase();
      const agent = exec?.agent;
      const sessionId = agent?.session?.id;
      const cwd = agent?.session?.header?.cwd;
      if (!sessionId || typeof cwd !== "string" || cwd.length === 0) return;
      const workspace = wk(cwd);
      record(name, workspace);
      // P4 conversion: an esr_* call inside the window converts this
      // workspace's most recent pending hint.
      if (ESR_TOOLS.includes(name)) attributeConversion(workspace, Date.now());
      if (name !== "todo_write") return;
      // Snapshot this session's pending plan. When a plan that had pending
      // todos transitioned to a fully-completed list, that is a natural
      // "work finished" event → enable the closure hint (P3).
      const names = pendingTodos(exec?.arguments);
      const prev = todos.get(workspace);
      const prevCount = prev !== void 0 && prev.sessionId === sessionId ? prev.count : -1;
      todos.set(workspace, { sessionId, count: names.length, names, updatedAt: Date.now() });
      if (prevCount > 0 && names.length === 0) {
        workDone.add(`${workspace}::${sessionId}`);
      }
      if (todos.size > WORKSPACE_CAP) {
        const first = todos.keys().next().value;
        todos.delete(first);
      }
    } catch {
      // fully contained — a trigger bug must never disturb the tool pipeline
    }
  }

  /**
   * Live mem-vs-esr balance for a workspace (last BALANCE_DAYS).
   * Returns { memCalls, esrCalls, days }; all zeros when no data yet.
   */
  function recentBalance(workspace) {
    const buckets = usage.get(workspace);
    if (buckets === void 0) return { memCalls: 0, esrCalls: 0, days: 0 };
    const oldest = dayKey(Date.now() - BALANCE_DAYS * DAY_MS);
    let memCalls = 0;
    let esrCalls = 0;
    let days = 0;
    for (const [day, c] of buckets) {
      if (day < oldest) continue;
      days += 1;
      memCalls += c.mem;
      esrCalls += c.esr;
    }
    return { memCalls, esrCalls, days };
  }

  // ── P4 conversion measurement ────────────────────────────────────────────

  /** Count a per-(workspace, kind) bucket. */
  function bumpCount(map, workspace, kind, delta) {
    let perWs = map.get(workspace);
    if (perWs === void 0) {
      perWs = new Map();
      map.set(workspace, perWs);
    }
    perWs.set(kind, (perWs.get(kind) ?? 0) + delta);
  }

  /** Merge per-workspace buckets; when ws is given, read only that one. */
  function countsFor(map, workspace) {
    if (workspace !== void 0) return map.get(workspace) ?? new Map();
    const out = new Map();
    for (const perWs of map.values()) {
      for (const [k, n] of perWs) out.set(k, (out.get(k) ?? 0) + n);
    }
    return out;
  }

  /** Drop hints past the conversion window (or when already attributed). */
  function prunePending() {
    const cutoff = Date.now() - CONVERSION_WINDOW_MS;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].shownAt < cutoff) pending.splice(i, 1);
    }
  }

  /**
   * Record that a hint line was actually injected for a session (P4). Each
   * (workspace, session, kind) counts at most once, matching the once-per-
   * session hint semantics — repeated renders of the same hint do not inflate
   * the exposure count.
   */
  function emitHint(kind, workspace, sessionId) {
    if (!kind || !HINT_TAGS[kind] || !workspace || !sessionId) return;
    const key = `${workspace}::${sessionId}::${kind}`;
    if (hintSeen.has(key)) return;
    hintSeen.add(key);
    bumpCount(shownCounts, workspace, kind, 1);
    pending.push({ kind, ws: workspace, session: sessionId, shownAt: Date.now() });
    prunePending();
  }

  /**
   * Attribute the most recent pending hint of this workspace (inside the
   * window) to an esr_* tool call. One call converts one hint — attribution
   * stays honest, the rest expire on their own.
   */
  function attributeConversion(workspace, at) {
    let best = -1;
    for (let i = 0; i < pending.length; i++) {
      const h = pending[i];
      if (h.ws !== workspace) continue;
      if (at - h.shownAt > CONVERSION_WINDOW_MS) continue;
      if (best === -1 || h.shownAt > pending[best].shownAt) best = i;
    }
    if (best === -1) return;
    const h = pending[best];
    pending.splice(best, 1);
    bumpCount(convertedCounts, workspace, h.kind, 1);
  }

  /**
   * Hint → esr_* action conversion (P4). Returns a plain, serializable object:
   *   { windowMs, total: {shown, converted, rate}, byKind: { <kind>: {shown, converted, rate} } }
   * When `workspace` is omitted, aggregates across all workspaces.
   */
  function conversionStats(workspace) {
    prunePending();
    const shown = countsFor(shownCounts, workspace);
    const converted = countsFor(convertedCounts, workspace);
    const byKind = {};
    let shownTotal = 0;
    let convertedTotal = 0;
    for (const kind of Object.keys(HINT_TAGS)) {
      const sh = shown.get(kind) ?? 0;
      const cv = converted.get(kind) ?? 0;
      shownTotal += sh;
      convertedTotal += cv;
      byKind[kind] = { shown: sh, converted: cv, rate: sh > 0 ? +(cv / sh).toFixed(4) : null };
    }
    return {
      windowMs: CONVERSION_WINDOW_MS,
      total: {
        shown: shownTotal,
        converted: convertedTotal,
        rate: shownTotal > 0 ? +(convertedTotal / shownTotal).toFixed(4) : null,
      },
      byKind,
    };
  }

  /**
   * One-shot "promote your plan to an ESR task" hint for the live session.
   * Returns "" unless: this session wrote ≥ minTodosForPromote pending todos,
   * the funnel is narrow (pending > active * todoPromoteRatio), and the hint
   * has not already been emitted this session. Marks the hint emitted on
   * success so it appears at most once per session (no nagging).
   */
  function promoteHint(sessionId, workspace, activeTasks) {
    if (!sessionId || !workspace) return "";
    const snap = todos.get(workspace);
    if (snap === void 0 || snap.sessionId !== sessionId) return "";
    if (snap.count < minTodosForPromote) return "";
    if (snap.count <= activeTasks * todoPromoteRatio) return "";
    const key = `${workspace}::${sessionId}`;
    if (promoted.has(key)) return "";
    promoted.add(key);
    const sample = snap.names
      .slice(0, 2)
      .map((n) => truncate(String(n).replace(/\s*\n+\s*/g, " ").trim(), 36))
      .join(" / ");
    return `promote: ${snap.count} pending todo(s) vs ${activeTasks} ESR task(s) — multi-step work earns a cross-session task now: esr_task(name="${sample}") ${HINT_TAGS.promote}`;
  }

  /**
   * One-shot "root-cause a recurring failure" hint (P0-B). Candidates come
   * from the store (error memories that earned `hits >= minErrorHits` through
   * repeat-failure revival) — the recorder only dedupes which error ids have
   * been surfaced per session. Returns the first not-yet-shown candidate as a
   * line, or "".
   */
  function errorHint(sessionId, workspace, candidates) {
    if (!sessionId || !workspace) return "";
    if (!Array.isArray(candidates) || candidates.length === 0) return "";
    for (const c of candidates) {
      const key = `${workspace}::${sessionId}::${c.id}`;
      if (errorSeen.has(key)) continue;
      errorSeen.add(key);
      const text = truncate(String(c.text).replace(/\s*\n+\s*/g, " ").trim(), 48);
      return `root-cause: ${text} ×${c.hits ?? 1} — esr_task it so the pattern dies ${HINT_TAGS.rootcause}`;
    }
    return "";
  }

  /**
   * One-shot "work is finished — close the READY tasks" hint (P3). Fires only
   * after this session's plan went pending → 0 (recorded from todo_write),
   * only when at least one active task has all evidence, and at most once per
   * session.
   */
  function closureHint(sessionId, workspace, readyTasks) {
    if (!sessionId || !workspace) return "";
    if (!Array.isArray(readyTasks) || readyTasks.length === 0) return "";
    const key = `${workspace}::${sessionId}`;
    if (!workDone.has(key)) return "";
    if (closureSeen.has(key)) return "";
    closureSeen.add(key);
    const t = readyTasks[0];
    return `close: task ${t.id.slice(0, 6)} · ${truncate(t.name, 40)} — evidence complete, esr_close now (artifact/evaluation/memory_ref) ${HINT_TAGS.close}`;
  }

  /**
   * One-shot "this task has gone stale" hint (P3). Candidates are active tasks
   * with no update for `staleTaskDays`. Each task id is surfaced at most once
   * per session (one line per render).
   */
  function staleHint(sessionId, workspace, staleTasks) {
    if (!sessionId || !workspace) return "";
    if (!Array.isArray(staleTasks) || staleTasks.length === 0) return "";
    for (const t of staleTasks) {
      const key = `${workspace}::${sessionId}::${t.id}`;
      if (staleSeen.has(key)) continue;
      staleSeen.add(key);
      const at = t.updatedAt ?? t.createdAt ?? Date.now();
      const days = Math.max(1, Math.round((Date.now() - at) / DAY_MS));
      return `stale: ${t.id.slice(0, 6)} · ${truncate(t.name, 40)} — no update ${days}d, esr_close with evidence or drop the intent ${HINT_TAGS.stale}`;
    }
    return "";
  }

  return { handle, record, recentBalance, promoteHint, errorHint, closureHint, staleHint, emitHint, conversionStats };
}
