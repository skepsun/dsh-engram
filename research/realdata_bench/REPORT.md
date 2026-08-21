# dsh-engram 真实记忆 self-recall 评测

- 语料：真实存储 dsh_engram.json（96 条记忆，真实 createdAt/updatedAt/hits/entity）
- 金标：60 条带 entity 的记忆；查询=自身 entity 名（self-recall），目标=把它排过同工作区其余记忆（含同 entity 记忆）
- 检索器：bm25-raw（纯 BM25）· bm25-recency（+recency 因子）· engram-full（lib/util.js 真身：tag/短语/recency/evidence）· last-16（最近窗口）

| retriever | MRR | R@1 | R@3 | R@5 |
|---|---|---|---|---|
| bm25-raw | 0.228 | 11.7% | 20.0% | 30.0% |
| bm25-recency | 0.229 | 11.7% | 20.0% | 30.0% |
| engram-full | 0.221 | 10.0% | 21.7% | 31.7% |
| last-16 | 0.056 | 1.7% | 5.0% | 8.3% |

| kind | n | bm25-raw R@3 | bm25-recency R@3 | engram-full R@3 | last-16 R@3 |
|---|---|---|---|---|---|
| decision | 43 | 19% | 19% | 19% | 5% |
| error | 6 | 17% | 17% | 17% | 0% |
| fact | 1 | 0% | 0% | 0% | 0% |
| insight | 3 | 0% | 0% | 0% | 33% |
| procedure | 4 | 75% | 75% | 75% | 0% |
| task | 3 | 0% | 0% | 33% | 0% |

## Evidence（proof）方向实验：真实文本上的孪生干扰

对 10 条真实记忆各造一个『孪生』干扰项：**相同词面、重排顺序、hits=0**；真身 hits=3（模拟'被证明过多次'）。
纯词法下二者同分，engram-full 的 evidenceBoost 应把 hits=3 排前。
- 样本：10 组；bm25-recency（无 evidence）把 hits=3 排第一：0/10
- engram-full（真身，含 evidenceBoost）把 hits=3 排第一：8/10

## 局限
- 真实记忆全部 0-7 天（无远期记忆）→ 只能测 recency 的近期行为，无法测它对远引用的惩罚面
- 金标=self entity（实体名查询），测的是『区分同词记忆的能力』，非自由文本查询；hits>0 仅 10 条
- hits 是在 recall 命中时递增的计数；孪生实验用模拟 hits 验证其排序方向（与 rerank 单测呼应）

数据来源：/d1/chuxiong/.dsh/storages/dsh_engram.json · 生成时间戳 now=1787279708268.2578
