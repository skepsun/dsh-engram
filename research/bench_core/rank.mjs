/**
 * Shared lexical kernel for the engram self-benchmarks.
 *
 * The lexical core mirrors lib/util.js bm25Rank EXACTLY (same tokenizer,
 * same substring tf counting, same idf/length over whitespace terms) so all
 * retriever variants share one kernel and any difference is attributable to
 * the boost layers only:
 *   plain    — lexical BM25, no boosts
 *   recency  — lexical * (1 + 0.5*exp(-ageDays/14))          [updatedAt ?? createdAt]
 *   full     — + tag boost(+2/+1) + phrase(+3) + recency + evidenceBoost
 *
 * stdin:  {"variant":"plain|recency|full","now":ms,"limit":N,
 *          "queries":[{"cid":"x","q":"...","docs":[{id,text,tags,updatedAt,hits}]}]}
 * stdout: {"cid":"x","ids":[...]} per query, same order as input.
 */
import { tokenize } from "../../lib/util.js";

const DAY = 86400000;
export const evidenceBoost = (hits) => 1 + 0.1 * Math.min(Math.max(0, hits || 0), 5);

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

function fullScore(row, trimmed, now, tokens) {
  let s = row.score;
  const { tags, text, record } = row;
  for (const token of tokens) {
    if (tags.includes(token)) s += 2;
    else if (tags.some((t) => t.includes(token) || token.includes(t))) s += 1;
  }
  if (/\s/.test(trimmed) && trimmed.length > 1 && text.includes(trimmed)) s += 3;
  const age = Math.max(0, (now - (record.updatedAt ?? record.createdAt ?? 0))) / DAY;
  s *= 1 + 0.5 * Math.exp(-age / 14);
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
      if (variant === "recency" || variant === "full") {
        const age = Math.max(0, (now - (row.record.updatedAt ?? row.record.createdAt ?? 0))) / DAY;
        s *= 1 + 0.5 * Math.exp(-age / 14);
      }
      if (variant === "full") s = fullScore(row, trimmed, now, tokens) ;
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
