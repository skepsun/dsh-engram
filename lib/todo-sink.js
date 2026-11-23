/**
 * dsh-engram: session-end todo auto-sink (audit follow-up).
 *
 * The todo plane (`todo_write`) is per-session working memory: last-write-wins,
 * dies with the session. The promote hint (P0-A) and the GUI 「沉淀到 ESR」 button
 * cover the INTENTIONAL path, but both only fire/run while the session is alive
 * and the funnel is narrow — a session that ends with pending todos silently
 * evaporates its plan (the observed "todo 一直建、esr 长期空" leak).
 *
 * This module closes that gap at the ONE safe boundary: `session/disposed`
 * (the session's teardown edge). The trade-off from the design audit is kept
 * intact:
 *   - nothing is auto-written DURING the session — todo stays cheap/ephemeral
 *     and the [ESR] prefix stays stable;
 *   - the sink never pollutes the active list — landed tasks are `draft`
 *     (excluded from [ESR] active rows by buildEsrSnapshot), deduped against
 *     existing non-stable tasks and recently-closed stable tasks by name, and
 *     capped by `maxTasksPerWorkspace`;
 *   - a draft still needs the deliberate `esr_claim` / `esr_task` step to
 *     become active, so the "committed work" obligation is never created
 *     implicitly — the session plan becomes lossless, not obligated.
 *
 * All functions are pure / contained and unit-testable without the harness.
 */

import { pendingTodos } from "./trigger.js";
import { shortId, uuid } from "./util.js";
import { readSessionEvents } from "./session-events.js";

/** Description stamped on every auto-sunk draft (mirrors the GUI button's note). */
export const SINK_DESCRIPTION = "源自会话计划（会话结束自动沉淀）";

const DAY_MS = 86_400_000;

/**
 * Default recency window (days) during which a closed (`stable`) task suppresses
 * auto-sinking a same-named pending todo, preventing "close once, resurrect on
 * next session end" loops while still letting genuinely recurring work re-sink
 * after the window elapses.
 */
export const DEFAULT_STABLE_DEDUPE_DAYS = 14;

function taskBlocksSink(task, nowMs, stableWindowMs) {
  if (task === null || typeof task !== "object") return false;
  if (task.state !== "stable") return true;
  if (!(stableWindowMs > 0)) return false;
  const closedAt = (Number.isFinite(task.stateChangedAt) && task.stateChangedAt > 0)
    ? task.stateChangedAt
    : (Number.isFinite(task.updatedAt) && task.updatedAt > 0 ? task.updatedAt : task.createdAt);
  // Minimal/legacy stable records without a valid timestamp still dedupe rather
  // than silently resurrecting closed work.
  if (!Number.isFinite(closedAt) || closedAt <= 0) return true;
  return nowMs - closedAt <= stableWindowMs;
}

/**
 * Extract the FINAL pending todo list from a session's event log: the last
 * `todo/write` event (whole-list snapshot) filtered to unfinished items, in
 * order. Returns [] when the session never wrote todos or everything is done.
 * Deterministic — this is a pure function of the session log, so it survives
 * process restarts (no reliance on the process-local recorder snapshot).
 */
export function pendingTodosFromSession(session, sessionQuery = void 0) {
  if (session === null || typeof session !== "object") return [];
  const events = readSessionEvents(session, sessionQuery);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event === null || typeof event !== "object" || event.type !== "todo/write") continue;
    // Event data is the same { todos: TodoItem[] } shape todo_write args wear.
    return pendingTodos(event.data);
  }
  return [];
}

/**
 * Decide which pending todos should sink into ESR, and in what order. Pure:
 *   - names already held by a non-stable task, or by a `stable` task closed
 *     within `stableDedupeDays` (default 14d), are skipped (dedupe — a task
 *     already created or recently closed is not re-created);
 *   - within-list duplicates sink only once;
 *   - the workspace cap (`maxTasksPerWorkspace`, counting drafts/active only)
 *     is honoured: once `activeCount + created` reaches `maxTasks`, the rest
 *     are reported as `atCap` instead of created.
 *
 * @param {string[]} todos pending todo names, in plan order
 * @param {Array<{name?: string, state?: string, stateChangedAt?: number, updatedAt?: number, createdAt?: number}>} existingTasks tasks of the workspace (non-stable + optionally stable)
 * @param {{ maxTasks?: number, activeCount?: number, now?: number | (() => number), stableDedupeDays?: number }} opts
 * @returns {{ toCreate: string[], existed: string[], atCap: string[] }}
 */
export function planTodoSink(todos, existingTasks, opts = {}) {
  const maxTasks = Number.isFinite(opts.maxTasks) && opts.maxTasks > 0 ? opts.maxTasks : 10;
  const tasks = Array.isArray(existingTasks) ? existingTasks : [];
  const activeCount = opts.activeCount !== void 0
    ? opts.activeCount
    : tasks.filter((t) => t?.state !== "stable").length;
  const nowMs = typeof opts.now === "function" ? opts.now() : Number.isFinite(opts.now) ? opts.now : Date.now();
  const stableDedupeDays = Number.isFinite(opts.stableDedupeDays) && opts.stableDedupeDays >= 0
    ? opts.stableDedupeDays
    : DEFAULT_STABLE_DEDUPE_DAYS;
  const stableWindowMs = stableDedupeDays * DAY_MS;
  const existing = new Set(
    tasks
      .filter((t) => taskBlocksSink(t, nowMs, stableWindowMs))
      .map((t) => String(t?.name ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const toCreate = [];
  const existed = [];
  const atCap = [];
  const seen = new Set();
  for (const todo of todos ?? []) {
    const name = String(todo ?? "").trim().slice(0, 200);
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // within-list duplicate → single sink
    seen.add(key);
    if (existing.has(key)) {
      existed.push(name);
      continue;
    }
    if (activeCount + toCreate.length >= maxTasks) {
      atCap.push(name);
      continue;
    }
    toCreate.push(name);
  }
  return { toCreate, existed, atCap };
}

/**
 * Sink a finished session's pending todos into ESR as DRAFT tasks. Best-effort,
 * never throws into the caller — failures surface via the returned counts plus
 * whatever the caller logs. Returns { created, existed, atCap } name lists.
 *
 * @param {object} domain the opened engram store domain (putTask/listTasks/activeTaskCount)
 * @param {string} workspace normalized workspace key
 * @param {string[]} todos pending todo names
 * @param {{ sessionId?: string, maxTasks?: number, description?: string, now?: number | (() => number), stableDedupeDays?: number }} opts
 */
export async function sinkPendingTodos(domain, workspace, todos, opts = {}) {
  const record = { created: [], existed: [], atCap: [] };
  if (!Array.isArray(todos) || todos.length === 0) return record;
  if (domain === null || typeof domain !== "object" || typeof domain.putTask !== "function") return record;
  const sessionId = opts.sessionId ?? "auto-sink";
  const nowMs = typeof opts.now === "function" ? opts.now() : Number.isFinite(opts.now) ? opts.now : Date.now();
  const existingTasks = typeof domain.listTasks === "function"
    ? domain.listTasks(workspace, { includeStable: true })
    : [];
  const activeCount = typeof domain.activeTaskCount === "function"
    ? domain.activeTaskCount(workspace)
    : existingTasks.filter((t) => t?.state !== "stable").length;
  const { toCreate, existed, atCap } = planTodoSink(todos, existingTasks, {
    maxTasks: opts.maxTasks,
    activeCount,
    now: nowMs,
    stableDedupeDays: opts.stableDedupeDays,
  });
  record.existed = existed;
  record.atCap = atCap;
  for (const name of toCreate) {
    await domain.putTask({
      id: `tsk_${shortId(uuid())}`,
      workspace,
      name,
      description: opts.description ?? SINK_DESCRIPTION,
      state: "draft",
      artifact: null,
      evaluation: null,
      memoryRefs: [],
      sessionId,
      createdAt: nowMs,
      updatedAt: nowMs,
      stateChangedAt: 0,
      deps: [],
      assignee: null,
      claimedAt: null,
    });
    record.created.push(name);
  }
  return record;
}
