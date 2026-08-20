/**
 * dsh-engram: tiny shared utilities. Zero dependencies.
 */

import { createHash, randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";

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
