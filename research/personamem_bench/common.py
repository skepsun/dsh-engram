"""PersonaMem 32k loader — shared by all retrievers."""
from __future__ import annotations
import json, csv, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

def load():
    ctxs = {}
    with open(os.path.join(DATA, "contexts.jsonl"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            for k, v in json.loads(line).items():
                ctxs[k] = v
    rows = []
    with open(os.path.join(DATA, "questions.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append(r)
    return ctxs, rows

def gold_index(row):
    return int(row["end_index_in_shared_context"])

def dist_blocks(row):
    return int(row["distance_to_ref_in_blocks"])
