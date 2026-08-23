# AML 学术榜头部系统深挖（2026-08 首届，academic/textual 前段）

> 来源：7 个开源参赛仓库（浅克隆自各 GitHub，见下文）；只提炼**可移植的确定性机制**，
> LLM 参与的部分（query expand / fact extraction / candidate rank / agent 多轮检索）标注为
> 「非纯规则」不展开。目标：为 dsh-engram 的纯规则增强找实证依据。

## 各系统核心机制

### #1 InvMem（45.06）— vanilla RAG（向量+重排），非纯规则
- chunk 按「CJK 逐字 + 英文词」为 token，滑窗 + overlap。
- FAISS 内积 + CrossEncoder 重排（torch 模型）。
- 启示：榜首也是"朴素 RAG"——本评测的分数差更多来自证据返回的组织而非检索魔法。

### #2 Refind（44.97）— 会话级 RRF 融合 ★纯规则
- BM25（k1=1.2, b=0.75）over 会话 chunk。
- **session RRF**：`score = 1/(60+rank_chunk) + 1/(60+rank_session)`，其中 rank_session 是
  把同一 session 内所有命中分求和后在整个会话集合上的排名——会话整体相关的，其 chunk 全加分。
- 返回 anchor + 上下文窗口（锚点前后 N 条）。
- agent 模式：LLM 多轮搜索 + excluded_ids 去重 + 多样化关键词（非纯规则）。
- 移植点：**我们有 sessionId/seq**，可直接做 entity/session 二级 RRF。

### #3 ActiveMemoryIndex（44.84）— 工程型
- BGE-small + SQLite + 进程内 LRU 向量缓存；request_id 幂等 gate（防平台重试重复写入）。
- 查询侧 bge query 前缀。
- 可借鉴：请求幂等/缓存，无检索规则增益。

### #5 ChronoHybridMem（44.33）— 多通道 RRF + 时序意图 ★
- **多通道词法**：原始消息 FTS / porter 词干 FTS / 抽取事实 FTS / 上下文(±1条) FTS /
  会话 FTS，各自 BM25 排名后带通道权重 RRF（context 通道权重低）。
- **时序意图检测**（正则）：查询含"最新/当前/recent/today/最近…"→ 对新证据加 temporal_bonus
  （线性归一化到 [0,1]）；含"最早/之前/历史"→ 反向。**注释明确：只解决近并列，不压过强词法证据**。
- 实体启发：大写 token 视为实体；`实体 AND 内容` 结构化查询。
- 内容 casefold 去重。
- LLM：fact 抽取 + 候选排序（非纯规则）。

### #6 Hybrid Episodic Memory（44.28）— 表示层 ★
- 句子边界切块；**把时间戳 + role 烘焙进单元文本**（下游 answer 靠文本内时间解相对时间词）。
- BM25 + dense + 加权 RRF。
- **相对新近度**：候选集内时间戳归一到 [0,1]，`+= weight * best_score * relative`
  （加法、受 best 缩放），注释：**刻意轻微——过重会毁掉旧轮显式事实召回**。

### #8 FlowGrid（43.98）— 纯规则典范 ★★★（零依赖，与本方向最相关）
- 确定性特征：CJK n-gram / 拉丁 / 数字 / 日期 / 引号短语 / 实体式 token；**停用词仅查询侧**（索引不丢）。
- 三粒度视图：message / window（滑窗）/ session-segment，进同一 FTS，聚合视图带上下文加成。
- 加和评分：词法（归一化 FTS rank）+ 覆盖率 + 整句子串 + 引号短语 + 实体(封顶×5) +
  日期 + 数字 + 视图上下文 + **相邻证据**（同一 session 内 seq±1 也在候选 → +6）+
  **相对新近度**（时间意图时权重 8→55）+ 偏好意图 → 用户直接偏好陈述加分。
- **supersession 覆写检测**：话题签名（≥2 字符 token 集合）containment ≥0.5 且时间更新 →
  新者 +4 / 旧者 −1；**只对含时间意图的查询生效**；链中间态不加不减；
  可选 require_update_cue（新记录须带"改为/不再/replaced by/supersedes/最新口径…"通用更新语）。
- **消融教训（关键）**：纯结构 supersession（18/6 权重）在合成集**净负**
  （temporal|paraphrase +0.10，但整体 MRR −0.026~−0.034）——根因：仅靠"话题重合+更晚"
  无法区分「真实更新」与「对同一话题的无关后续提及」。require_update_cue 是修正方向。
- 数字/日期冲突单独机制（数值型改动不干扰非数值查询）。

### SQLite-FTS 基线（官方 41.79）— 我们已复刻
- FTS5 bm25 列权重 + 无词法命中时按 source_timestamp 降序兜底。

## 对 dsh-engram 的结论（哪些可吸收）

| 机制 | 出处 | 门槛 | 我们是否已具备 |
|---|---|---|---|
| 会话/实体二级 RRF | Refind | 低（有 sessionId/entity/seq） | 无 → 候选 |
| 时序意图门控（按查询升降 recency）| Chrono/FlowGrid/episodic | 低（正则） | 无（现为无条件乘法 recency）→ 候选 |
| supersession（更新覆写）带门控+update cue | FlowGrid | 中 | 无（= agentmemory 候选③，按其消融教训设计）|
| 相邻证据加成（seq±1 同会话） | FlowGrid/Chrono | 低 | 部分（evidenceBoost 是命中计数）→ 候选 |
| 日期/数字精确命中加成 | FlowGrid | 低 | 无 → 候选 |
| 偏好直接陈述加成 | FlowGrid | 低（中英 pattern） | 无 → 候选 |
| 时间戳/role 烘焙进证据文本 | episodic | 低 | dsh-engram 记忆本就带 createdAt → 表示层可借鉴 |
| 多粒度 window/segment 视图 | Chrono/FlowGrid | 高 | 重，暂缓（dock 极简约束）|

## 重要实证（纠正/加固我们的设计）
1. **recency 必须「意图门控」**：多个头部系统的 recency 都是**候选集内相对** + **仅在时间
   意图时放大**；episodic 明示"过重毁旧事实召回"，FlowGrid 消融证明无条件全局新近度会在
   非时间查询上抬错（single_hop MRR 1.0→0.21 属 supersede，但理念一致）。我们在 PersonaMem
   上测的 +2.7pp R@5 是无条件 recency——**在真实 agent 记忆里应改为意图门控**。
2. **supersession 不能裸做**：纯结构判定净负；必须 temporal-intent 门控 + require_update_cue
   + 链中间态中性 → 这正是 agentmemory 候选③的落地规格。
3. **多粒度证据组织**（消息/窗口/会话）+ 相邻加成，比单粒度检索强（FlowGrid #8、Chrono #5 均含）。

## 待办映射
- 把 1/2 的实证写回 `docs/PROPOSAL-agentmemory.zh.md`（候选② retention、候选③ supersedes 的外部证据）。
- 可选：在 PersonaMem/真实库 bench 上原型「时序意图门控 + supersession」，重测 R@K 验证。

## MemoraX Code（榜首产品开源客户端，2026-08-22 补）

见 `research/aml_top_systems/memorax-code.md`。关键结论：榜首检索引擎在**闭源云端**
（memory.memorax HTTP API），开源仓库为多 harness 客户端——工程纪律（9k 注入预算、
`-[time]` 时间前缀 + memory_type 分桶、重叠滑窗切块写回、idempotencyKey 幂等、
baseline 祖先校验防回退的更新节流）全可借鉴；**其分数不可复现**，但「证据组织与纪律
> 检索魔法」的判断被榜首自己的架构再次确证。
