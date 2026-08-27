/**
 * dsh-engram: DSH goal-domain integration.
 *
 * The harness's goal service persists a durable `goal/change` session event on
 * every goal mutation. This module listens for those events and turns the two
 * terminal states into memories, so a completed / blocked goal survives the
 * session — deterministic, zero LLM, purely mechanical:
 *
 *   - complete → `handoff` memory (high signal, tag `goal`)
 *   - block    → `error` memory (tag `goal` + `blocked`) — the blocker is a
 *                real, recall-worthy signal
 *
 * The goal snapshot fields are read verbatim; nothing here calls a model and
 * the listener never throws into the session pipeline (fully contained).
 */

import { workspaceKey as wk } from "./util.js";

function isRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Pure reducer: map a `goal/change` session-event payload to a memory entry,
 * or null when the event is not a terminal goal state worth sedimenting.
 * Deterministic and unit-testable without the harness.
 */
export function goalChangeToMemory(change) {
  if (!isRecord(change) || change.kind !== "goal/change") return null;
  if (change.operation !== "complete" && change.operation !== "block") return null;
  const goal = change.goal;
  if (!isRecord(goal) || typeof goal.objective !== "string") return null;
  const objective = goal.objective.trim().slice(0, 400);
  if (objective.length === 0) return null;
  if (change.operation === "complete") {
    return {
      kind: "handoff",
      text: `goal complete: ${objective}`,
      tags: ["goal", "auto-captured", "complete"],
      signal: 0.6,
    };
  }
  const reason = typeof goal.blockedReason === "string" && goal.blockedReason.trim().length > 0
    ? ` — ${goal.blockedReason.trim().slice(0, 160)}`
    : "";
  return {
    kind: "error",
    text: `goal blocked: ${objective}${reason}`,
    tags: ["goal", "auto-captured", "blocked"],
    signal: 0.4,
  };
}

/**
 * Install the `session/event` listener that auto-sediments terminal goals.
 * `storeAdapter` is any { storeMemory(entry) -> Promise } face (the same lazy
 * adapter auto-capture uses); it is resolved per event, so early events that
 * beat the first domain open are simply dropped. Returns the disposer.
 */
export function installGoalCapture(ctx, storeAdapter, log) {
  const onEvent = (session, event) => {
    try {
      if (event?.type !== "goal/change") return;
      const entry = goalChangeToMemory(event.data);
      if (entry === null) return;
      const cwd = session?.header?.cwd;
      const sessionId = session?.id;
      if (typeof cwd !== "string" || cwd.length === 0) return;
      if (typeof sessionId !== "string" || sessionId.length === 0) return;
      storeAdapter
        .storeMemory({
          workspace: wk(cwd),
          kind: entry.kind,
          text: entry.text,
          tags: entry.tags,
          signal: entry.signal,
          filePath: null,
          sessionId,
          seq: 0,
        })
        .then(() => {})
        .catch((error) => log?.warn?.(`engram goal capture failed: ${String(error)}`));
    } catch (error) {
      // fully contained — a capture bug must never disturb the session pipeline
      log?.warn?.(`engram goal capture threw: ${String(error)}`);
    }
  };
  return ctx.on("session/event", onEvent);
}
