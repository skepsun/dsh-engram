# Agent Memory Leaderboard (AML) · 首届榜单快照 · 2026-08-12 放榜

> 数据源：https://agentmemoryleaderboard.ai/leaderboard API（GET ?track=&benchmark_type=），抓取于 2026-08-21。
> 原始 JSON：`research/aml-academic-textual-2026-08-12.json`（50 参赛）/ `research/aml-industry-textual-2026-08-12.json`（15 产品）。

## 赛事背景
- 2026 首届「Agent Memory Challenge」，南开等院校参与的公开评测空间；报名 7/29 截止 8/7，首轮放榜 8/12。
- 两赛道：**文本记忆**（事实召回/多跳整合/时序理解/记忆治理/个性化/规则执行/安全与隐私）× **代码记忆**。
- 两榜：**学术方法榜**（须公开 GitHub + 披露来源）/ **商业产品榜**（不要求开源，API 稳定 30 天）。
- 流程：Add/Search API（或公开 repo 平台部署）→ smoke → full；Search 只返回记忆证据，禁止生成答案/样本隔离/禁操纵。
- 评测套件 **public_suite_v3 / Leaderboard Suite**：angry, enemy, friends, man_earth, locomo_refined,
  longmemeval_refined, longmemeval_s, clbench_0_4k, clbench_16_32k, personamem_v2_32k, beam_100k, beam_1m
  （= LoCoMo / LongMemEval / CLBench / PersonaMem / BEAM 100K+1M 超长档）。

## Academic / Textual 榜单要点（34~45 分区间，0-100）
| 排名 | 系统 | avg | 仓库 |
|---|---|---|---|
| 1 | InvMem | 45.06 | wenxiaof345-ctrl/vanilla-rag-memory |
| 2 | Refind | 44.97 | imlrz/ReFind |
| 19 | Mem0 | 42.07 | mem0ai/mem0 |
| 22 | SQLite-FTS-Baseline | 41.79 | FantaSmallhamster/ldbd-sqlite-fts-baseline |
| 27 | Hindsight AML Adapter | 40.76 | Flipped111/hindsight-aml |
| 35 | just-a-BM25 | 38.47 | imlrz/just-a-BM25 |
| 47 | LightMem | 28.77 | zjunlp/LightMem |

完整 50 行见 JSON；学术榜全部 open repo，可作为「智能体记忆开源框架」的权威候选清单。

## Industry / Textual（15 产品）
MemoraX 58.02 居首；MemOS 45.89；NTES-MEMORY-SMART 44.21；Cognee/Mem0/TencentDB/Vectorize Hindsight Cloud(38.54)/SuperMemory 等。

## 关键观察
1. **Coding 赛道两榜暂无结果**（首届代码记忆尚未放榜）。
2. **检索基线差距极小**：纯 BM25 38.47 / SQLite FTS 41.79，而榜首 InvMem 45.06 —— 当前评测对
   「检索排名质量」区分度有限，得分大头在其他环节（返回组织/长上下文处理/治理）。
3. 本次研究过的 **Hindsight** 与 **Beads 同领域相关项**（Vectorize Hindsight Cloud、Mem0）均在榜上。
4. dsh-engram 是纯规则零 LLM 检索系统，理论上可走「学术·代码」路径（公开 repo + Docker Add/Search
   封装）作为无向量基线参赛验证 BM25+evidenceBoost+retention 的相对水平 —— 待用户定夺。
