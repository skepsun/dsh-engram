# dsh-engram 真实记忆 self-recall 评测

- 语料：真实存储 dsh_engram.json（97 条记忆，真实 createdAt/updatedAt/hits/entity）
- 金标：61 条带 entity 的记忆；查询=自身 entity 名（self-recall），目标=把它排过同工作区其余记忆（含同 entity 记忆）
- 检索器：bm25-raw（纯 BM25）· bm25-recency（+无条件 recency）· recency-gated（仅时间意图查询启用）· engram-full（真身）· full-gated（真身但 recency 门控）· last-16（窗口）

| retriever | MRR | R@1 | R@3 | R@5 |
|---|---|---|---|---|
| bm25-raw | 0.197 | 9.8% | 16.4% | 23.0% |
| bm25-recency | 0.201 | 9.8% | 16.4% | 24.6% |
| recency-gated | 0.197 | 9.8% | 16.4% | 23.0% |
| engram-full | 0.221 | 9.8% | 23.0% | 31.1% |
| full-gated | 0.221 | 9.8% | 23.0% | 31.1% |
| last-16 | 0.055 | 1.6% | 4.9% | 8.2% |

| kind | n | bm25-raw R@3 | bm25-recency R@3 | engram-full R@3 | last-16 R@3 |
|---|---|---|---|---|---|
| decision | 43 | 12% | 12% | 12% | 21% | 21% | 2% |
| error | 7 | 14% | 14% | 14% | 14% | 14% | 14% |
| fact | 1 | 100% | 100% | 100% | 0% | 0% | 0% |
| insight | 3 | 0% | 0% | 0% | 0% | 0% | 33% |
| procedure | 4 | 50% | 50% | 50% | 75% | 75% | 0% |
| task | 3 | 33% | 33% | 33% | 33% | 33% | 0% |

## Evidence（proof）方向实验：真实文本上的孪生干扰

对 10 条真实记忆各造一个『孪生』干扰项：**相同词面、重排顺序、hits=0**；真身 hits=3（模拟'被证明过多次'）。
纯词法下二者同分，engram-full 的 evidenceBoost 应把 hits=3 排前。
- 样本：10 组；bm25-recency（无 evidence）把 hits=3 排第一：8/10
- engram-full（真身，含 evidenceBoost）把 hits=3 排第一：10/10

## 局限
- 真实记忆全部 0-7 天（无远期记忆）→ 只能测 recency 的近期行为，无法测它对远引用的惩罚面
- 金标=self entity（实体名查询），测的是『区分同词记忆的能力』，非自由文本查询；hits>0 仅 10 条
- hits 是在 recall 命中时递增的计数；孪生实验用模拟 hits 验证其排序方向（与 rerank 单测呼应）

数据来源：/d1/chuxiong/.dsh/storages/dsh_engram.json · 生成时间戳 now=1787280886872.3918

## 时序意图门控实验结论（2026-08-22 追加）

| retriever | MRR | R@3 | R@5 |
|---|---|---|---|
| bm25-raw | 0.197 | 16.4 | 23.0 |
| bm25-recency（无条件） | 0.201 | 16.4 | **24.6** |
| recency-gated | 0.197 | 16.4 | 23.0 |
| engram-full（真身） | 0.221 | **23.0** | **31.1** |
| full-gated | 0.221 | **23.0** | **31.1** |

- 61 个实体 self-recall 查询**全部不含时间意图词** → `recency-gated == bm25-raw` 完全相等：
  门控把 recency 在真实 agent 记忆（实体/主题查询，最常见的形态）上**整个关掉**。
- 无条件 recency 仍有 +1.6pp R@5 的真实收益：同 entity 的多条记忆里，`updatedAt` 更新的那条
  更接近「当前应记住的状态」（失败复活/更新路径），实体查询隐含「最新状态」语义，**不依赖查询
  文本里出现时间词**。
- 结论：**对 dsh-engram 的使用形态，保持现状「轻微无条件 recency」（= lib/util.js 现公式，
  14 天 +18%、60 天 +1%）优于意图门控**。意图门控+放大（Chrono/FlowGrid）更适合对话记忆里
  高频重复陈述场景，建议留作可配置项而非默认。
- supersession 原型：真实库 97 条记忆中同 entity containment≥0.5 有 27 对、带通用 update-cue
  仅 4 对，且多为「同一事件的回顾」而非「新状态替换旧状态」→ 样本不足以出统计结论；按
  FlowGrid 消融（纯结构判定净负），落地需 门控 + update-cue + 链中间态中性，且默认关。
