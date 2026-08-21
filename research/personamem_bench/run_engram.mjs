/**
 * dsh-engram retrieval bridge for the PersonaMem self-benchmark.
 * Calls the REAL lib/util.js bm25Rank (BM25 k1=1.5/b=0.75 + tag/text/phrase
 * boosts + recency 1+0.5*exp(-age/14)) on message-level memory records.
 * stdin:  {"records":[{"id":"...","text":"..."}], "query":"...", "limit":N, "now":ms}
 * stdout: {"ids":["...",...]}   -- ranked ids, best first, capped by limit.
 */
import { bm25Rank } from "../../lib/util.js";

const read = () =>
  new Promise((res, rej) => {
    let buf = "";
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => res(buf));
    process.stdin.on("error", rej);
  });

const input = JSON.parse(await read());
const records = (input.records ?? []).map((r, i) => ({
  id: String(r.id ?? i),
  text: String(r.text ?? ""),
  tags: r.tags ?? [],
}));
const now = input.now ?? undefined;
const ranked = bm25Rank(records, String(input.query ?? ""), input.limit ?? 10, now);
const ids = ranked.map((r) => r.id);
process.stdout.write(JSON.stringify({ ids }));
