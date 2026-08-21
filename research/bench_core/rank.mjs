/**
 * Shared lexical kernel for the engram self-benchmarks.
 *
 * The lexical core mirrors lib/util.js bm25Rank EXACTLY (same tokenizer,
 * same substring tf counting, same idf/length over whitespace terms) so all
 * retriever variants share one kernel and any difference is attributable to
 * the boost layers only:
 *   plain    — lexical BM25, no boosts
 *   recency  — lexical * (1 + 0.5*exp(-ageDays/14))          [updatedAt ?? createdAt]
 *   recency-gated — recency ONLY when the query carries temporal intent (now/latest/current/最近…)
 *   full     — + tag boost(+2/+1) + phrase(+3) + recency + evidenceBoost
 *   full-gated — full with temporal-intent-gated recency
 *
 * stdin:  {"variant":"plain|recency|full","now":ms,"limit":N,
 *          "queries":[{"cid":"x","q":"...","docs":[{id,text,tags,updatedAt,hits}]}]}
 * stdout: {"cid":"x","ids":[...]} per query, same order as input.
 */
import { tokenize } from "../../lib/util.js";

const DAY = 86400000;
export const evidenceBoost = (hits) => 1 + 0.1 * Math.min(Math.max(0, hits || 0), 5);

// Temporal-intent markers (mirrors FlowGrid（#8）has_temporal_intent: EN + CJK).
const TEMP_CN = ["现在","目前","当前","如今","最近","最新","眼下","这个月","这周","今天","近期","改成","换成","还是","已经"];
const TEMP_EN = ["now","current","currently","latest","recent","recently","today","these days","nowadays","at present","up to date","still"];
export function hasTemporalIntent(query) {
  const q = String(query ?? "");
  const l = q.toLowerCase();
  return TEMP_CN.some((m) => q.includes(m)) || TEMP_EN.some((m) => l.includes(m));
}

function lexicalCore(records, query) {
  const trimmed = String(query ?? "").trim().toLowerCase();
  const tokens = tokenize(trimmed);
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
  const K1 = 1.5, B = 0.75;
  return blobs.map(({ blob, tags, text }, i) => {
    const len = lens[i];
    let score = 0;
    for (const token of tokens) {
      const dfT = df.get(token) ?? 0;
      const idf = Math.log(1 + (N - dfT + 0.5) / (dfT + 0.5));
      let count = 0, from = 0;
      for (;;) {
        const at = blob.indexOf(token, from);
        if (at === -1) break;
        count += 1;
        from = at + token.length;
      }
      const tf = (count * (K1 + 1)) / (count + K1 * (1 - B + (B * len) / avgdl));
      score += idf * tf;
    }
    return { record: records[i], blob, tags, text, len, score };
  });
}

function fullScore(row, trimmed, now, tokens, gated = false, query = "") {
  let s = row.score;
  const { tags, text, record } = row;
  for (const token of tokens) {
    if (tags.includes(token)) s += 2;
    else if (tags.some((t) => t.includes(token) || token.includes(t))) s += 1;
  }
  if (/\s/.test(trimmed) && trimmed.length > 1 && text.includes(trimmed)) s += 3;
  if (!gated || hasTemporalIntent(query)) {
    const age = Math.max(0, (now - (record.updatedAt ?? record.createdAt ?? 0))) / DAY;
    s *= 1 + 0.5 * Math.exp(-age / 14);
  }
  s *= evidenceBoost(record.hits ?? 0);
  return s;
}

function rankVariant(records, query, variant, now) {
  if (!String(query ?? "").trim()) return records.map((r, i) => r.id ?? String(i));
  const core = lexicalCore(records, query);
  const trimmed = String(query).trim().toLowerCase();
  const tokens = tokenize(trimmed);
  const ranked = core
    .map((row) => {
      let s = row.score;
      const recencyActive =
        variant === "recency" || variant === "recency-gated" ||
        variant === "full" || variant === "full-gated";
      const gated = variant === "recency-gated" || variant === "full-gated";
      if (recencyActive && (!gated || hasTemporalIntent(query))) {
        const age = Math.max(0, (now - (row.record.updatedAt ?? row.record.createdAt ?? 0))) / DAY;
        s *= 1 + 0.5 * Math.exp(-age / 14);
      }
      if (variant === "full" || variant === "full-gated") s = fullScore(row, trimmed, now, tokens, gated, query) ;
      return { s, id: row.record.id ?? row.record.i };
    })
    .filter((x) => x.s > 0)   // mirror bm25Rank: zero-scored records are dropped
    .sort((a, b) => b.s - a.s);
  return ranked.map((x) => String(x.id));
}

const input = JSON.parse(await new Promise((res, rej) => {
  let buf = "";
  process.stdin.on("data", (d) => (buf += d));
  process.stdin.on("end", () => res(buf));
  process.stdin.on("error", rej);
}));
const now = input.now ?? Date.now();
const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 10) || 20)); // mirror bm25Rank bounded
const variant = input.variant ?? "plain";
const out = { results: [] };
for (const q of input.queries ?? []) {
  const ids = rankVariant(q.docs ?? [], q.q ?? "", variant, now);
  out.results.push({ cid: q.cid, ids: ids.slice(0, limit) });
}
process.stdout.write(JSON.stringify(out));
