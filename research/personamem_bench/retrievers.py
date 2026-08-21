"""Retrieval backends: raw BM25, SQLite FTS5, last-k window, and the Node-engram bridge."""
from __future__ import annotations
import math, re, sqlite3, json, subprocess, sys, os

TOK = re.compile(r"[a-zA-Z0-9']+")

def tokenize(text: str):
    return [t.lower() for t in TOK.findall(text or "")]

# ---------- raw BM25 (JUST-A-BM25 style: k1=1.5, b=0.75, no boosts) ----------
def build_bm25(docs):
    # docs: list[str]
    tlist = [tokenize(d) for d in docs]
    N = len(tlist)
    avgdl = sum(len(t) for t in tlist) / max(1, N)
    df = {}
    for t in tlist:
        for tok in set(t):
            df[tok] = df.get(tok, 0) + 1
    k1, b = 1.5, 0.75
    def score(qtok):
        idf = math.log(1 + (N - df.get(qtok, 0) + 0.5) / (df.get(qtok, 0) + 0.5))
        out = []
        for i, t in enumerate(tlist):
            tf = t.count(qtok)
            if tf == 0:
                out.append(0.0); continue
            dl = len(t)
            out.append(idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl)))
        return out
    return tlist, score

def bm25_rank(docs, query, limit=None):
    tlist, score = build_bm25(docs)
    words = tokenize(query)
    if not words:
        return []
    scores = [0.0] * len(docs)
    for w in words:
        sc = score(w)
        for i, v in enumerate(sc):
            scores[i] += v
    order = sorted(range(len(docs)), key=lambda i: -scores[i])
    if limit:
        order = order[:limit]
    return order, scores

# ---------- SQLite FTS5 ----------
def build_fts(docs):
    db = ":memory:"
    con = sqlite3.connect(db)
    con.execute("CREATE VIRTUAL TABLE mems USING fts5(content)")
    con.executemany("INSERT INTO mems(rowid, content) VALUES (?, ?)", enumerate(docs))
    return con

def fts_rank(con, query, limit=None):
    # FTS5 default is AND on space-separated terms — too strict for long
    # queries. Use OR so a doc matching any term qualifies, then bm25() ranks
    # (more shared terms -> higher). Unquoted OR lets the bm25 ranking shine.
    toks = tokenize(query)
    if not toks:
        return [], []
    q = " OR ".join(f'"{t}"' for t in toks)
    try:
        cur = con.execute(
            "SELECT rowid, bm25(mems) AS s FROM mems WHERE mems MATCH ? ORDER BY s LIMIT ?",
            (q, max(1, limit if limit else 100)),
        )
        rows = cur.fetchall()
        rows.sort(key=lambda r: r[1])  # bm25 lower = better
        return [r[0] for r in rows], [float(-r[1]) for r in rows]
    except sqlite3.OperationalError:
        return [], []

# ---------- last-k window ----------
def lastk_rank(docs, query, k=64, limit=None):
    n = len(docs)
    order = list(range(max(0, n - k), n))[::-1]
    return order[:limit] if limit else order, [1.0] * len(order)

# ---------- Node/dsh-engram bridge (real lib/util.js bm25Rank) ----------
def engram_rank(records_cid, query, limit):
    """records_cid: list of {id,text} for ONE cid; runs Node bm25Rank."""
    here = os.path.dirname(os.path.abspath(__file__))
    payload = json.dumps({"records": records_cid, "query": query, "limit": limit})
    proc = subprocess.run(
        [sys.executable and "node", os.path.join(here, "run_engram.mjs")],
        input=payload, capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"engram node failed: {proc.stderr[-800:]}")
    return json.loads(proc.stdout)
