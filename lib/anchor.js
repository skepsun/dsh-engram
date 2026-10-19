/**
 * dsh-engram revalidatable file anchors (PROPOSAL-evolution §4 v0.7-C).
 *
 * "The past is treated as truth" is the strongest critique against memory
 * plugins: a fact written last week may describe code that changed yesterday.
 * An anchor makes staleness DETECTABLE instead of trusted:
 *
 *   { path, mtimeMs, size, hash?, at }
 *
 * - `makeFileAnchor` records the file's identity when a memory is written
 *   (sha256 for small files, mtime+size for every file — cheap default);
 * - `anchorStatus` re-stats (and re-hashes when a hash exists) and returns
 *   `valid | changed | missing`;
 * - `collectStaleAnchors` scans a bounded set of active memories so the index
 *   / entity truth can drop rows whose source moved, and the caller can tag
 *   them `stale` (never deleted — still re-fetchable via engram_detail).
 *
 * Zero LLM, fail-contained: any filesystem error reads as "missing", never
 * throws into a render path.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_MAX_HASH_BYTES = 256 * 1024;

function hashFile(file, size) {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 32);
  } catch {
    return null;
  }
}

function absolute(filePath, baseDir) {
  const raw = String(filePath ?? "").trim();
  if (raw.length === 0) return "";
  if (path.isAbsolute(raw)) return raw;
  return typeof baseDir === "string" && baseDir.length > 0 ? path.resolve(baseDir, raw) : path.resolve(raw);
}

/**
 * Build an anchor for an existing file, or null when it cannot be stat'ed.
 *
 * @param {string} filePath file path as stored on the memory
 * @param {object} [opts]
 * @param {string} [opts.baseDir] directory for relative paths (the workspace)
 * @param {number} [opts.now]
 * @param {number} [opts.maxHashBytes] hash only files up to this size
 */
export function makeFileAnchor(filePath, { baseDir = "", now = Date.now(), maxHashBytes = DEFAULT_MAX_HASH_BYTES } = {}) {
  const abs = absolute(filePath, baseDir);
  if (abs.length === 0) return null;
  try {
    const stat = statSync(abs);
    if (!stat.isFile()) return null;
    return {
      path: abs,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      hash: stat.size <= maxHashBytes ? hashFile(abs, stat.size) : null,
      at: now,
    };
  } catch {
    return null;
  }
}

/**
 * Revalidate one anchor: `valid` | `changed` | `missing` (`none` when absent).
 */
export function anchorStatus(anchor) {
  if (anchor === null || anchor === void 0 || typeof anchor.path !== "string" || anchor.path.length === 0) {
    return "none";
  }
  let stat;
  try {
    stat = statSync(anchor.path);
  } catch {
    return "missing";
  }
  if (!stat.isFile()) return "missing";
  if (stat.size !== anchor.size || stat.mtimeMs !== anchor.mtimeMs) {
    // mtime can survive content changes only in exotic cases; when a hash was
    // recorded, let it decide before declaring the file changed.
    if (typeof anchor.hash !== "string") return "changed";
    const hash = hashFile(anchor.path, stat.size);
    return hash === anchor.hash ? "valid" : "changed";
  }
  if (typeof anchor.hash === "string") {
    const hash = hashFile(anchor.path, stat.size);
    return hash === anchor.hash ? "valid" : "changed";
  }
  return "valid";
}

/** Is this memory's source still the same file it was written against? */
export function memoryIsStale(memory) {
  if (memory === null || typeof memory !== "object") return false;
  const status = anchorStatus(memory.anchor);
  return status === "changed" || status === "missing";
}

/**
 * Bounded scan of active anchored memories whose source moved/vanished.
 * Returns [{ id, status, path }] and never throws.
 */
export function collectStaleAnchors(store, workspace, { limit = 40 } = {}) {
  if (store === null || typeof store.listMemories !== "function") return [];
  const cap = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 40;
  const rows = store.listMemories(workspace, 200);
  const out = [];
  for (const memory of rows) {
    if (out.length >= cap) break;
    if (memory?.anchor === null || memory?.anchor === void 0) continue;
    if (Array.isArray(memory.tags) && memory.tags.includes("stale")) continue;
    const status = anchorStatus(memory.anchor);
    if (status === "changed" || status === "missing") {
      out.push({ id: memory.id, status, path: memory.anchor.path });
    }
  }
  return out;
}
