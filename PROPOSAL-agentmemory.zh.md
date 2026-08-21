# dsh-engram 方案候选 · 借自 agentmemory（会话去重 / retention / 自动遗忘）

> 依据：[rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) 深度研究（TS + iii engine 的
> hook 驱动记忆流水线：54 MCP 工具 / 12 hooks / 0 外部 DB / 1600+ 测试）。
> **状态：已归档（研究报告 + 候选方案），未实施。** 实施与否待与用户确认。
> 约束：全部**纯规则 / 零向量 / 零 LLM 蒸馏 / 确定性单测 / host 等自然重启**。

---

## 研究报告摘要（详见对话经过与仓库）

agentmemory = 「coding agent 的持久记忆全流水线」：PostToolUse 自动捕获 → SHA-256 5min 去重 →
隐私过滤 → LLM 压缩 → 向量+BM25+知识图谱三索引 → SessionStart 按 token 预算注入。

核心模型：
1. **四层记忆巩固**（Working / Episodic / Semantic / Procedural），Ebbinghaus 遗忘曲线。
2. **Retention 数学**：`min(1, salience·exp(-λ·Δt) + σ·Σ(1/daysSinceAccess))`；
   access-tracker 记 count/lastAt/recent[≤20]；hot/warm/cold 分级。
3. **Auto-forget**：per-memory `forgetAfter` TTL、矛盾检测(0.9)、重要性逐出。
4. **检索**：BM25+向量+图谱 → RRF(k=60) 融合 + **session-diversified（每会话≤3 条）**；
   superseded 版本移出检索路径；近重复 advisory `similarTo`。
5. **关系词汇**：`supersedes / extends / derives / contradicts / related`。

## 三个纯规则候选点（未实施）

| # | 候选 | 现状差距 | 落点 | 成本 |
|---|---|---|---|---|
| ① | **会话去重 recall**（session-diversified，每会话≤3） | auto-capture 单会话霸榜、他会话高相关被挤掉 | engram_recall 排序后按 sessionId 稳定去重，默认每会话 3 条（可配） | host ~25 行 |
| ② | **Retention 分数**（Ebbinghaus + 访问强化） | 现有 recency 仅单指数 `1+0.5·exp(-age/14)`，无访问增强 | 新增 `lib/retention.js` 纯函数；记忆加 `lastAccessAt`+`accessWindow`（recall 命中即记）；bm25Rank recency 升级为 retention（evidenceBoost 保留）；GC 逐出按 retention 排序 | host ~120 行 + GC 调整 |
| ③ | **Per-memory TTL + 显式 supersedes/contradicts** | 只有全局 expireDays；观察反证是计数而非可回查关系 | `storeMemory` 支持 `expiresAfter`（error 类默认短 TTL）；esr_link 记忆层加 `contradicts`/`supersedes` 关系，superseded 检索降权 | host ~100 行 |

明确不做：embedding / MiniLM、图谱抽取、LLM 压缩、secrets 深度脱敏、coordination、git snapshots、
CJK segmenter。

---

## 外部实证（2026-08-22，AML 首届学术榜头部系统深挖 7 仓库 + 双 bench 实测）

来源：`research/aml_top_systems/SYNTHESIS.md`；实测：`research/personamem_bench/REPORT.md`、
`research/realdata_bench/REPORT.md`。

### 候选②（retention / recency）——实证修正
- 头部系统一致做法：recency 用**候选集内相对归一**（episodic：`+= weight*best*relative` 加法且刻意
  轻微，注释"过重毁旧事实召回"）；Chrono/FlowGrid 均**意图门控**——仅查询带时间意图（now/current/
  latest/recent/最近/目前…）才放大，且明确"只解近并列、不压过强词法证据"。
- 我们的双 bench 实测（rank.mjs 加 `recency-gated`/`full-gated` 变体）：
  - PersonaMem 32k：gated 30.2% R@5 < 无条件 32.1%（585 问句中 75% 无时间词，gold 铆会话尾部，
    门控主动放弃数据红利，此语料无条件更优）。
  - 真实库 self-recall：entity 查询全无时间词 → gated == plain（23.0%），无条件 +1.6pp（24.6）——
    **同 entity 记忆里 updatedAt 更新的更接近"当前应记住的状态"，实体查询隐含最新语义**。
- **结论**：对 dsh-engram（agent 工作记忆、实体/主题查询为主），**保持现状轻微无条件 recency
  （lib/util.js 现公式：14 天 +18%、60 天 +1%）优于意图门控**；意图门控+放大仅适合"高频模板化
  重复陈述"的对话记忆场景，若做则作为配置项（默认 off）。候选②的改动重心应从"改 recency 公式"
  移到 **GC 逐出按 retention 排序 + lastAccessAt 访问强化**（保留不破坏现状的确定性收益面）。

### 候选③（TTL + supersedes/contradicts）——实证给出门控规格
- FlowGrid #8 的超前实现与消融（关键实证）：
  - 话题签名 containment（交集/较短者）≥0.5 + 时间更晚 → 新者 +4/旧者 −1；
    链中间态不加不减；**只在查询含时间意图时生效**。
  - **裸结构判定净负**（temporal|paraphrase +0.10，整体 MRR −0.026~−0.034）：同话题无关后续提及
    会误判为覆写；`require_update_cue`（新记录须带"改为/不再/replaced by/supersedes/最新口径…"）
    是修正方向，官方默认 disabled。
- 真实库情况：同 entity containment≥0.5 有 27 对、带 update-cue 仅 4 对，且多为"同一事件回顾"
  而非"新状态替换旧状态" → 当前积累下无充分场景，原型无统计意义。
- **结论**：候选③若实施，规格 = temporal-intent 门控 + require_update_cue + 链中间态中性 +
  **默认关、按配置开启**（FlowGrid 官方即默认 disabled）。在其产生可感知收益前（真实库积累更多
  更新型记忆），优先级低于候选①②。

### 白捡机制（成本低，待并入候选或另立小项）
- 会话/实体二级 RRF（Refind：`1/(60+单条rank)+1/(60+会话rank)`）——有 sessionId/entity，可直接做。
- 相邻证据加成（FlowGrid：同会话 seq±1 也在候选 → +6；Chrono context 通道）。
- 日期/数字精确命中加成（FlowGrid W_DATE=45 / W_NUMBER=25 同级）。
- 时间戳/role 烘焙进证据文本（episodic，表示层，我们记忆已带 createdAt 可复用到 evidence 视图）。

---

## AML 编程榜启示与实施顺序（2026-08-22 追加）

来源：`research/AML-coding-2026-08-21.md` + `research/aml-coding-2026-08-21.json`（58 条全量）。

### 榜单事实
- academic coding 43 条：**峰值 52.67 = 官方 `aml-memory-baseline` 自身**（8 个并列，疑似
  baseline 模板克隆），**0 个提交超过**；其余 35 条在 46.00–52.33。industry 峰值 MemoraX 62.00
  （返回量全榜最小 ~6K、搜索最快 1.8s）。官方对照 `no-memory-8000`（无记忆+8k 上下文）数值仅在网页端。
- 词法/简单方法全程不落下风：SQLite-FTS 50.00、Refind 50.00、FlowGrid 49.33 vs Mem0 48.67、
  Hindsight 46.67；returnSize 与解决率无单调关系，但「返回极少+快」的 MemoraX 登顶、几乎不返回的
  反而垫底。

### 对三候选的启示（证据纪律 > 检索魔法）
1. **① 会话去重 recall 升为最高优先级**：coding 榜最强提交「返回极少而准」+ textual 榜 RRF/去噪
   惯例 →「少而准」是当前评测范式下的正收益；engram_recall 的会话去重直接落实这一纪律，成本最低。
2. **返回策略做成显式约束**：默认 topK/返回大小可控；证据带 provenance/时间/状态（episodic 烘焙
   思路），服务下游"判断新旧"，这是③的治理面，比 supersede 判定更优先。
3. **② retention 保持轻量化**：不改 recency 公式（实测无条件轻微更优）；重心在 GC 逐出按
   retention 排序 + lastAccessAt 访问强化（确定性收益面）。
4. **③ supersedes 维持门控规格且默认关**：真实库场景不足（27 对候选/4 对 cue），等积累；实施时
   按 FlowGrid 门控规格（temporal-intent 门控 + require_update_cue + 链中间态中性）。
5. **不做向量/重排/复杂融合**：编码榜证明简单方法与复杂系统同带，增强预算花在证据组织上。

### 实施顺序（更新）
| 序 | 项 | 状态 |
|---|---|---|
| 1 | ① 会话去重 recall（每会话≤3，可配）| **下一实施项** |
| 2 | 返回控制 + 证据字段（provenance/时间戳）显式化 | 随①一并落地 |
| 3 | ② GC 按 retention 排序 + lastAccessAt 访问强化 | 之后 |
| 4 | ③ supersedes 门控规格（默认关）| 场景积累后评估 |

> 决策依据：不追榜单分数（coding 赛道区分度不足）；以自建 bench（PersonaMem/真实库）为增强度量尺。
