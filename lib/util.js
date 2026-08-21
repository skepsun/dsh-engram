/**
 * dsh-engram: tiny shared utilities. Zero dependencies.
 */

import { createHash, randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { evidenceBoost } from "./rerank.js";

/** Random id for memories / tasks / links. */
export function uuid() {
  return randomUUID();
}

export const now = () => Date.now();

/**
 * Deterministic entity-node id from a name: `ent_<slug>` (lowercase, dashes),
 * falling back to a short random id when the name slugs to nothing. esr_node
 * uses it so re-calling with the same name updates the same node and esr_link
 * can target it without a prior id lookup.
 */
export function slugId(name) {
  const slug = String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : shortId(uuid());
}

/** First 8 id chars as a short stable index marker (`#ab12cd34`). */
export function shortId(id) {
  const bare = String(id).replace(/[^a-z0-9]/gi, "");
  return (bare.length >= 8 ? bare.slice(0, 8) : String(id).slice(0, 8)) || "?";
}

/** Truncate by Unicode code points (CJK-safe). */
export function truncate(text, max) {
  const chars = [...String(text)];
  return chars.length <= max ? text : `${chars.slice(0, max).join("")}…`;
}

/** `MM-DD` from epoch millis — saves 3 chars per line vs full ISO. */
export function fmtDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Short content hash for exact-duplicate detection. */
export function hashText(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
}

/** Normalized workspace key: absolute, trailing separator removed, win32 case-folded. */
export function workspaceKey(cwd) {
  let key = resolve(cwd);
  if (process.platform === "win32") key = key.toLowerCase();
  return key.replace(/[\\/]+$/, "") || key;
}

/** Short human label for an index header. */
export function label(cwd) {
  return basename(cwd) || cwd;
}

/** Escape `<` the way DSH system sections do (XML-ish sanitization). */
export function escapeLt(text) {
  return String(text).replaceAll("<", "\\u003c");
}

/**
 * CJK-aware tokenization: ASCII words plus CJK runs with overlapping bigrams.
 * Deterministic, no model — the same vocabulary used for recall scoring and
 * auto-capture dedup.
 */
export function tokenize(input) {
  const tokens = new Set();
  for (const word of String(input).toLowerCase().split(/\s+/)) {
    if (word.length === 0) continue;
    const runs = word.match(/[\u3400-\u9fff]+|[^\u3400-\u9fff]+/g) ?? [];
    for (const run of runs) {
      if (/^[\u3400-\u9fff]+$/.test(run)) {
        if (run.length >= 2) {
          for (let i = 0; i < run.length - 1; i += 1) tokens.add(run.slice(i, i + 2));
        }
      } else {
        for (const token of run.split(/[^a-z0-9]+/)) {
          if (token.length > 0) tokens.add(token);
        }
      }
    }
  }
  return [...tokens];
}

/**
 * Deterministic 3-tier scoring over one record's text + tags:
 * exact tag match (3) > case-insensitive text substring (2) > fuzzy tag overlap (1),
 * plus a phrase boost (4) for multi-word queries. Mirrors the proven
 * dsh-native-memory scoring model.
 */
export function scoreRecord(record, tokens, fullQuery, phraseBoost) {
  const text = String(record.text).toLowerCase();
  const tags = (record.tags ?? []).map((t) => String(t).toLowerCase());
  let score = 0;
  for (const token of tokens) {
    if (tags.includes(token)) score += 3;
    else if (tags.some((tag) => tag.includes(token) || token.includes(tag))) score += 1;
    if (text.includes(token)) score += 2;
  }
  if (phraseBoost && fullQuery.length > 1 && text.includes(fullQuery)) score += 4;
  return score;
}

/** Newest first, then id ascending (deterministic). */
export function byRecency(left, right) {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || String(left.id).localeCompare(String(right.id));
}

/**
 * BM25-style ranking over an in-memory record corpus. Deterministic, zero
 * dependencies — we deliberately do NOT build a SQLite/FTS index here: DSH
 * already owns the cross-session full-text index (`ctx.sessionQuery`), which
 * engram_recall's `search_sessions` piggybacks on; this ranks only the small
 * in-domain memory pool, where an in-process IDF pass is cheap and keeps the
 * store self-contained.
 *
 * Weights: BM25 (k1=1.5, b=0.75) over text+tags, plus the proven small boosts —
 * exact tag match, fuzzy tag overlap, and a phrase boost for multi-word queries,
 * and a gentle multiplicative recency factor (half-life 14 days, max +50%):
 * freshness lifts near-ties and stale-but-still-matching results, but never
 * overrides strong lexical relevance (Zep/decay-weighted recall direction).
 * `now` is injectable so the ranking stays deterministic in tests.
 * Returns up to `limit` records with score > 0, best first, recency as tiebreak.
 */
export function bm25Rank(records, query, limit = 20, now = Date.now()) {
  const DAY = 86400000;
  const clamped = Math.max(0, typeof now === "number" ? now : Date.now());
  const trimAgeDays = (r) => Math.max(0, (clamped - (r.updatedAt ?? r.createdAt ?? 0)) / DAY);
  const trimmed = String(query ?? "").trim().toLowerCase();
  const bounded = Math.max(1, Math.min(50, Math.trunc(limit) || 20));
  if (trimmed.length === 0) return records.slice(0, bounded);
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return records.slice(0, bounded);

  const N = Math.max(1, records.length);
  const df = new Map();
  const lens = new Array(records.length);
  const blobs = records.map((r, i) => {
    const text = String(r.text ?? "").toLowerCase();
    const tags = (r.tags ?? []).map((t) => String(t).toLowerCase());
    const blob = `${text} ${tags.join(" ")}`;
    const terms = blob.split(/\s+/).filter(Boolean);
    lens[i] = Math.max(1, terms.length);
    for (const term of new Set(terms)) df.set(term, (df.get(term) ?? 0) + 1);
    return { blob, tags, text };
  });
  const avgdl = lens.reduce((a, b) => a + b, 0) / N;
  const K1 = 1.5;
  const B = 0.75;

  const scored = records
    .map((r, i) => {
      const { blob, tags, text } = blobs[i];
      const len = lens[i];
      let score = 0;
      for (const token of tokens) {
        const dfT = df.get(token) ?? 0;
        const idf = Math.log(1 + (N - dfT + 0.5) / (dfT + 0.5));
        let count = 0;
        let from = 0;
        for (;;) {
          const at = blob.indexOf(token, from);
          if (at === -1) break;
          count += 1;
          from = at + token.length;
        }
        const tf = count * (K1 + 1) / (count + K1 * (1 - B + (B * len) / avgdl));
        score += idf * tf;
        if (tags.includes(token)) score += 2;
        else if (tags.some((tag) => tag.includes(token) || token.includes(tag))) score += 1;
      }
      if (/\s/.test(trimmed) && trimmed.length > 1 && text.includes(trimmed)) score += 3;
      // Gentle time-awareness: 1 + 0.5·exp(-ageDays/14). New memories get up to
      // +50%; after 14 days still +18%, after 60 days ~+1%. Never zeroes a hit.
      score *= 1 + 0.5 * Math.exp(-trimAgeDays(r) / 14);
      // Evidence strength (cumulative recall hits = proof count analogue, fed
      // by the failure-revival path): conservative ±5% at alpha 0.1, saturating
      // after 5 hits so no single memory can drown the lexical signal.
      score *= evidenceBoost(r.hits ?? 0);
      return { r, score };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || byRecency(a.r, b.r));
  return scored.slice(0, bounded).map((e) => e.r);
}

/**
 * Session-diversified dedup (agentmemory 候选①): keep the input order
 * (stable) but cap how many records the same sessionId may contribute.
 *
 * Rationale (AML coding board + agentmemory deep-dive): "few and precise"
 * evidence beats letting one session flood the recall list — the platform
 * answerer consumes a bounded evidence set, and single-session domination
 * squeezes out cross-session relevance. Deterministic: pure function, no
 * randomness, no reading beyond `records`.
 *
 * @param {Array<{sessionId?: string|null, id?: string}>} records ranked list, best first
 * @param {number} [maxPerSession=3] max records kept per sessionId (>=1)
 * @returns {Array} subset of records, order preserved
 */
export function dedupeBySession(records, maxPerSession = 3) {
  const cap = Math.max(1, Math.trunc(maxPerSession) || 3);
  const seen = new Map();
  const out = [];
  for (const record of records) {
    const key = record?.sessionId ?? record?.id ?? `__noid:${out.length}`;
    const n = seen.get(key) ?? 0;
    if (n >= cap) continue;
    seen.set(key, n + 1);
    out.push(record);
  }
  return out;
}
