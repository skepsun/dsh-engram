/**
 * Observability for the four features that read the session event log.
 *
 * WHY THIS EXISTS (2026-10-27, issue #9): `[RECALL]`, the session episode, the
 * resume brief and the session-end todo sink all depend on ONE host capability
 * — a readable session event log. When a host stops exposing every read path,
 * the four of them sleep together and the only trace is a single `warn` line on
 * a terminal nobody kept. The reporter in issue #9 had to decompress
 * `session.v4.jsonl.zstd` frames by hand to prove the features were not merely
 * "not triggered yet".
 *
 * A warning is not an artifact. This module records which read path the live
 * process actually took, once per session, into
 * `$DSH_HOME/engram/push-legs.jsonl` so `dsh-engram status` can answer
 * "were the push legs awake?" without a session, a log capture, or a report.
 *
 * The record is append-only and bounded (tail kept, like the other telemetry
 * files): diagnostics must never grow without limit or throw into the
 * assembly path.
 * @module dsh-engram/push-legs
 */

import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Rows kept before the file is rewritten (tail-first). */
export const PUSH_LEGS_KEEP = 50;
/** Size at which the file is rewritten to the kept tail. */
const PUSH_LEGS_MAX_BYTES = 32 * 1024;

/**
 * `<engramDir>/push-legs.jsonl`.
 *
 * The argument is the ENGRAM directory (`~/.dsh/engram`), not the DSH home:
 * `engramHome()` already ends in `engram/`, and appending it a second time is
 * how 0.8.7 shipped a telemetry file at `~/.dsh/engram/engram/push-legs.jsonl`
 * that `dsh-engram status` then reported as never written. Kept explicit so the
 * two call sites cannot disagree again.
 */
export function pushLegsPath(engramDir) {
  return join(engramDir, "push-legs.jsonl");
}

/**
 * Record the read path (and rendered block sizes) taken for one session.
 * Best effort: never throws.
 *
 * @param {object} options
 * @param {string} options.engramDir engram directory (`~/.dsh/engram`)
 * @param {string} options.source `sessionEventsSource()` verdict
 * @param {string} [options.sessionId]
 * @param {string} [options.workspace]
 * @param {{ engramChars?: number, resumeChars?: number, recallChars?: number, workspaceMemories?: number }} [options.render]
 * @param {number} [options.pid]
 * @param {number} [options.now]
 * @returns {boolean} whether the row was written
 */
export function noteSessionEventsSource({ engramDir, source, sessionId, workspace, render, pid = process.pid, now = Date.now() } = {}) {
  if (typeof engramDir !== "string" || engramDir.length === 0) return false;
  if (typeof source !== "string" || source.length === 0) return false;
  const path = pushLegsPath(engramDir);
  const payload = { at: now, pid, sessionId: sessionId ?? null, source };
  if (typeof workspace === "string" && workspace.length > 0) payload.workspace = workspace;
  if (render !== null && typeof render === "object") {
    if (Number.isFinite(render.engramChars)) payload.engramChars = Math.max(0, Math.trunc(render.engramChars));
    if (Number.isFinite(render.resumeChars)) payload.resumeChars = Math.max(0, Math.trunc(render.resumeChars));
    if (Number.isFinite(render.recallChars)) payload.recallChars = Math.max(0, Math.trunc(render.recallChars));
    if (Number.isFinite(render.workspaceMemories)) payload.workspaceMemories = Math.max(0, Math.trunc(render.workspaceMemories));
  }
  const row = `${JSON.stringify(payload)}\n`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path) && statSync(path).size > PUSH_LEGS_MAX_BYTES) {
      const kept = readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0).slice(-PUSH_LEGS_KEEP);
      writeFileSync(`${path}.tmp`, `${kept.join("\n")}\n`, "utf8");
      renameSync(`${path}.tmp`, path);
    }
    appendFileSync(path, row, "utf8");
    return true;
  } catch {
    return false;
  }
}

function extractRender(row) {
  if (row === null || typeof row !== "object") return null;
  const hasAny =
    Number.isFinite(row.engramChars) ||
    Number.isFinite(row.resumeChars) ||
    Number.isFinite(row.recallChars) ||
    Number.isFinite(row.workspaceMemories);
  if (!hasAny) return null;
  return {
    engramChars: Number.isFinite(row.engramChars) ? Math.max(0, Math.trunc(row.engramChars)) : 0,
    resumeChars: Number.isFinite(row.resumeChars) ? Math.max(0, Math.trunc(row.resumeChars)) : 0,
    recallChars: Number.isFinite(row.recallChars) ? Math.max(0, Math.trunc(row.recallChars)) : 0,
    workspaceMemories: Number.isFinite(row.workspaceMemories) ? Math.max(0, Math.trunc(row.workspaceMemories)) : null,
  };
}

/**
 * Newest recorded read path (and how many rows mention each verdict), plus
 * render-leg sizes when present (for silent-empty detection and offline G5).
 * Never throws; returns `undefined` when nothing was ever recorded.
 *
 * @param {string} engramDir engram directory (`~/.dsh/engram`)
 * @returns {{
 *   at: number,
 *   source: string,
 *   sessionId: string|null,
 *   workspace: string|null,
 *   pid: number,
 *   counts: Record<string, number>,
 *   render: { engramChars: number, resumeChars: number, recallChars: number, workspaceMemories: number|null } | null,
 *   indexChars: { max: number, latest: number, samples: number, workspace: string|null, at: number } | null,
 * } | undefined}
 */
export function readPushLegsHealth(engramDir) {
  if (typeof engramDir !== "string" || engramDir.length === 0) return undefined;
  let raw;
  try {
    raw = readFileSync(pushLegsPath(engramDir), "utf8");
  } catch {
    return undefined;
  }
  const counts = {};
  let newest;
  let indexMax = 0;
  let indexSamples = 0;
  let latestIndexRow;
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof row?.source !== "string") continue;
    counts[row.source] = (counts[row.source] ?? 0) + 1;
    if (newest === undefined || (typeof row.at === "number" && row.at >= (newest.at ?? 0))) newest = row;
    if (Number.isFinite(row.engramChars) && row.engramChars > 0) {
      const chars = Math.trunc(row.engramChars);
      indexSamples += 1;
      if (chars > indexMax) indexMax = chars;
      if (latestIndexRow === undefined || (typeof row.at === "number" && row.at >= (latestIndexRow.at ?? 0))) {
        latestIndexRow = row;
      }
    }
  }
  if (newest === undefined) return undefined;
  return {
    at: typeof newest.at === "number" ? newest.at : 0,
    source: newest.source,
    sessionId: typeof newest.sessionId === "string" ? newest.sessionId : null,
    workspace: typeof newest.workspace === "string" ? newest.workspace : null,
    pid: typeof newest.pid === "number" ? newest.pid : 0,
    counts,
    render: extractRender(newest),
    indexChars: indexSamples > 0
      ? {
          max: indexMax,
          latest: Math.trunc(latestIndexRow.engramChars),
          samples: indexSamples,
          workspace: typeof latestIndexRow.workspace === "string" ? latestIndexRow.workspace : null,
          at: typeof latestIndexRow.at === "number" ? latestIndexRow.at : 0,
        }
      : null,
  };
}

/**
 * One-line human summary for `dsh-engram status`.
 * @param {ReturnType<typeof readPushLegsHealth>} health
 * @returns {string}
 */
export function describePushLegs(health) {
  if (health === undefined) return "推送腿：还没记录（本机还没有会话装配过）";
  const when = new Date(health.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const tally = Object.entries(health.counts)
    .map(([source, count]) => `${source}×${count}`)
    .join(" · ");
  let renderSuffix = "";
  if (health.render !== null && health.render !== undefined) {
    const r = health.render;
    renderSuffix = ` · 渲染 [ENGRAM]=${r.engramChars}c [RESUME]=${r.resumeChars}c [RECALL]=${r.recallChars}c`;
    if (Number.isFinite(r.workspaceMemories) && r.workspaceMemories > 0 && r.engramChars === 0) {
      renderSuffix += ` ⚠ 库有 ${r.workspaceMemories} 条记忆但 [ENGRAM]=0c`;
    }
  }
  if (health.source === "none") {
    return `推送腿：⚠ 事件日志不可读（none）—— [RECALL]/episode/resume/todo-sink 休眠中 · ${when} · ${tally}${renderSuffix}`;
  }
  return `推送腿：事件日志读法 ${health.source} · 最近 ${when} · ${tally}${renderSuffix}`;
}
