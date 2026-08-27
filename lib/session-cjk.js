/**
 * dsh-engram: bounded CJK substring search over the workspace's own session
 * corpus.
 *
 * WHY: the cross-session FTS fallback (`ctx.sessionQuery`) is tokenizer-blind
 * to Chinese. The harness's session-query SQLite builds its FTS5 index with
 * `tokenize='unicode61'` (packages/session-query/session-query-sqlite), which
 * keeps a contiguous CJK run as ONE token — a mid-run substring like 「中间表示」
 * never matches a session containing 「…的中间表示生成」 (verified against the
 * harness source and empirically). The host search API additionally
 * double-quotes every query (`quoteFtsData`), so FTS5 prefix/OR tricks like
 * `编译*` are unavailable through it either.
 *
 * This module is the in-constraint fix: pure mechanical, zero LLM, bounded
 * (newest N session files, LRU text cache, contiguous substring match), and
 * consulted ONLY for CJK queries after the official FTS has returned zero.
 * Same privacy scope as the FTS fallback — a single workspace === one cwd
 * bucket under `~/.dsh/sessions`, so we never look outside the caller's
 * workspace. Deterministic ordering: match count desc, then mtime desc.
 */

import fs from "node:fs";
import path from "node:path";

import { decodeZstd, sessionsRoot } from "./usage.js";

/** CJK ideographs (incl. Ext-A and compatibility ideographs). */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** Newest session files scanned per query (keeps the hot path bounded). */
const MAX_FILES = 4;
/** Max decompressed files kept in the LRU cache. */
const MAX_CACHE_FILES = 6;
/** Max cached decompressed bytes (~24 MB). */
const MAX_CACHE_BYTES = 24 * 1024 * 1024;
/** Snippet length around the first match. */
const SNIPPET = 160;

/** Does the query contain CJK ideographs? */
export function hasCJK(text) {
  return CJK_RE.test(String(text));
}

/**
 * Map a session cwd to its bucket directory name under `~/.dsh/sessions`
 * (`--` + workspace-key with separators flattened + `--`), mirroring the
 * workspaceKey() normalization (win32 lowercasing included).
 */
export function bucketFromCwd(cwd) {
  let norm = path.resolve(String(cwd)).replace(/[\\/]+$/, "");
  if (process.platform === "win32") norm = norm.toLowerCase();
  return `--${norm.replace(/^\/*/, "").replace(/[\\/]/g, "-")}--`;
}

// LRU-ish text cache keyed by file path; re-set moves the entry last.
const textCache = new Map(); // file -> { mtimeMs, size, text }
let cacheBytes = 0;

function decodedText(file, st) {
  const hit = textCache.get(file);
  if (hit !== void 0 && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.text;
  const text = decodeZstd(file);
  while (textCache.size >= MAX_CACHE_FILES || cacheBytes + text.length > MAX_CACHE_BYTES) {
    const oldest = textCache.keys().next().value;
    if (oldest === void 0) break;
    const evicted = textCache.get(oldest);
    textCache.delete(oldest);
    cacheBytes -= evicted.text.length;
  }
  textCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, text });
  cacheBytes += text.length;
  return text;
}

/** Count contiguous occurrences of `needle` in `text` (ASCII case-folded). */
export function countMatches(text, needle) {
  let t = String(text);
  let n = String(needle);
  if (t.length === 0 || n.length === 0) return 0;
  // Case-folding only matters for the non-CJK part of a mixed query.
  if (/[a-zA-Z]/.test(n)) {
    t = t.toLowerCase();
    n = n.toLowerCase();
  }
  let count = 0;
  let idx = 0;
  while ((idx = t.indexOf(n, idx)) !== -1) {
    count += 1;
    idx += n.length;
  }
  return count;
}

function snippetAround(text, needle) {
  const t = String(text);
  const n = String(needle);
  let hay = t;
  let at = hay.indexOf(n);
  if (at === -1 && /[a-zA-Z]/.test(n)) {
    hay = t.toLowerCase();
    at = hay.toLowerCase().indexOf(n.toLowerCase());
  }
  const start = Math.max(0, at - 60);
  const end = Math.min(t.length, at + n.length + 100);
  const raw = t.slice(start, end).replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
  const prefix = start > 0 ? "…" : "";
  const suffix = end < t.length ? "…" : "";
  return prefix + raw.slice(0, SNIPPET) + suffix;
}

/**
 * Bounded CJK substring search over the workspace's own recent sessions.
 * @returns [{ sessionId, snippet, hits }] ordered by hits desc, then recency.
 *   Empty when the query has no CJK or no session file matched.
 */
export function searchSessionsCJK({
  cwd,
  query,
  limit = 3,
  maxFiles = MAX_FILES,
  root = sessionsRoot(),
} = {}) {
  const q = String(query ?? "").trim();
  if (q.length === 0 || !hasCJK(q)) return [];
  const bucketDir = path.join(root, bucketFromCwd(cwd));
  let sids = [];
  try {
    sids = fs.readdirSync(bucketDir);
  } catch {
    return [];
  }
  const files = [];
  for (const sid of sids) {
    const file = path.join(bucketDir, sid, "session.jsonl.zstd");
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    files.push({ file, sid, mtimeMs: st.mtimeMs, size: st.size });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const matches = [];
  for (const f of files.slice(0, maxFiles)) {
    const text = decodedText(f.file, f);
    const hits = countMatches(text, q);
    if (hits > 0) {
      matches.push({ sessionId: f.sid, snippet: snippetAround(text, q), hits, mtimeMs: f.mtimeMs });
    }
  }
  matches.sort((a, b) => b.hits - a.hits || b.mtimeMs - a.mtimeMs);
  return matches.slice(0, limit).map(({ sessionId, snippet, hits }) => ({ sessionId, snippet, hits }));
}
