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

/**
 * Atomically write the status snapshot (tmp + rename). Never throws for the
 * caller's convenience; a failure is logged by the caller if it cares.
 * @param {object} payload
 * @returns {Promise<void>}
 */
export async function writeContextGcStatus(payload) {
  const path = contextGcStatusPath();
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
