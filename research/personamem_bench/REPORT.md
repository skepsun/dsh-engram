# PersonaMem 32k — retrieval-only Recall@K

- questions: 589 · contexts: 37 · unit: message-level memory segment
- retrievers: bm25-raw (standard BM25) · engram (dsh-engram lib/util.js bm25Rank, BM25+recency) · sqlite-fts (FTS5 bm25) · last-k (recent 64 window)
- gold evidence = message at `end_index_in_shared_context`; Recall@K = gold in top-K

| retriever | R@1 | R@3 | R@5 |
|---|---|---|---|
| bm25-raw | 23.6% | 27.3% | 30.7% |
| engram | 23.6% | 26.7% | 29.4% |
| sqlite-fts | 23.9% | 27.7% | 31.2% |
| last-k | 65.9% | 68.8% | 71.0% |

## By question type (R@5)

| type | bm25-raw | engram | sqlite-fts | last-k |
|---|---|---|---|---|
| generalizing_to_new_scenarios | 2% (n=57) | 0% (n=57) | 4% (n=57) | 100% (n=57) |
| provide_preference_aligned_recommendations | 0% (n=55) | 0% (n=55) | 0% (n=55) | 100% (n=55) |
| recall_user_shared_facts | 3% (n=129) | 2% (n=129) | 3% (n=129) | 100% (n=129) |
| recalling_facts_mentioned_by_the_user | 0% (n=17) | 0% (n=17) | 0% (n=17) | 100% (n=17) |
| recalling_the_reasons_behind_previous_updates | 32% (n=99) | 30% (n=99) | 36% (n=99) | 47% (n=99) |
| suggest_new_ideas | 5% (n=93) | 2% (n=93) | 3% (n=93) | 100% (n=93) |
| track_full_preference_evolution | 100% (n=139) | 100% (n=139) | 100% (n=139) | 14% (n=139) |

## By reference distance (R@3)

| bucket | bm25-raw | engram | sqlite-fts | last-k |
|---|---|---|---|---|
| near | 37% (n=269) | 34% (n=269) | 37% (n=269) | 54% (n=269) |
| far | 19% (n=320) | 20% (n=320) | 20% (n=320) | 81% (n=320) |

## Gold 位置剖析（为什么 last-k 这么强——数据构造特性）

PersonaMem 32k 的参考事实**全部（589/589）位于各自会话的后三分之一**——
每道题 query 触发的是「刚才那一轮」刚提及的事实。因此：

1. **last-k（最近 64 条）的高 Recall 是数据特性**：gold 大多落在窗口内
   （`recall_user_shared_facts` 等类型 100%），但这类问题 gold 在窗口内
   不代表窗口是最佳证据——它同时带回大量噪音（64 条里多数无关），
   下游 LLM 用 top-K 证据时会受噪音拖累。**Recall 不惩罚噪音**。
2. 例外 `track_full_preference_evolution`（last-k 仅 14%，词法 100%）：
   偏好演进型问题的 gold 在 tail 内更靠前（超出 64 条窗口），词法检索
   精准命中。这正说明「回看早期事实」时检索器 > 窗口。
3. 我们的 `distance_to_ref_in_blocks` 分组与 last-k 的强弱**方向相反**
   （far=81% > near=54%）:因为"块"按 token 切分、与消息下标方向并不单调，
   该分组仅作内部参考，不应对 last-k 的强项外推。

## 局限与解释（诚实声明）

- **Retrieval-only 指标不等价于 AML 官方分数**：官方跑 gpt-4o-mini
  Answer/Eval（LLM 从证据推理答题，多项选择/判分），本自评只测
  "证据是否被检索到"。榜单的 bm25/SQLite-FTS 基线分数（38-42/100）
  是 LLM 全流程产物，**不可与本表数字互相换算**。本表的用途是三检索器
  的**相对**对比。
- **dsh-engram 的 recency 因子在本语料上无正收益**（R@5 29.4 vs 30.7）。
  PersonaMem 无真实时间戳（用消息下标映射 age），且 gold 锚在尾部——
  该场景不能外推到 dsh-engram 的真实使用（记忆带真实 createdAt，最近
  经验相关性来自真实时序）。结论：**纯词法 + 位置启发在此基准无优势**；
  recency 的价值只在有真实时序/命中信号时体现（hindsight 的 evidenceBoost
  依赖 hits，本语料 hits=0，恰好不参与）。
- **三词法检索器收敛**（27-31% R@5）且 sqlite-fts 略优（31.2），与官方榜
  "SQLite-FTS > 纯 BM25" 的方向一致——说明 dsh-engram 的检索核心与业界
  词法基线量级相当，优势差异点在标签/recency/证据增强等非词法信号（本
  语料无法激活）。
