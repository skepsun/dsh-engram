#!/usr/bin/env python3
"""PersonaMem 32k retrieval-only self-benchmark.

Compares 4 retrievers on top-K recall of the gold evidence message:
  1. bm25-raw      — standard BM25 (just-a-BM25 analogue)
  2. engram        — REAL dsh-engram lib/util.js bm25Rank (BM25 + recency)
  3. sqlite-fts    — SQLite FTS5 bm25() (SQLite-FTS-Baseline analogue)
  4. last-k        — hard recent-window baseline (last 64 messages)

Metric: Recall@K (K = 1,3,5) — was the gold message (end_index_in_shared_context)
inside the retrieved top-K? Broken out by question type and by reference
distance (near <=3 blocks vs far >=4 blocks).
"""
from __future__ import annotations
import json, os
from collections import defaultdict
from common import load, gold_index, dist_blocks
from retrievers import bm25_rank, build_fts, fts_rank, lastk_rank, engram_rank

HERE = os.path.dirname(os.path.abspath(__file__))

def main():
    ctxs, rows = load()
    k_s = [1, 3, 5]
    results = defaultdict(lambda: {"hit": {1: 0, 3: 0, 5: 0}, "n": 0, "qtypes": defaultdict(lambda: {"hit": {1:0,3:0,5:0}, "n": 0}), "dist": {"near": {"hit": {1:0,3:0,5:0}, "n": 0}, "far": {"hit": {1:0,3:0,5:0}, "n": 0}}})
    backends = ["bm25-raw", "engram", "sqlite-fts", "last-k"]

    # per-cid lazy index caches (never share one cid's index across questions)
    cache = {"bm25-raw": {}, "engram": {}, "sqlite-fts": {}, "last-k": None}

    # per question
    for row in rows:
        cid = row["shared_context_id"]
        msgs = ctxs[cid]
        N = len(msgs)
        gi = gold_index(row)
        if gi >= N:
            continue
        gold_id = str(gi)
        q = row["user_question_or_message"]
        qtype = row["question_type"]
        db = dist_blocks(row)
        bucket = "near" if db <= 3 else "far"
        docs = [f"{m.get('role','')}: {m.get('content','')}" for m in msgs]

        # query each backend
        for backend in backends:
            if backend == "bm25-raw":
                order, _ = bm25_rank(docs, q, limit=5)
                ids = [str(i) for i in order[:5]]
            elif backend == "engram":
                recs = [{"id": str(i), "text": docs[i]} for i in range(N)]
                out = engram_rank(recs, q, 5)
                ids = out["ids"][:5]
            elif backend == "sqlite-fts":
                if cid not in cache["sqlite-fts"]:
                    cache["sqlite-fts"][cid] = build_fts(docs)
                order, _ = fts_rank(cache["sqlite-fts"][cid], q, limit=5)
                ids = [str(i) for i in order[:5]]
            else:  # last-k
                order, _ = lastk_rank(docs, q, k=64, limit=5)
                ids = [str(i) for i in order[:5]]

            res = results[backend]
            res["n"] += 1
            pos = ids.index(gold_id) if gold_id in ids else -1
            for k in k_s:
                if pos != -1 and pos < k:
                    res["hit"][k] += 1
                    res["qtypes"][qtype]["hit"][k] += 1
                    res["dist"][bucket]["hit"][k] += 1
            res["qtypes"][qtype]["n"] += 1
            res["dist"][bucket]["n"] += 1

    # report
    lines = []
    lines.append("# PersonaMem 32k — retrieval-only Recall@K")
    lines.append("")
    lines.append(f"- questions: {len(rows)} · contexts: {len(ctxs)} · unit: message-level memory segment")
    lines.append("- retrievers: bm25-raw (standard BM25) · engram (dsh-engram lib/util.js bm25Rank, BM25+recency) · sqlite-fts (FTS5 bm25) · last-k (recent 64 window)")
    lines.append("- gold evidence = message at `end_index_in_shared_context`; Recall@K = gold in top-K")
    lines.append("")
    lines.append("| retriever | R@1 | R@3 | R@5 |")
    lines.append("|---|---|---|---|")
    for b in backends:
        r = results[b]
        lines.append(f"| {b} | {100*r['hit'][1]/r['n']:.1f}% | {100*r['hit'][3]/r['n']:.1f}% | {100*r['hit'][5]/r['n']:.1f}% |")
    lines.append("")
    lines.append("## By question type (R@5)")
    lines.append("")
    qts = sorted({qt for b in backends for qt in results[b]["qtypes"].keys()})
    header = "| type | " + " | ".join(f"{b}" for b in backends) + " |"
    lines.append(header)
    lines.append("|" + "---|" * (len(backends) + 1))
    for qt in qts:
        cell = []
        for b in backends:
            r = results[b]["qtypes"][qt]
            cell.append(f"{100*r['hit'][5]/max(1,r['n']):.0f}% (n={r['n']})")
        lines.append(f"| {qt} | " + " | ".join(cell) + " |")
    lines.append("")
    lines.append("## By reference distance (R@3)")
    lines.append("")
    lines.append("| bucket | " + " | ".join(b for b in backends) + " |")
    lines.append("|" + "---|" * (len(backends) + 1))
    for bucket in ("near", "far"):
        cell = []
        for b in backends:
            r = results[b]["dist"][bucket]
            cell.append(f"{100*r['hit'][3]/max(1,r['n']):.0f}% (n={r['n']})")
        lines.append(f"| {bucket} | " + " | ".join(cell) + " |")
    report = "\n".join(lines)
    print(report)
    with open(os.path.join(HERE, "REPORT.md"), "w", encoding="utf-8") as f:
        f.write(report + "\n")

if __name__ == "__main__":
    main()
