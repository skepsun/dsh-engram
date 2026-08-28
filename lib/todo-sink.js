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
 *     existing non-stable tasks by name, and capped by `maxTasksPerWorkspace`;
 *   - a draft still needs the deliberate `esr_claim` / `esr_task` step to
 *     become active, so the "committed work" obligation is never created
 *     implicitly — the session plan becomes lossless, not obligated.
 *
 * All functions are pure / contained and unit-testable without the harness.
 */

import { pendingTodos } from "./trigger.js";
import { shortId, uuid } from "./util.js";

/** Description stamped on every auto-sunk draft (mirrors the GUI button's note). */
export const SINK_DESCRIPTION = "源自会话计划（会话结束自动沉淀）";

/**
 * Extract the FINAL pending todo list from a session's event log: the last
 * `todo/write` event (whole-list snapshot) filtered to unfinished items, in
 * order. Returns [] when the session never wrote todos or everything is done.
 * Deterministic — this is a pure function of the session log, so it survives
 * process restarts (no reliance on the process-local recorder snapshot).
 */
export function pendingTodosFromSession(session) {
  if (session === null || typeof session !== "object") return [];
  const events = Array.isArray(session.events) ? session.events : [];
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
 *   - names already held by a non-stable task are skipped (dedupe — a task the
 *     promote hint / GUI button already created is not re-created);
 *   - within-list duplicates sink only once;
 *   - the workspace cap (`maxTasksPerWorkspace`, counting drafts) is honoured:
 *     once `activeCount + created` reaches `maxTasks`, the rest are reported as
 *     `atCap` instead of created.
 *
 * @param {string[]} todos pending todo names, in plan order
 * @param {Array<{name?: string}>} existingTasks non-stable tasks of the workspace
 * @param {{ maxTasks?: number, activeCount?: number }} opts
 * @returns {{ toCreate: string[], existed: string[], atCap: string[] }}
 */
export function planTodoSink(todos, existingTasks, opts = {}) {
  const maxTasks = Number.isFinite(opts.maxTasks) && opts.maxTasks > 0 ? opts.maxTasks : 10;
  const activeCount = opts.activeCount !== void 0
    ? opts.activeCount
    : (Array.isArray(existingTasks) ? existingTasks.length : 0);
  const existing = new Set(
    (Array.isArray(existingTasks) ? existingTasks : [])
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
 * @param {{ sessionId?: string, maxTasks?: number, description?: string, now?: number }} opts
 */
export async function sinkPendingTodos(domain, workspace, todos, opts = {}) {
  const record = { created: [], existed: [], atCap: [] };
  if (!Array.isArray(todos) || todos.length === 0) return record;
  if (domain === null || typeof domain !== "object" || typeof domain.putTask !== "function") return record;
  const sessionId = opts.sessionId ?? "auto-sink";
  const nowMs = typeof opts.now === "function" ? opts.now() : Number.isFinite(opts.now) ? opts.now : Date.now();
  const existingTasks = typeof domain.listTasks === "function"
    ? domain.listTasks(workspace, { includeStable: false })
    : [];
  const activeCount = typeof domain.activeTaskCount === "function"
    ? domain.activeTaskCount(workspace)
    : existingTasks.length;
  const { toCreate, existed, atCap } = planTodoSink(todos, existingTasks, {
    maxTasks: opts.maxTasks,
    activeCount,
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
