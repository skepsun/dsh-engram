#!/usr/bin/env python3
"""PersonaMem 32k retrieval-only self-benchmark — kernel-aligned edition.

All lexical retrievers now share ONE kernel (research/bench_core/rank.mjs,
which mirrors lib/util.js bm25Rank exactly — verified byte-identical to
bm25Rank on random+real inputs):
   plain      — lexical BM25, no boosts
   recency    — + recency factor   (message index → timestamps, 1 block ≈ 1 day)
   full       — = lib/util.js bm25Rank (tag/phrase/recency/evidence) [REAL]
   sqlite-fts — SQLite FTS5 bm25() (its own kernel, FTS baseline analogue)
   last-k     — recent-64-window baseline

Metric: Recall@K on gold message (end_index_in_shared_context).
"""
from __future__ import annotations
import json, os, time
from collections import defaultdict
from subprocess import run
from common import load, gold_index, dist_blocks
from retrievers import build_fts, fts_rank, lastk_rank

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.join(os.path.dirname(HERE), "bench_core", "rank.mjs")
MS_DAY = 86400000
MSGS_PER_BLOCK = 20          # ~1 block of conversation per day
SPACING_MS = MS_DAY / MSGS_PER_BLOCK

def node_rank_variant(variant, groups, now):
    """groups: list of {cid, q, docs}; returns {cid: {q: [ids]}}."""
    out = []
    for g in groups:
        out.append({"cid": g["cid"], "q": g["q"], "docs": g["docs"]})
    payload = json.dumps({"variant": variant, "now": now, "limit": 50, "queries": out})
    p = run(["node", CORE], input=payload, capture_output=True, text=True, timeout=300)
    if p.returncode != 0:
        raise RuntimeError(f"rank.mjs {variant} failed: {p.stderr[-600:]}")
    results = json.loads(p.stdout)["results"]  # same order as `groups`
    return { (g["cid"], g["q"]): r["ids"] for g, r in zip(groups, results) }

def main():
    ctxs, rows = load()
    backends = ["bm25-raw", "bm25-recency", "engram-full", "sqlite-fts", "last-k"]
    stats = {b: {"hit": {1: 0, 3: 0, 5: 0}, "n": 0,
                 "qtypes": defaultdict(lambda: {"hit": {1:0,3:0,5:0}, "n": 0}),
                 "dist": {"near": {"hit": {1:0,3:0,5:0}, "n": 0},
                          "far": {"hit": {1:0,3:0,5:0}, "n": 0}}}
             for b in backends}

    # --- prepare per-cid corpora with mapped timestamps ---
    corpora = {}
    group_queries = []
    now = max((max((m.get("updatedAt",0) or m.get("createdAt",0)) for m in msgs) for msgs in ctxs.values()))
    for cid, msgs in ctxs.items():
        N = len(msgs)
        docs = []
        for i, m in enumerate(msgs):
            ts = now - (N - 1 - i) * SPACING_MS      # oldest → newest
            docs.append({"id": str(i), "text": f"{m.get('role','')}: {m.get('content','')}",
                         "tags": [], "updatedAt": ts, "hits": 0})
        corpora[cid] = docs
        fts = build_fts([d["text"] for d in docs])
        corpora[cid + "_fts"] = fts

    # group questions by cid for batched node calls
    for row in rows:
        cid = row["shared_context_id"]
        group_queries.append({"cid": cid, "q": row["user_question_or_message"], "row": row})

    # one batched node call per variant
    variant_res = {}
    for v in ("plain", "recency", "full"):
        groups = [{"cid": g["cid"], "q": g["q"], "docs": corpora[g["cid"]]} for g in group_queries]
        variant_res[v] = node_rank_variant(v, groups, now)

    # --- evaluate ---
    for gi, g in enumerate(group_queries):
        cid, q = g["cid"], g["q"]
        row = g["row"]
        msgs = ctxs[cid]
        N = len(msgs)
        gidx = gold_index(row)
        if gidx >= N:
            continue
        gold_id = str(gidx)
        qtype = row["question_type"]
        bucket = "near" if dist_blocks(row) <= 3 else "far"
        ids = {
            "bm25-raw": variant_res["plain"][(cid, q)],
            "bm25-recency": variant_res["recency"][(cid, q)],
            "engram-full": variant_res["full"][(cid, q)],
            "sqlite-fts": [str(i) for i in fts_rank(corpora[cid + "_fts"], q, limit=5)[0][:5]],
            "last-k": [str(i) for i in lastk_rank(
                [{"updatedAt": corpora[cid][i]["updatedAt"], "id": str(i)} for i in range(N)],
                "", k=64, limit=5)[0]],
        }
        for b in backends:
            lst = ids[b]
            pos = lst.index(gold_id) if gold_id in lst else -1
            st = stats[b]; st["n"] += 1
            for k in (1, 3, 5):
                if pos != -1 and pos < k:
                    st["hit"][k] += 1
                    st["qtypes"][qtype]["hit"][k] += 1
                    st["dist"][bucket]["hit"][k] += 1
            st["qtypes"][qtype]["n"] += 1
            st["dist"][bucket]["n"] += 1

    # --- report ---
    L = []
    L.append("# PersonaMem 32k — retrieval-only Recall@K（内核对齐版）")
    L.append("")
    L.append(f"- questions: {len(rows)} · contexts: {len(ctxs)} · unit: message-level segment")
    L.append("- 四个词法检索器共用同一内核 rank.mjs（复刻 lib/util.js bm25Rank，已验证与真身逐位一致）：")
    L.append("  `bm25-raw`=纯 BM25 · `bm25-recency`=+recency 因子 · `engram-full`=lib/util.js 真身（tag/短语/recency/evidence）")
    L.append("- PersonaMem 无时间戳：按消息序号映射（1 块≈20 条≈1 天），使 recency 真实生效；`sqlite-fts` 为 FTS5 原生内核；`last-k`=最近 64 条")
    L.append("")
    L.append("| retriever | R@1 | R@3 | R@5 |")
    L.append("|---|---|---|---|")
    for b in backends:
        s = stats[b]
        L.append(f"| {b} | {100*s['hit'][1]/max(1,s['n']):.1f}% | {100*s['hit'][3]/max(1,s['n']):.1f}% | {100*s['hit'][5]/max(1,s['n']):.1f}% |")
    L.append("")
    L.append("## By reference distance (R@3)")
    L.append("| bucket | " + " | ".join(backends) + " |")
    L.append("|" + "---|" * (len(backends) + 1))
    for bucket in ("near", "far"):
        cell = []
        for b in backends:
            r = stats[b]["dist"][bucket]
            cell.append(f"{100*r['hit'][3]/max(1,r['n']):.0f}% (n={r['n']})")
        L.append(f"| {bucket} | " + " | ".join(cell) + " |")
    L.append("")
    L.append("## By question type (R@5)")
    qts = sorted({qt for b in backends for qt in stats[b]["qtypes"]})
    L.append("| type | " + " | ".join(backends) + " |")
    L.append("|" + "---|" * (len(backends) + 1))
    for qt in qts:
        cell = []
        for b in backends:
            r = stats[b]["qtypes"][qt]
            cell.append(f"{100*r['hit'][5]/max(1,r['n']):.0f}%")
        L.append(f"| {qt} | " + " | ".join(cell) + " |")
    L.append("")
    L.append("## 关于此前『engram 比基线低』的归因")
    L.append("")
    L.append("旧版对比不可信：python 复刻使用了**词边界计数 + 不同 tokenize**（保留撇号、CJK 不切 bigram），")
    L.append("与 lib/util.js 的**子串计数 + CJK bigram 分词**本质上不是同一词法内核；且旧桥接未传时间戳，")
    L.append("recency/tag/phrase 全部失效。本次已统一内核并验证 `full` 与 `bm25Rank` 逐位一致。")
    L.append("")
    L.append("## Gold 位置与局限（同前）")
    L.append("")
    L.append("- PersonaMem 全部 589 个 gold 位于会话尾 1/3 → `last-k` 高 Recall 是数据构造特性，非检索质量")
    L.append("- retrieval-only 分数不可与 AML 官方 0-100 对比（官方 gpt-4o-mini Answer/Eval 全流程）；本表只作检索器相对对比")
    L.append("- 时间戳映射（1 块≈1 天）是建模选择：PersonaMem 本身无真实时序")
    report = "\n".join(L)
    print(report)
    with open(os.path.join(HERE, "REPORT.md"), "w", encoding="utf-8") as f:
        f.write(report + "\n")

if __name__ == "__main__":
    main()
