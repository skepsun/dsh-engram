/**
 * Activation telemetry for the SoL-Pi mechanisms (dsh-engram).
 *
 * SoL-Pi methodology pair rule: M15 "mechanisms must prove activation" and
 * C13 "dormant mechanisms are off by default" — a mechanism that cannot be
 * observed activating is treated as dormant. This module gives BoundaryPrune
 * (L1) + ResultPack (L2) an observable, durable activation record:
 *
 *   - `recordBoundaryPruneFire` is called on every real prune (fires > 0) —
 *     durable JSON under the engram home, cumulative across restarts, so
 *     /stats and the GUI overview can prove the mechanism actually fires on
 *     the live profile (not just in the simulation).
 *   - `readBoundaryPruneStats` / `readRecallInjections` are pure readers.
 *
 * Zero LLM, pure deterministic bookkeeping. Two files today:
 *   ~/.dsh/engram/boundary-prune.status.json
 *   ~/.dsh/engram/recall-injections.json
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Default engram home: `$DSH_HOME/engram` when set (tests, sandboxes, custom
 *  installs), else `~/.dsh/engram` (mirrors status.js / result-pack.js). A
 *  plain `~/.dsh` default made every test run write live telemetry into the
 *  developer's real install. */
export function engramHome(home = void 0) {
  if (typeof home === "string" && home.length > 0) return home;
  const dshHome = process.env.DSH_HOME;
  return dshHome !== void 0 && dshHome.length > 0
    ? path.join(dshHome, "engram")
    : path.join(os.homedir(), ".dsh", "engram");
}

function statusFile(home, name) {
  return path.join(home, name);
}

/** Atomic-ish write: tmp + rename, so a crash never leaves a torn file. */
function writeJsonAtomic(file, payload) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // best-effort telemetry — never throw into the prune pipeline
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Record one BoundaryPrune fire (a real prune happened) into durable state.
 * `report` is the pruner's pruneSession result. Returns the new cumulative
 * stats object (or null when writing failed).
 */
export function recordBoundaryPruneFire({ home, boundary, report, workspace, now = Date.now() } = {}) {
  const prev = readBoundaryPruneStats({ home }) ?? {};
  const pruned = Array.isArray(report?.pruned) ? report.pruned.length : 0;
  const chars = Number.isFinite(report?.charsRemoved) ? report.charsRemoved : 0;
  const kind = boundary?.kind ?? "unknown";
  const byKind = { ...(prev.byKind ?? {}) };
  byKind[kind] = (byKind[kind] ?? 0) + 1;
  const next = {
    version: 1,
    fires: (prev.fires ?? 0) + 1,
    prunedResults: (prev.prunedResults ?? 0) + pruned,
    charsRemoved: (prev.charsRemoved ?? 0) + chars,
    uses: (prev.uses ?? 0) + 1, // legacy alias kept for GUI tolerance
    lastFire: now,
    lastBoundary: kind,
    lastWorkspace: workspace ?? prev.lastWorkspace ?? null,
    byKind,
  };
  writeJsonAtomic(statusFile(home, "boundary-prune.status.json"), next);
  return next;
}

/** Read the cumulative BoundaryPrune activation record (never throws). */
export function readBoundaryPruneStats({ home } = {}) {
  return readJson(statusFile(home, "boundary-prune.status.json"));
}

/**
 * Record one [RECALL] injection (a session-start recall block was actually
 * appended to a session) for the activation funnel: injections → tool
 * queries → hits → detail-follows.
 */
export function recordRecallInjection({ home, workspace, hits, now = Date.now() } = {}) {
  const prev = readRecallInjections({ home }) ?? { version: 1, injections: 0, hitInjections: 0 };
  const next = {
    version: 1,
    injections: (prev.injections ?? 0) + 1,
    hitInjections: (prev.hitInjections ?? 0) + (hits > 0 ? 1 : 0),
    hitsInjected: (prev.hitsInjected ?? 0) + (hits > 0 ? hits : 0),
    lastInjection: now,
    lastWorkspace: workspace ?? prev.lastWorkspace ?? null,
  };
  writeJsonAtomic(statusFile(home, "recall-injections.json"), next);
  return next;
}

/** Read the cumulative [RECALL] injection record (never throws). */
export function readRecallInjections({ home } = {}) {
  return readJson(statusFile(home, "recall-injections.json"));
}

/** Aggregate both telemetry files into one summary for /stats + overview. */
export function readPackTelemetry({ home } = {}) {
  return {
    boundaryPrune: readBoundaryPruneStats({ home }),
    recall: readRecallInjections({ home }),
  };
}
