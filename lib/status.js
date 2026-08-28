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
