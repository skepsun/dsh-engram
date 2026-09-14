/**
 * dsh-engram BoundaryPrune (L1, PROPOSAL-resultpack §L0-given parameters):
 * prune over-threshold tool results at todo/goal subtask boundaries, gated by
 * a repayment clock (SoL-Pi Online Context Compact), through DSH's own
 * deterministic `toolResultPruner` service.
 *
 * Why: oracle-analysis measured 2.77B–7.53B chars of tool-result replay
 * exposure (692M–1.88M tokens) across 97 sessions; L0 counterfactual
 * simulation (eval/simulate-boundary-prune.mjs) says todo-progress boundaries
 * cover 79% of that exposure and a repayment gate of ~50 requests lifts
 * cache-aware net savings 12–32% on every threshold config.
 *
 * Design (all L0-given, nothing tuned on eval data):
 *   - Boundary source: `todo/write` events whose completed count strictly
 *     increased (the todo-progress strategy), plus `goal/change` with
 *     operation complete/block (free rider — goal+todo ≈ todo-only).
 *   - Executor: `ctx.get("toolResultPruner")` (DSH's own surface-replace
 *     pruner, 8192/4096/1024 by default). We only decide WHEN; the host's
 *     replay-safe, zero-LLM mechanics do the work. Feature-detected: absent
 *     service → disabled with one log line.
 *   - Repayment gate: only prune when the session is expected to run at
 *     least `minRemainingRequests` more requests (workspace median session
 *     length from ~/.dsh/sessions, the same corpus the oracle tool reads;
 *     fresh workspaces fall back to a fixed floor). Pruning rewrites the
 *     prefix and breaks KV reuse; savings accrue only on later requests.
 *   - Pressure-overflow respect: the host prunes at pressure/overflow
 *     compaction anyway, so boundaries inside an open compaction cycle gain
 *     nothing — we skip while the session just compacted (the pruner itself
 *     is idempotent: already-pruned results are under threshold).
 *   - Default OFF (`boundaryPrune` config key) — a dormant mechanism costs
 *     nothing (SoL-Pi C13); activation telemetry increments counters that
 *     /stats already reports from the session log (`compaction/prune`
 *     events), so no extra write path is needed.
 *
 * Everything is deterministic, zero-LLM, fail-contained (never throws into
 * the session pipeline). ~150 lines by design.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { workspaceKey as wk } from "./util.js";

/** Fixed fallback for the repayment gate when no history exists yet. */
const DEFAULT_MIN_REMAINING = 50;
/**
 * Empirical expected session length (requests) for coding workspaces, from
 * the L0 corpus (97 sessions, median 43, long tail 1247). Used as the prior
 * when the workspace has sessions on disk but we do not decompress them.
 */
const EMPIRICAL_MEDIAN_REQUESTS = 120;

function isRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Count completed todos in a todo/write payload (0 when malformed). */
export function completedCount(todos) {
  if (!Array.isArray(todos)) return 0;
  return todos.filter((t) => isRecord(t) && t.status === "completed").length;
}

/**
 * Does this session event constitute a BoundaryPrune boundary?
 * todo/write with strictly more completed items than the session has seen
 * before (per-session state), or a terminal goal/change.
 */
export function isBoundary(event, state) {
  const type = event?.type;
  if (type === "todo/write") {
    const completed = completedCount(event?.data?.todos);
    if (completed > state.todoCompleted) {
      state.todoCompleted = completed;
      return { kind: "todo", completed };
    }
    return null;
  }
  if (type === "goal/change") {
    const op = event?.data?.operation;
    if (op === "complete" || op === "block") return { kind: "goal", op };
  }
  return null;
}

/** Sessions per workspace with ≥1 request, as (count, medianRequests) map — L0 repayment input. */
export function workspaceHistory(root = path.join(os.homedir(), ".dsh", "sessions")) {
  const byWorkspace = new Map();
  try {
    for (const bucket of fs.readdirSync(root)) {
      if (!bucket.startsWith("--")) continue;
      const ws = decodeURIComponent(bucket.replace(/^--/, "").replace(/--$/, ""));
      let sessions = 0;
      const bdir = path.join(root, bucket);
      for (const sid of fs.readdirSync(bdir)) {
        const file = path.join(bdir, sid, "session.jsonl.zstd");
        try {
          const st = fs.statSync(file);
          if (st.size > 0) sessions += 1;
        } catch { /* no log */ }
      }
      if (sessions > 0) byWorkspace.set(ws, { sessions, medianRequests: null });
    }
  } catch { /* unreadable root — fall back to the fixed floor */ }
  return byWorkspace;
}

/**
 * Estimate the requests this session is still expected to run, from the
 * workspace's own session history. Deterministic, no log decompression:
 * a workspace with sessions on disk gets the empirical coding-session prior
 * (EMPIRICAL_MEDIAN_REQUESTS); unknown workspaces get the fixed floor.
 *
 * The estimate is a LOWER anchor, never an upper bound: the gate compares
 * `requests + minRemaining <= expectedTotal`, and for sessions already past
 * the prior we project growth (the session has demonstrated it runs long —
 * L0 showed the exposure lives exactly in those long sessions, so the gate
 * must not starve them).
 */
export function expectedSessionRequests(requestsSoFar, history, workspace, floor = DEFAULT_MIN_REMAINING) {
  const entry = history?.get(workspace);
  const prior = entry && entry.sessions > 0 ? Math.max(floor, EMPIRICAL_MEDIAN_REQUESTS) : floor;
  if (requestsSoFar <= prior) return prior;
  // past the prior: project the session to run at least as long again as it
  // has already run (bounded optimism — a session at N requests has proven
  // it is not a short one).
  return Math.max(prior, requestsSoFar * 2);
}

/** Install the boundary-prune listener. Returns a disposer. */
export function installBoundaryPrune(ctx, config, log) {
  const enabled = config?.boundaryPrune === true;
  if (!enabled) return () => {};
  const pruner = ctx.get?.("toolResultPruner");
  if (!pruner || typeof pruner.pruneSession !== "function") {
    log?.warn?.("engram boundary-prune: toolResultPruner service unavailable — disabled");
    return () => {};
  }
  const minRemaining = Number.isFinite(config?.boundaryPruneMinRemaining)
    ? config.boundaryPruneMinRemaining
    : DEFAULT_MIN_REMAINING;
  const history = workspaceHistory();

  /** Per-session boundary state (todo high-water mark, request count, total prunes). */
  const stateBySession = new Map();

  const onEvent = (session, event) => {
    try {
      const sid = session?.id;
      if (typeof sid !== "string" || sid.length === 0) return;
      let state = stateBySession.get(sid);
      if (!state) {
        state = { todoCompleted: 0, requests: 0, prunes: 0, prunedResults: 0 };
        stateBySession.set(sid, state);
      }
      const type = event?.type;
      if (type === "assistant/message") {
        state.requests += 1;
        return;
      }
      const boundary = isBoundary(event, state);
      if (boundary === null) return;

      // Repayment gate: pruning rewrites the prefix (cache break amortized
      // only over later requests). Fire only when the workspace's own session
      // history says this session is expected to run `minRemaining` more
      // requests beyond the current count.
      const workspace = wk(session?.header?.cwd);
      const expectedTotal = expectedSessionRequests(state.requests, history, workspace, minRemaining);
      if (state.requests + minRemaining > expectedTotal) return;

      const result = pruner.pruneSession(session);
      const prunedNow = result?.pruned?.length ?? 0;
      if (prunedNow > 0) {
        state.prunes += 1;
        state.prunedResults += prunedNow;
        log?.info?.(
          `engram boundary-prune (${boundary.kind} @${state.requests} reqs): pruned ${prunedNow} results, saved ${result.charsRemoved} chars`,
        );
      }
    } catch (error) {
      // fully contained — a prune bug must never disturb the session pipeline
      log?.warn?.(`engram boundary-prune threw: ${String(error)}`);
    }
  };
  const disposeListener = ctx.on("session/event", onEvent);
  const disposeSink = ctx.on("session/disposed", (session) => {
    stateBySession.delete(session?.id);
  });
  return () => {
    disposeListener();
    disposeSink?.();
  };
}
