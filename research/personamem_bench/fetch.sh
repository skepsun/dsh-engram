#!/usr/bin/env bash
# PersonaMem 32k bench data (public, HF) — see https://huggingface.co/datasets/bowen-upenn/PersonaMem
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/data"
mkdir -p "$DIR"
curl -sL "https://huggingface.co/datasets/bowen-upenn/PersonaMem/resolve/main/shared_contexts_32k.jsonl" -o "$DIR/contexts.jsonl"
curl -sL "https://huggingface.co/datasets/bowen-upenn/PersonaMem/resolve/main/questions_32k.csv" -o "$DIR/questions.csv"
echo "data -> $DIR"
ls -la "$DIR"
