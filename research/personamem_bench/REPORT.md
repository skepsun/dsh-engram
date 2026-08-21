# PersonaMem 32k — retrieval-only Recall@K（内核对齐版）

- questions: 589 · contexts: 37 · unit: message-level segment
- 四个词法检索器共用同一内核 rank.mjs（复刻 lib/util.js bm25Rank，已验证与真身逐位一致）：
  `bm25-raw`=纯 BM25 · `bm25-recency`=+recency 因子 · `engram-full`=lib/util.js 真身（tag/短语/recency/evidence）
- PersonaMem 无时间戳：按消息序号映射（1 块≈20 条≈1 天），使 recency 真实生效；`sqlite-fts` 为 FTS5 原生内核；`last-k`=最近 64 条

| retriever | R@1 | R@3 | R@5 |
|---|---|---|---|
| bm25-raw | 23.6% | 26.7% | 29.4% |
| bm25-recency | 23.8% | 29.9% | 32.1% |
| engram-full | 23.8% | 29.9% | 32.1% |
| sqlite-fts | 23.9% | 27.7% | 31.2% |
| last-k | 65.9% | 68.8% | 71.0% |

## By reference distance (R@3)
| bucket | bm25-raw | bm25-recency | engram-full | sqlite-fts | last-k |
|---|---|---|---|---|---|
| near | 34% (n=269) | 39% (n=269) | 39% (n=269) | 37% (n=269) | 54% (n=269) |
| far | 20% (n=320) | 22% (n=320) | 22% (n=320) | 20% (n=320) | 81% (n=320) |

## By question type (R@5)
| type | bm25-raw | bm25-recency | engram-full | sqlite-fts | last-k |
|---|---|---|---|---|---|
| generalizing_to_new_scenarios | 0% | 2% | 2% | 4% | 100% |
| provide_preference_aligned_recommendations | 0% | 2% | 2% | 0% | 100% |
| recall_user_shared_facts | 2% | 2% | 2% | 3% | 100% |
| recalling_facts_mentioned_by_the_user | 0% | 0% | 0% | 0% | 100% |
| recalling_the_reasons_behind_previous_updates | 30% | 41% | 41% | 36% | 47% |
| suggest_new_ideas | 2% | 4% | 4% | 3% | 100% |
| track_full_preference_evolution | 100% | 100% | 100% | 100% | 14% |

## 关于此前『engram 比基线低』的归因

旧版对比不可信：python 复刻使用了**词边界计数 + 不同 tokenize**（保留撇号、CJK 不切 bigram），
与 lib/util.js 的**子串计数 + CJK bigram 分词**本质上不是同一词法内核；且旧桥接未传时间戳，
recency/tag/phrase 全部失效。本次已统一内核并验证 `full` 与 `bm25Rank` 逐位一致。

## Gold 位置与局限（同前）

- PersonaMem 全部 589 个 gold 位于会话尾 1/3 → `last-k` 高 Recall 是数据构造特性，非检索质量
- retrieval-only 分数不可与 AML 官方 0-100 对比（官方 gpt-4o-mini Answer/Eval 全流程）；本表只作检索器相对对比
- 时间戳映射（1 块≈1 天）是建模选择：PersonaMem 本身无真实时序
