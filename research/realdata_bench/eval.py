#!/usr/bin/env python3
"""dsh-engram real-data self-recall benchmark.

Corpus: the ACTUAL dsh-engram memory store (~/.dsh/storages/dsh_engram.json),
96 memories with real createdAt/updatedAt/hits/entity — the "true temporal
data" (option 2). Gold = each memory with an entity, query = its own entity
name (self-recall). Measures whether the retriever ranks the gold memory
ahead of the other (often same-entity) memories of the workspace.

Retrievers (all over the same text+tags lexical surface):
  bm25-raw       standard BM25 (no boosts)
  bm25-recency   BM25 + recency factor (1+0.5*exp(-age/14))   [python port]
  engram-full    REAL lib/util.js bm25Rank (tag +2/+1, phrase +3, recency,
                 evidenceBoost)                                [node bridge]
  last-16        recent-16-window baseline

Also: a twin-interference experiment where a gold memory is given a synthetic
twin (same terms, hits=0) that a proof-rich memory (hits=3) must beat — checks
the evidenceBoost direction on real texts.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../personamem_bench"))
import math, json, re, subprocess, time, random, copy
from subprocess import run as _run

HERE = os.path.dirname(os.path.abspath(__file__))
ENG = os.environ.get("DSH_ENGINE_JSON", os.path.expanduser("~/.dsh/storages/dsh_engram.json"))
DAY = 86400000.0
random.seed(20260821)

TOK = re.compile(r"[a-zA-Z0-9']+")
def tokenize(t): return [x.lower() for x in TOK.findall(t or "")]

def load():
    d = json.load(open(ENG, encoding="utf-8"))
    rows = []
    for m in d["tables"]["memories"].values():
        rows.append({
            "id": m["id"], "text": m.get("text",""), "tags": m.get("tags") or [],
            "entity": m.get("entity"), "kind": m.get("kind",""),
            "createdAt": m.get("createdAt",0), "updatedAt": m.get("updatedAt", m.get("createdAt",0)),
            "hits": m.get("hits",0),
            "blob": f"{m.get('text','')} {' '.join(m.get('tags') or [])}",
        })
    return rows

class BM25:
    def __init__(self, tlist):
        self.tlist = tlist; self.N = len(tlist)
        self.avgdl = sum(len(t) for t in tlist)/max(1,self.N)
        self.df = {}
        for t in tlist:
            for tok in set(t): self.df[tok]=self.df.get(tok,0)+1
    def lexical(self, i, toks):
        _t=self.tlist[i]; dl=len(_t); s=0.0
        for tok in toks:
            dfT=self.df.get(tok,0)
            idf=math.log(1+(self.N-dfT+0.5)/(dfT+0.5))
            c=_t.count(tok)
            s+=idf*(c*2.4)/(c+1.5*(1-0.75+0.75*dl/self.avgdl))
        return s

def recency_factor(d, now):  # same formula as lib/util.js
    base = d["updatedAt"] or d["createdAt"] or now
    age = max(0.0, (now-base))/DAY
    return 1 + 0.5*math.exp(-age/14.0)

def evidence_factor(hits):  # same as lib/rerank.js evidenceBoost
    return 1 + 0.1*min(max(0,hits),5)

def bm25_rank(rows, query, now, recency=False, evidence=False):
    if not query.strip(): return [r["id"] for r in rows]
    bm = BM25([tokenize(r["blob"]) for r in rows])
    toks = tokenize(query)
    scored=[]
    for i,r in enumerate(rows):
        s = bm.lexical(i,toks)
        if recency: s *= recency_factor(r, now)
        if evidence: s *= evidence_factor(r.get("hits",0))
        scored.append((s,r["id"]))
    scored.sort(key=lambda x:-x[0])
    return [i for _,i in scored]

CORE_RANK = os.path.join(os.path.dirname(HERE), "bench_core", "rank.mjs")

def node_variant(variant, docs, query, now, limit=20):
    payload = json.dumps({"variant": variant, "now": now, "limit": limit,
                          "queries": [{"cid": "x", "q": query, "docs": docs}]})
    p = _run(["node", CORE_RANK], input=payload, capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        raise RuntimeError(f"rank.mjs {variant}: {p.stderr[-500:]}")
    return json.loads(p.stdout)["results"][0]["ids"]

def engram_rank(rows, query, limit=20, now=None):
    payload = json.dumps({"records":[{"id":r["id"],"text":r["text"],"tags":r["tags"],"updatedAt":r["updatedAt"],"hits":r["hits"]} for r in rows],
                          "query":query,"limit":limit,"now":now})
    p = subprocess.run(["node", os.path.join(HERE,"../personamem_bench/run_engram.mjs")], input=payload, capture_output=True, text=True, timeout=120)
    if p.returncode!=0: raise RuntimeError(p.stderr[-500:])
    return json.loads(p.stdout)["ids"]

def lastk_rank(rows, k=16):
    s = sorted(rows, key=lambda r: -(r["updatedAt"] or r["createdAt"]))
    return [r["id"] for r in s[:k]]

def recall_pos(ids, gid):
    try: return ids.index(gid)
    except ValueError: return -1

def main():
    rows = load(); now = time.time()*1000.0
    gold = [r for r in rows if r.get("entity")]
    node_docs = [{"id": r["id"], "text": r["text"], "tags": r["tags"],
                   "updatedAt": r["updatedAt"], "hits": r["hits"]} for r in rows]
    backends = {"bm25-raw": lambda q: node_variant("plain", node_docs, q, now),
                "bm25-recency": lambda q: node_variant("recency", node_docs, q, now),
                "engram-full": lambda q: node_variant("full", node_docs, q, now),
                "last-16": lambda q: lastk_rank(rows,16)}
    stats = {b:{"mrr":0.0,"r1":0,"r3":0,"r5":0,"n":0,"bykind":{}} for b in backends}
    for g in gold:
        q = (g["entity"] or "").strip()
        if not q: continue
        n = stats["bm25-raw"]["n"]+1
        for b,fn in backends.items():
            ids = fn(q)
            pos = recall_pos(ids, g["id"])
            r1 = 1 if 0<=pos<1 else 0; r3 = 1 if 0<=pos<3 else 0; r5 = 1 if 0<=pos<5 else 0
            if pos>=0: stats[b]["mrr"] += 1.0/(pos+1)
            stats[b]["r1"]+=r1; stats[b]["r3"]+=r3; stats[b]["r5"]+=r5; stats[b]["n"]=n
            bk = stats[b]["bykind"].setdefault(g["kind"],{"n":0,"r3":0})
            bk["n"]+=1; bk["r3"]+=r3

    L=[]; L.append("# dsh-engram 真实记忆 self-recall 评测"); L.append("")
    L.append(f"- 语料：真实存储 {os.path.basename(ENG)}（{len(rows)} 条记忆，真实 createdAt/updatedAt/hits/entity）")
    L.append(f"- 金标：{len(gold)} 条带 entity 的记忆；查询=自身 entity 名（self-recall），目标=把它排过同工作区其余记忆（含同 entity 记忆）")
    L.append(f"- 检索器：bm25-raw（纯 BM25）· bm25-recency（+recency 因子）· engram-full（lib/util.js 真身：tag/短语/recency/evidence）· last-16（最近窗口）")
    L.append("")
    L.append("| retriever | MRR | R@1 | R@3 | R@5 |")
    L.append("|---|---|---|---|---|")
    for b in ("bm25-raw","bm25-recency","engram-full","last-16"):
        s=stats[b]; nn=max(1,s["n"])
        L.append(f"| {b} | {s['mrr']/nn:.3f} | {100*s['r1']/nn:.1f}% | {100*s['r3']/nn:.1f}% | {100*s['r5']/nn:.1f}% |")
    L.append("")
    L.append("| kind | n | bm25-raw R@3 | bm25-recency R@3 | engram-full R@3 | last-16 R@3 |")
    L.append("|---|---|---|---|---|---|")
    kinds = sorted({k for b in stats for k in stats[b]["bykind"]})
    for kd in kinds:
        cell=[f"{kd}", f"{stats['bm25-raw']['bykind'][kd]['n']}"]
        for b in ("bm25-raw","bm25-recency","engram-full","last-16"):
            v=stats[b]["bykind"][kd]; cell.append(f"{100*v['r3']/max(1,v['n']):.0f}%")
        L.append("| "+" | ".join(cell)+" |")

    # ---- twin / evidenceBoost direction experiment on real texts ----
    L.append("")
    L.append("## Evidence（proof）方向实验：真实文本上的孪生干扰")
    L.append("")
    L.append("对 10 条真实记忆各造一个『孪生』干扰项：**相同词面、重排顺序、hits=0**；真身 hits=3（模拟'被证明过多次'）。")
    L.append("纯词法下二者同分，engram-full 的 evidenceBoost 应把 hits=3 排前。")
    twins_raw=[]; twins_rec=[]; 
    cand=[r for r in rows if len(tokenize(r["text"]))>=8]
    random.shuffle(cand)
    picked=cand[:10]
    win_eng=win_rec=0
    for r in picked:
        toks=tokenize(r["blob"]); random.shuffle(toks)
        twin={"id":"twin_"+r["id"], "text":" ".join(toks), "tags":r["tags"], "entity":r["entity"],
              "kind":r["kind"], "createdAt":r["createdAt"], "updatedAt":r["updatedAt"], "hits":0,
              "blob":" ".join(toks)+" "}
        gold_c={"id":r["id"],"text":r["text"],"tags":r["tags"],"entity":r["entity"],"kind":r["kind"],
                "createdAt":r["createdAt"],"updatedAt":r["updatedAt"],"hits":3,"blob":r["blob"]}
        corpus=[twin,gold_c]
        q=" ".join(tokenize(r["text"])[:4])
        docs_n = [{"id": d["id"], "text": d["text"], "tags": d["tags"],
                    "updatedAt": d["updatedAt"], "hits": d["hits"]} for d in corpus]
        ids_rec = node_variant("recency", docs_n, q, now, 2)
        ids_eng = node_variant("full", docs_n, q, now, 2)
        # both have identical updatedAt/createdAt so recency cancels; evidence decides in engram
        if ids_eng[0]==r["id"]: win_eng+=1
        if ids_rec[0]==r["id"]: win_rec+=1
    L.append(f"- 样本：{len(picked)} 组；bm25-recency（无 evidence）把 hits=3 排第一：{win_rec}/{len(picked)}")
    L.append(f"- engram-full（真身，含 evidenceBoost）把 hits=3 排第一：{win_eng}/{len(picked)}")
    L.append("")
    L.append("## 局限")
    L.append("- 真实记忆全部 0-7 天（无远期记忆）→ 只能测 recency 的近期行为，无法测它对远引用的惩罚面")
    L.append("- 金标=self entity（实体名查询），测的是『区分同词记忆的能力』，非自由文本查询；hits>0 仅 10 条")
    L.append("- hits 是在 recall 命中时递增的计数；孪生实验用模拟 hits 验证其排序方向（与 rerank 单测呼应）")
    L.append("")
    L.append(f"数据来源：{ENG} · 生成时间戳 now={now}")
    report="\n".join(L)
    print(report)
    open(os.path.join(HERE,"REPORT.md"),"w",encoding="utf-8").write(report+"\n")

if __name__=="__main__":
    main()
