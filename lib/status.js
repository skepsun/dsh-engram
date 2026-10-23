/**
 * Durable Context GC status artifact.
 *
 * The plugin writes a tiny JSON file under the DSH home at boot once the host
 * compaction engine and the web-plane wiring have both settled. It is the
 * offline, inspectable truth for "is Context GC actually active and where?" —
 * readable by the shipped `dsh-engram` CLI and by support/diagnostics without
 * booting a session or parsing startup logs.
 * @module dsh-engram/status
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** The DSH home directory (env override, else `~/.dsh`). */
export function engramHomeDir() {
  return process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), ".dsh");
}

/** Absolute path of the Context GC status file. */
export function contextGcStatusPath() {
  return join(engramHomeDir(), "engram", "context-gc.status.json");
}

/** How much a snapshot can say about the credit paths: 0 = nothing armed. */
function rankHost(host) {
  if (host === "context-gc") return 3;
  if (host === "default") return 2;
  if (host === "unavailable") return 1;
  return 0;
}

/** Whether a pid is still running (EPERM counts as alive). */
function isAlivePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * Atomically write the status snapshot (tmp + rename). Never throws for the
 * caller's convenience; a failure is logged by the caller if it cares.
 * @param {object} payload
 * @returns {Promise<void>}
 */
export async function writeContextGcStatus(payload) {
  const path = contextGcStatusPath();
  // Two plugin instances can settle in one process (the host row and a sibling
  // realm that lost the `compaction` provider). Last-writer-wins then reports a
  // working host as "unavailable" — a status file that lies is worse than none,
  // so within one pid a *worse* snapshot never overwrites a better one.
  const incoming = rankHost(payload?.host) + (payload?.boundaryPrune?.armed === true ? 1 : 0);
  const existing = await readContextGcStatus().catch(() => void 0);
  if (existing !== void 0 && existing.pid !== void 0) {
    const current = rankHost(existing.host) + (existing?.boundaryPrune?.armed === true ? 1 : 0);
    if (incoming < current) {
      // Same pid: never downgrade (a sibling realm instance shares the process).
      if (existing.pid === payload?.pid) return;
      // Different pid: a LIVE writer keeps the file. Without this, any stray
      // short-lived process that loads the plugin (a test run, a one-shot CLI,
      // a headless probe with factory defaults) overwrites the running server's
      // snapshot with "host unavailable / L1 not armed" — the status file lies,
      // and every downstream reader believes it.
      if (isAlivePid(existing.pid)) return;
    }
  }
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(
    tmp,
    `${JSON.stringify({ version: 1, ...payload, writtenAt: Date.now() }, null, 2)}\n`,
    "utf8",
  );
  await rename(tmp, path);
}

/**
 * Read the last status snapshot. Returns `undefined` when none exists yet
 * (safe to treat as "not yet initialized").
 * @returns {Promise<Record<string, any> | undefined>}
 */
export async function readContextGcStatus() {
  try {
    return JSON.parse(await readFile(contextGcStatusPath(), "utf8"));
  } catch {
    return undefined;
  }
}

/** Append-only log of compaction attempts (JSONL): the evidence that the
 *  Context GC path actually ran — and the error when it did not. Without it a
 *  broken engine looks exactly like a working one: the host silently falls
 *  back to its default summarizer and the ledger credits nothing. */
export function gcAttemptPath() {
  return join(engramHomeDir(), "engram", "compaction-attempts.jsonl");
}

/**
 * Record one attempt. Best effort: accounting/diagnostics must never break the
 * compaction path. Keeps the tail bounded (rewrites to the last 20 lines past
 * 32 KB) so a long-lived install cannot grow the file forever.
 * @param {{ok: boolean, [key: string]: any}} payload
 * @returns {Promise<void>}
 */
export async function recordGcAttempt(payload) {
  try {
    const file = gcAttemptPath();
    await mkdir(dirname(file), { recursive: true });
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`;
    const { appendFile, readFile: read, stat, writeFile: write } = await import("node:fs/promises");
    await appendFile(file, line, "utf8");
    const info = await stat(file).catch(() => null);
    if (info !== null && info.size > 32 * 1024) {
      const text = await read(file, "utf8").catch(() => "");
      const tail = text.trimEnd().split("\n").slice(-20).join("\n");
      await write(file, `${tail}\n`, "utf8");
    }
  } catch {
    /* diagnostics must never throw */
  }
}

/** The most recent attempts (newest last), for the CLI and gate audit. */
export async function readGcAttempts(limit = 20) {
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(gcAttemptPath(), "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Append-only log of boundary-prune attempts (JSONL). Same purpose as the
 *  compaction attempts: L1 armed-but-never-firing must be distinguishable from
 *  "no boundary ever happened". Every boundary the listener sees is recorded —
 *  including ones the repayment/adaptive gate holds — with the plane it ran on
 *  (host vs agent-preset realm), the pruned count and the chars removed. */
export function pruneAttemptPath() {
  return join(engramHomeDir(), "engram", "boundary-attempts.jsonl");
}

/** @param {{plane?: string, boundary?: any, pruned?: number, charsRemoved?: number, [key: string]: any}} payload */
export async function recordPruneAttempt(payload) {
  try {
    const file = pruneAttemptPath();
    await mkdir(dirname(file), { recursive: true });
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`;
    const { appendFile, readFile: read, stat, writeFile: write } = await import("node:fs/promises");
    await appendFile(file, line, "utf8");
    const info = await stat(file).catch(() => null);
    if (info !== null && info.size > 32 * 1024) {
      const text = await read(file, "utf8").catch(() => "");
      const tail = text.trimEnd().split("\n").slice(-20).join("\n");
      await write(file, `${tail}\n`, "utf8");
    }
  } catch {
    /* diagnostics must never throw */
  }
}

/** The most recent prune attempts (oldest first), for support and the CLI. */
export async function readPruneAttempts(limit = 50) {
  try {
    const text = await readFile(pruneAttemptPath(), "utf8");
    const lines = text.trimEnd().split("\n").filter(Boolean).slice(-limit);
    return lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}
