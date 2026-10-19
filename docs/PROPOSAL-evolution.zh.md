# 演进提案：从「记忆插件」到「上下文投资组合」

> 结论先行：dsh-engram 的下一阶段不该继续证明「我们能存多少记忆」，而该证明
> **「每条进入上下文的 token 都有正回报」**。宿主正在吞掉上下文管道，插件必须
> 上移到**语义层 + 度量层 + 学习层**——否则会在下一轮 DSH 原生化里被降级成一个
> 可替换的存储后端。
>
> 本文用四类证据写：**【实测】**本项目自己的数据、**【外部】**论文/官方文档、
> **【源码】**DSH 0.2.0-rc.2 的实际接缝、**【判断】**我的取舍。所有【实测】都可
> 用仓库内脚本复现（`eval/oracle-analysis.mjs` 等），口径写在 §1.3。

---

## 0. TL;DR

**三条判断：**

1. **定位上移。** DSH 0.2.x 已经原生提供 spill（`maxInlineTokens: 12500`）、
   compaction、AGENTS.md 指令加载、session checkpoint、turn outline、token meter、
   skill provider。继续在「截断/摘要/注入」这些管道的同一层做功能，边际价值递减；
   真正没人做、也最难被宿主复制的，是**什么值得记、何时值得注入、如何巩固成真相、
   经验如何复利**。
2. **瓶颈不是检索，是激活与经济学。** 本机 112 个会话：写入 123 次 `engram_store`、
   ESR 101 次，但显式 `engram_recall` 只有 24 次、`engram_detail` 8 次；同时
   73.3% 的请求发生在 ≥200 请求的长会话里。**写多读少 + 长会话常态**说明：拉取式
   设计（等模型自觉来查）失败，必须改成**按事件推送 + 账本证明**。
3. **默认值与价值/风险错配。** 已经证明能省 token 的机制（BoundaryPrune、
   ResultPack）默认**关**；而默认**开**的是会改写宿主预设、跨代际最容易坏的
   Context GC 接管（`gcReplacesCompaction: true`、`autoWebCompaction: true`）。
   这等于把「维护风险」设为默认、把「可验证收益」设为可选。

**一条外部支点（本提案最重要的引用）：** *The Complexity Trap* 在 SWE-bench
Verified 上实测——**简单的 observation masking 把成本减半，解题率与 LLM 摘要持平
甚至略高**；在 masking 之上再加摘要的混合方案还能把成本再降 7%（相对纯摘要降 11%）
（[arXiv:2508.21433](https://arxiv.org/abs/2508.21433)，NeurIPS'25 DL4C）。这直接证明：
**零 LLM 的机械压缩不是省钱将就，而是当前最优解之一**——本项目的技术路线有外部
实证背书，应该把它写成第一主张，而不是藏在实现里。

**一条主线（三阶段）：**

| 阶段 | 主题 | 一句话 |
|---|---|---|
| v0.6（4–6 周） | **Ledger + Push** | 把省 token 变成可审计账本，并按事件推送记忆，而不是等模型来查 |
| v0.7（6–10 周） | **Consolidation** | 从「记录发生了什么」到「维护当前真相」：情景摘要、实体页、冲突/衰减 |
| v0.8（8–12 周） | **Playbooks** | 把 error→fix、闭环任务、偏好提炼成**可验证的程序性记忆**，导出为 skill |
| v1.0 | **Context OS / 生态** | 预算规划、可移植格式（`.engram/` + MCP）、公开账本基准 |

**一句话定位：agent 的上下文 CFO**——记账（ledger）、调仓（consolidation）、
复利（playbooks）、审计（evidence）。

**如果只能做一件事：先把 Ledger 做出来。** 它同时解决三个问题：①把「省 token」
从主张变成可复现的数字；②给所有机制一个统一的开关依据（净收益为负就关）；
③成为对外唯一可信的差异点——在「没有标准 harness token 基准」的窗口期（§2.8），
谁先给出可复现的账本，谁就定义了这个品类。

---

## 1. 现状盘点：用项目自己的数字说话

### 1.1 机制清单与真实状态

| 机制 | 默认 | 证据 | 真实状态 |
|---|---|---|---|
| 零 LLM 捕获（git/编辑/错误/偏好） | 开 | store 123 次【实测】 | 活跃，但产出的是**事件**而非知识 |
| `[ENGRAM]` 符号索引（700c/会话冻结） | 开 | 2.9Kc≈730 tok 工具 schema，占富预设 7%【实测】 | 方向正确，但**没有 ROI 淘汰** |
| `[RECALL]` 会话启动召回 | 开 | 66 会话仅 8 次显式 recall；本轮 112 会话 24 次【实测】 | 注入腿有效，下钻腿仍弱（detail 8 次） |
| ESR 证据闭环 | 开 | esr 101 次 / 闭环 13 任务【实测】 | 本项目最独特的资产，尚未反哺记忆质量 |
| Context GC（替换 compact） | **开** | 默认改写 stock 预设（带 `.bak`）【源码】 | 收益真实，但**跨代际最脆、侵入性最强** |
| BoundaryPrune | **关** | 38% 会话激活；首剪 4.23M chars；T2048 10.14M【实测】 | 有效但休眠——「省了没人知道」 |
| ResultPack L2 | **关** | 依赖 BoundaryPrune | 与宿主 spill 功能重叠，需重新定位 |
| 激活遥测 / Web 看板 | 开 | 2 个进程内计数器 + 会话日志回放【源码】 | 度量齐全，但**没有净收益口径** |

### 1.2 语料画像（2026-10-19，本机 `~/.dsh/sessions`）

- 112 会话 / 17.7K 请求 / 19.1K 工具调用 / 81 次 compaction / **1665 次中途 splice**。
- 请求数分布：p50=70，p75=188，p90=385，p99=1233，max=1399；
  **27 个会话 ≥200 请求，承载 73.3% 的请求**。【实测】
- 工具结果重放暴露：naive 9.95B chars / 压缩截断后 3.33B chars（≈833M–2.49B tok）；
  结果占「重放 + 固定开销」的 18.9%–56.4%；top-10 结果占结果字节中位数 41.8%；
  bash/read/run_code 三类占约 96%。【实测】
- 机制激活：6 个挂载会话中 5 个调用过 engram/esr 工具；store 123 / esr 101 /
  recall 24 / detail 8。【实测】

**三个读数：**

1. **长会话是主战场。** 73% 的请求在 ≥200 请求会话里；81 次压缩意味着宿主默认
   摘要已经在真实使用中反复发生。任何「省 token」机制只有在长会话里自动生效才有意义。
2. **写多读少。** 模型愿意写（store/ESR），但几乎不主动查。**这是产品形态问题，
   不是提示词问题**——纯拉取式检索在 coding harness 里被实证证伪。
3. **前缀抖动是隐形税。** 1665 次中途 splice 意味着 KV 缓存频繁失效；任何新注入
   都必须按「重写成本」计价，否则省下的上下文还不够付缓存钱。

### 1.3 口径与限制（先自证，再 proposal）

- chars/4 估算 token，未折价 KV 缓存命中；`0.1×` 缓存价是保守假设。
- 单人、三 workspace 语料；机制激活是「被调用」而非「有用」。
- `with-hits=32 > recall calls=24` 这类计数来自不同聚合层，本文只引用调用次数。
- **结论只在「方向」上可信，绝对值不可外推。**

### 1.4 最近记忆里的四条教训（本项目自己的历史）

- **#8 静默归零（2026-10）**：DSH 把会话日志改成 `session.v<N>.jsonl.zstd`，
  四处扫描硬编码旧名，`ENOENT` 被循环 `continue` 吞掉，结果是 `/stats`、偿还门
  历史、CJK 跨会话搜索**全部静默为 0**（修复后 files 0→17、events 0→643）。
  → **度量不能依赖「读宿主日志才知道自己有没有效」**；账本要自己记账，
  兼容层要对「0 值」告警，而不是把它当正常。
- **0.4.0 被 DSH 0.2.0 拒绝启动**：settings API 在 0.1.2 / 0.1.7 两次断裂。
  → 「改写宿主预设」是最高风险动作，应默认关、显式确认、可一键还原（§3.5）。
- **npm token 失效卡住 0.5.1 发布**：分发链路是单点故障。
  → 发布冒烟、凭据轮换、备用 registry 应进 CI/文档，而不是靠记忆。
- **phase-2 四方向落地后 `engram_detail` 仍只有 8 次**（store 123）：机制存在 ≠ 被使用。
  → 每个机制上线必须自带激活漏斗 + kill switch，**默认由证据决定开关**，
    而不是由「我们造出来了」决定。

---

## 2. 外部趋势：八条与我们有直接关系的变化

### 2.1 上下文工程成为一等公民

Anthropic 2025-09 的系统性文章把 context 定义为**有限注意力预算**，并给出四条
长时程手段：compaction、structured note-taking、memory tool、sub-agent 架构；
强调「just-in-time + progressive disclosure」与「最小的、高信号的 token 集合」。
同时指出 **context rot**：上下文越长，召回精度越差，这是所有模型的共同退化。
→ [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)、
[Context Rot](https://research.trychroma.com/context-rot)

**对我们的含义：**「检索到 ≠ 灌全文」的哲学被主流验证；但下一层竞争是
**「在正确的时刻，用最小的 token，把正确的记忆推到模型面前」**——正是本项目
最弱的一环（detail 8 次）。

### 2.2 记忆从「检索」转向「巩固 / 更新 / 时间」

- **Mem0**（arXiv 2504.19413）的核心不是向量库，而是
  **extract → consolidate → retrieve** 的写入管线：对候选记忆做 ADD/UPDATE/DELETE
  决策，并保留图结构；报告相对 OpenAI memory +26%，p95 延迟 -91%，token -90%。
  **但它每个回合都要付 LLM 提取/巩固的钱**——图变体只比基础版高约 2%。
- **Zep / Graphiti**（arXiv 2501.13956）把记忆建成**时序知识图谱**：事实带有效区间，
  过时边不删除而是**失效**；DMR 94.8% vs MemGPT 93.4%，LongMemEval 最高 +18.5%，
  延迟 -90%。代价同样在写入路径的逐 episode LLM 抽取。
- **Letta / MemGPT** 用「可编辑记忆块 + 归档存储」把记忆变成 agent 自己调用的工具；
  sleep-time compute（arXiv 2504.13171）把整理挪到离线期。
- **A-MEM / MemOS** 分别走 Zettelkasten 式原子笔记 + 演化链接、以及跨
  plaintext/activation/KV-cache 的分层放置——方向同为「结构先于检索」。

**对我们的含义：** 我们已有 `supersedes/contradicts` 和实体/链接，但停留在
「平铺记录 + 手工标注」。**巩固（consolidation）是缺失的一层**：把 N 条事件
压成一条当前真相、把矛盾摊开、把过时事实降权——这恰恰是零 LLM 规则最擅长的部分。
我们不需要 Mem0 的每回合 LLM 账单，但需要它的**更新语义**。

### 2.3 程序性记忆与自改进：playbook 化

**ACE**（ICLR 2026，arXiv 2510.04618）把上下文当作**不断演化的 playbook**：
生成 → 反思 → 策展，结构化增量更新，避免「简洁偏差」（为了短而丢洞察）和
「上下文坍缩」（反复重写侵蚀细节）；在 agent 任务 +10.6%、金融 +8.6%，
且**不需要标注监督**，靠执行反馈自迭代。

**对我们的含义：** 本项目的 error→procedure 闭环（`fixed: <cmd> — N earlier
failing runs now succeed`）就是 playbook 的雏形，但只有一条规则、没有证据计数、
没有失效机制、没有导出。**这是复利资产**，优先级应仅次于账本。

### 2.4 零 LLM 压缩有了硬证据（本提案的外部支点）

*The Complexity Trap*（[arXiv:2508.21433](https://arxiv.org/abs/2508.21433)，
NeurIPS'25 DL4C）在 **SWE-bench Verified** 上用 SWE-agent 跑 5 种模型配置，并做
OpenHands 复核：

- **纯 observation masking（把旧工具结果换成占位符）把成本减半**，解题率与
  LLM 摘要**持平或略高**（SWE-agent，5 种模型配置；OpenHands 初步复核）；
- 在 masking 之上再加摘要的混合方案，成本比纯 masking 再低 **7%**、比纯摘要低 **11%**；
- 结论：**LLM 摘要不是省上下文的必要条件**，机械遮蔽/剪枝是被实证的同等或更优解。

**对我们的含义：** 这是把 BoundaryPrune / ResultPack / Context GC 从「实现细节」
提升为**第一主张**的依据。对外一句话应是：
> 「不调模型、不摘要，机械压缩把 SWE-bench 类任务的上下文成本减半，解题率不降。」

### 2.5 平台前移，且前缀稳定从「风格」变成「硬约束」

- **Claude Code 的记忆设计已经就是「符号索引 + 存储域」**：
  `~/.claude/projects/<project>/memory/` 下 `MEMORY.md` 作索引，**每次会话只加载
  前 200 行 / 25KB**，其余按需用文件工具读；四类记忆 user/feedback/project/reference；
  子代理默认不加载自动记忆（[docs](https://code.claude.com/docs/en/memory.md)）。
  **这既是架构背书，也给了索引预算的直接先例（200 行 / 25KB）。**
- **Anthropic API 已把 context editing + 服务端 compaction 做成产品**：
  `clear_tool_uses_*` 清工具结果，服务端 compact 默认阈值 **100k token**；
  更关键的是**前缀校验**——2026-08-31 之后创建的账号，重放已失效的 thinking block
  会被**直接拒绝**。前缀稳定不再是优化，而是正确性。
- DSH 0.2.x 同样在吸收管道：spill policy（`maxInlineTokens: 12500`）、token meter、
  skill provider、AGENTS.md 加载、session checkpoint、turn outline。

**对我们的含义：** 宿主会持续吃掉「截断/摘要/注入」；插件只能做**内容、时机与
预算分配**。而任何注入/剪枝都必须按「前缀重写成本」计价——这正是 Ledger 的职责。

### 2.6 反方必须回答：*Agents Don't Need Memory. They Need Documentation.*

2026-10 的一篇批评（[liao.gg](https://liao.gg/blog/agents-dont-need-memory)）把
「记忆插件」统称为 RAG-over-transcripts，列了五条失败模式：

1. 相似 ≠ 正确/新鲜；
2. 片段丢失动机与上下文；
3. **把过去当真相**，而代码库天天在变；
4. agent 搜不到「自己不知道存在」的东西；
5. **存储不可审计**。

它的替代方案是：注入一份精简目录 + 由工作 agent 自己写的文档，**原地重写、不追加**。

**对我们的含义：** 这五条里，1/3/5 恰好是我们的机会而不是弱点——如果把
**可审计性**做成头等特性：每条记忆都带 `file:line` / `session:seq` / 内容哈希 /
git blob / mtime，可**重新验证**、过期可检测。**「可审计 + 可失效」是对
「记忆不可信」最直接的反驳**，也是零 LLM 捕获路线的天然优势。第 4 条则靠
「按事件推送」而非「等模型来搜」解决。

### 2.7 安全已是独立品类

- OWASP GenAI 2026-05 专文《Memory Is a Feature. It Is Also an Attack Surface》；
- SpAIware（持久记忆作为注入向量，FGCS 2025）、PERSIST 威胁模型（ACM S&P 2026）、
  「Zombie Agents」自强化注入（arXiv:2602.15654）；
- Anthropic 自己的 memory tool 文档要求：**每条命令都做路径穿越校验**、大小上限、
  过期策略，并承认模型「通常」不会写密钥——「通常」不是保证。

**对我们的含义：** 存储文本一律当**不可信数据**，永不渲染为指令；跨来源写入要
provenance 分级 + quarantine；导入/导出与 `.engram/` 文件是最高危入口。

### 2.8 评测：召回率会自欺，要用「结果态」

- **LongMemEval**（ICLR'25，arXiv 2410.10813）：500 题、五项能力（抽取、多会话推理、
  时间推理、知识更新、**拒答**）；商用助手与长上下文模型掉约 30%。
- **τ-bench**（arXiv 2406.12045）：比的是**最终数据库状态**与 **pass^k** 可靠性——
  「记忆有没有改变结果」，而不是「检索看起来像不像」。
- **LOCOMO 已被公开质疑**（规模小、易过拟合），Mem0 的 LOCOMO 数字有争议。
- **The Horizon Gap**（arXiv 2608.06663，2026-08）把 long-horizon / long-context /
  long-term memory 分开，明确指出「拆解模型能力与 harness 能力」是未解测量问题；
  **目前没有标准的 harness token-efficiency 基准**。

**对我们的含义：** 我们的评测应报「净 token + 任务结果态 + 激活率」三件套，
而不是只报 Precision@k。**「没有标准 token-efficiency 基准」是一个空位**——
`oracle-analysis` + Ledger 有机会成为那个基准（见 v1.0）。

**趋势 → 我们的动作（映射表）：**

| 趋势 | 我们不能做什么 | 我们该做什么 |
|---|---|---|
| 宿主吸收管道 | 重写 compaction / 再做一套 spill | 做**内容与策略**：指针摘要、注入时机、预算分配 |
| 巩固成为核心 | 再堆一个向量库、每回合调 LLM 提取 | 确定性规则做**情景→语义**收敛与冲突可视化 |
| Playbook 复利 | 每次会话从零开始 | error→fix→procedure→skill 的证据化晋升 |
| 零 LLM 有实证 | 把「不调模型」当情怀 | 把 masking 结果写成第一主张，配账本 |
| 前缀成为硬约束 | 逐轮注入/改写 | 批量、定点、按重写成本计价 |
| 反方：不可审计 | 只存自然语言 | provenance + 可重验证 + 原地重写 |
| 安全独立成类 | 信任存储文本 | 当数据不当地指令；quarantine/审批/路径校验 |
| 评测看结果态 | 只报召回率 | **净收益账本 + τ-bench 式结果态 + pass^k** |


---

## 3. 定位与取舍

### 3.1 一句话定位

> **dsh-engram = 上下文的投资组合管理器。**
> 记忆是资产，注入是仓位，账本是会计，巩固是调仓，playbook 是复利，
> 证据（ESR）是审计。

这个定位有三个好处：

1. **与宿主不竞争**：宿主管「怎么塞进去」，我们管「塞什么、值不值、什么时候该忘」。
2. **可证伪**：账本给出每机制净收益，错了就关——符合项目已有的 SoL-Pi 纪律。
3. **可延展**：从个人记忆到团队/跨 harness，资产与账本的抽象不变。

### 3.2 三个「做」

1. **预算与账本层**：每会话、每机制、每类记忆的 token 收支，含缓存重写折价。
2. **语义巩固层**：情景摘要 → 实体页 → 当前真相；矛盾显式、过时降权、可追溯。
3. **经验复利层**：偏好 → 规则；error→fix → 过程；闭环任务 → playbook → skill。

### 3.3 三条不可谈判的不变量

这三条既是工程约束，也是对外叙事（直接回应 §2.6 的五条批评）：

1. **可审计（Auditable）**：每条记忆都能解析到 `file:line` / `session:seq` /
   内容哈希 / git blob / mtime，且**可重新验证**；过期不是靠 prose 自述，而是靠
   重新读取锚点判定。**这是「记忆不可信」问题的正面回答。**
2. **数据不是指令（Data, not instructions）**：存储文本永不渲染为指令；来源分级
   （user / agent / external / imported）、导入隔离、路径穿越校验、召回时注入扫描。
3. **前缀计价（Prefix-accounted）**：任何注入/剪枝/重写都先过 Ledger；净收益为负
   就不执行。前缀稳定是硬约束（§2.5），不是优化项。

### 3.4 三个「不做」（以及为什么）

1. **不做默认向量库/嵌入检索。** 成本、陈旧、非确定性；BM25 + 宿主 FTS 已够，
   语义检索做成**可插拔可选**，不进热路径。
2. **不做通用摘要器。** 宿主的 compaction 会持续变好；我们只做**可重取的指针摘要**
   （已有 Context GC 的核心思想），且不再扩大接管面。
3. **不再扩 UI/工具面。** 15 个工具、27 个旋钮、284KB/5263 行 client bundle、
   924KB 包体已经是维护税；每多一个面板，就少一周做机制。

### 3.5 「默认值即产品」

这是本提案最具体的一条批评：**当前默认值把风险放在前面、把收益放在后面。**

建议（v0.6 内完成）：

| 键 | 现在 | 建议 | 理由 |
|---|---|---|---|
| `gcReplacesCompaction` | `true` | `false`（opt-in） | 改写宿主预设是最高维护风险；先让用户看见再接管 |
| `autoWebCompaction` | `true` | `false`，首次设置页显式询问 | 同上；`.bak` 不是用户可理解的契约 |
| `boundaryPrune` | `false` | `"auto"`（账本证明净收益才开） | 有偿还门与遥测，具备自适应条件 |
| `resultPack` | `false` | 跟随 boundaryPrune，优先复用宿主 spill | 避免双份归档 |
| `autoSupersede` | `false` | 保持关（证据不足） | 误伤代价高 |

**已实现（2026-10-19，v0.6）**：`gcReplacesCompaction` / `autoWebCompaction` 默认改为
`false`（opt-in，保留宿主摘要）；`boundaryPrune` 默认 `true` 并新增
`boundaryPruneAdaptive`（账本否决：该 workspace 净收益为负且 ≥3 次剪枝 → 自动停剪）；
`resultPack` 默认 `true`，保证默认剪枝无损。默认值随代码生效，README 与 Context GC 指南
已同步；`autoSupersede` 仍保持关。

---

## 4. 路线图（每阶段都带「门」）

> 工期按每周 10–15 小时业余投入估算；兼职/全职可压缩约一半。

### v0.6 · Ledger + Push（4–6 周）

**目标：让「省 token」从主张变成可审计的事实，并让机制自动生效。**

**A. Context Ledger（新 `lib/ledger.js`）**

每个会话落一行账：

```
injected   : Σ 索引/召回/ESR 块 chars × 该块存活的请求数
avoided    : Σ 被剪枝/压缩/归档的结果 chars × 后续请求数（复用 oracle 口径）
rewrites   : 因注入/剪枝导致的前缀重写次数 × 前缀大小（缓存罚金）
net        : avoided − injected − rewrites×(1−cacheDiscount)
```

- 数据源：`ctx.tokenMeter`（宿主已有）、pruner 返回值、compaction 事件、
  注入块长度、`[RECALL]` 计数。
- 输出：`/stats` 增 `ledger`；GUI 概览加一张「本会话净收益」卡；
  **不新增工具**（工具 schema 也是成本）。
- 诚实口径：token 是估算、缓存折价可配（默认 0.1，即重写按 90% 计罚金）、
  未计模型质量差；Context GC 的压缩节省暂未接入（宿主未暴露前后大小）。
- **状态**：已实现（2026-10-19）——`lib/ledger.js`（纯函数 + 原子落盘 + delta flush）、
  `test/ledger.test.mjs` 12 例、`/stats` 与 `/overview` 的 `ledger` 字段、
  `ledgerEnabled` / `ledgerCacheDiscount` 两个设置键、GUI 遥测页账本面板 +
  概览「上下文净 token」卡；`npm test` 375/375。
- 反事实基线：同一会话关闭机制时的 avoided 由 oracle 离线算，账本只报「实际发生」。

**B. 自适应默认（`boundaryPrune: "auto"`）**

- 用偿还门（预计剩余请求 × 单结果重放成本 > 重写成本）作为**唯一**开关条件；
  无收益证据自动关。保留全局 kill switch。
- 遥测显示「过去 7 天本 workspace 净收益」；为负则自动退回关。
- **状态**：已实现（2026-10-19）——`boundaryPrune` 默认开、`boundaryPruneAdaptive`
  默认开；`index.js` 的 `boundaryGate`（30s 缓存、按 workspace）在剪枝前读取账本，
  负净收益且 ≥3 次剪枝时否决并打一行日志；gate 异常 fail-open，绝不影响剪枝。
  `test/boundary-prune.test.mjs` 新增用例覆盖 veto/allow/opt-out/throw。

**C. JIT 推送（把「拉取」换成「按事件推」）**

四个事件，每次 ≤1 行、无命中就沉默：

1. **错误复发**：同 `cmd:` 签名第二次失败 → 推已有 error/procedure 记忆的 id 行。
2. **文件焦点**：连续编辑同一文件 → 推该 `filePath` 锚定的 fact/preference。
3. **目标完成**：goal/todo 边界 → 推「该实体未闭环任务 + 下一步」一行。
4. **会话恢复**：resume/隔天继续 → 推 `resume brief`（见 v0.7）。

- **计价规则**：推送会改前缀 → 走 Ledger 的 `rewrites`，ROI 为负就不推。
  这是与「冻结前缀」原则的显式妥协，由账本裁决，而不是拍脑袋。
- **状态**：已实现（2026-10-19）——`lib/jit.js` 三类事件（错误复发 / 文件焦点 /
  goal 完成），append-only、每会话 ≤3 行、每行 ≤220 字符、无命中沉默；
  `index.js` 注册 `engram:jit` section（order 40.75）与 observers；每次推送
  `ledger.noteRewrite(estimatePrefixChars + line)`；设置键 `jitEnabled`。
  已覆盖：错误复发只在第 2 次失败且存在 error/procedure 记忆时推；文件焦点只在
  连续第 2 次同文件编辑且存在 filePath/dir 锚定记忆时推；goal 完成时有 active
  任务才推。**未做**：resume brief（留给 v0.7）、基于预计剩余请求的显式 ROI 门
  （当前是 3 行硬预算 + 账本观测）、todo 完成边界（避免高频刷屏）。

**D. 宿主对齐（减法）**

- ResultPack 归档时**优先引用宿主 spill 文件路径**（`dsh-spill-policy` 已在
  `dsh-base` 默认挂载，`maxInlineTokens: 12500`），不再复制一份中段；
  只对「spill 之后仍超 pruner 阈值」的结果做二次归档。
- 统一阈值语义：spill 是「插入时有界」，pruner 是「重放时有界」，账本分别计。
- 重新评估 `gcReplacesCompaction`：默认关；把 Context GC 的「指针摘要」作为
  可选增强，而不是默认接管。

**E. Provenance 基线（为 v0.7 铺路）**

- 所有新写入带 `source` + `sessionId` + `seq`（部分已有）；旧数据一次性迁移，
  缺失来源的标 `legacy` 并在晋升时降权。
- 召回/推送返回的每条都能**点回来源**（会话、工具调用、文件），
  这是 §3.3「可审计」不变量的最小实现。

**门（预声明，未过不发布）：**

- 净收益 > 0 的会话 ≥ 50%，且长会话（≥200 请求）≥ 70%；
- 配对任务集（仓库内 12 个真实任务，3 种子）成功率下降 ≤ 2 个百分点；
- 机制激活率（挂载会话中至少 fire 一次）≥ 60%；
- 账本自身开销 < 0.5% 请求时延（纯内存累加，不读日志）。

### v0.7 · Consolidation（6–10 周）

**目标：从「事件流」到「当前真相」，让记忆可维护。**

**A. Episode digest（零 LLM）**

会话结束/空闲时生成一条 `episode` 记忆：改了哪些文件、跑了哪些命令、
失败→修复、关键决策、未完成回路。来源全部是已有事件（工具调用、git、ESR、
todo），不调模型。`episode` 默认**不进索引**，只作为实体页与 resume brief 的素材。

**B. 实体页（Entity page）**

把 `esr_node` 从「图上的点」升级为「可渲染的页」：

```
## ent:dsh-engram
truth      : 当前有效事实（按 verifiedAt 排序，superseded 剔除）
timeline   : 最近 N 条事件（episode/fact/decision）
open loops : 未闭环任务 + 最近失败
conflicts  : contradicts 边 + 待裁决标记
```

- 注入时只给**实体卡**（≤3 行：truth 首行 + open loops 数 + 更新时间），
  详情走 `engram_detail`/页——继续渐进披露。
- 索引从「平铺行」升级为「实体卡 + 少量独立事实」，同样 700c 预算内信息密度更高。
- **状态（2026-10-19）**：**B 已实现**——`lib/entity-page.js`
  （`buildEntityPage` / `resolveEntity` / `renderEntityCard` / `renderEntityPage`）；
  `selectEntityCards` 在 `[ENGRAM]` 前置最多 2 张实体卡（truth 首条 + mem/open 计数 +
  `engram_detail(entity=…)` 指针），并把这些实体的平铺记忆行从索引中去重；
  `engram_detail` 新增可选 `entity` 参数返回完整页（truth/timeline/open loops/
  conflicts/relations）；`entityCardsEnabled` 默认开。`test/entity-page.test.mjs` 7 例。
  **C（锚点重验证 / 分层 TTL / 巩固任务）仍未做**。

**C. 巩固任务（可离线）**

- 去重/合并（同实体同语义）、抽象（N 条 episode → 1 条 fact）、衰减（久未命中降权）、
  冲突显式化。**规则优先；可选本地 LLM 仅在离线巩固期使用**，热路径保持零 LLM。
- **不做「后台做梦者」**（§2.6 的批评成立）：巩固只在**会话边界/显式触发**运行，
  不在每回合跑 LLM；历史作为审计日志保留，**当前真相原地重写**
  （`supersedes` 语义 + `current` 视图），追加式记录不进入注入面。
- 硬规则：**无 provenance 不晋升**（没有 file/commit/tool call/会话 id 的记录
  不能变成 fact）；**用户偏好只能来自 user 消息**（已有实现，保持）。
- **可重验证**：fact 晋升时记录锚点（`file:line` + 内容哈希 / git blob / mtime），
  召回/索引前抽查；锚点失效 → 自动降权并标 `stale`，而不是继续当真相。
- `expireDays` 从「整条过期」改为「分层 TTL」：episode 短、fact 长、preference 永久。

**D. Resume Brief（隔天继续）**

打开旧会话/同 workspace 新会话时，注入 ≤5 行：上次停在哪、未闭环任务、
最近的失败与修复、下一步建议。这是本项目对「73% 请求在长会话」最直接的产品回答，
也是与宿主 checkpoint 的差异化（宿主存状态，我们存**意义**）。

- **状态（2026-10-19）**：**A + D 已实现**——`lib/episode.js` 的 `buildEpisode()`
  在 `session/disposed` 生成零 LLM 纪要（文件/命令/失败→修复/决策/未闭环，仅实质会话写入，
  永不进索引，每 workspace 保留 20 条）；`renderResumeBrief()` 在新会话注入最近 7 天
  最新 episode（`[RESUME]` ≤240 字符 + `engram_detail` 指针）；设置键
  `episodeEnabled` / `resumeBriefEnabled`；`test/episode.test.mjs` 9 例。
  **B（实体页）/ C（锚点重验证、分层 TTL）待做**——它们需要 schema 迁移与索引渲染改造，
  留到下一轮。

**门：**

- 跨会话问答集（自建 40 题 + LongMemEval 子集）Hit@3 提升 ≥ 20%；
- 索引 token 不增（实体卡替代平铺行后 ≤ 700c）；
- 陈旧事实率（被 supersede 后仍出现在索引）< 1%；
- **锚点重验证**：人为改动 10 个被 fact 引用的文件，7 天内 100% 被标 `stale`；
- 巩固任务 CPU < 200ms/会话（纯规则）。

### v0.8 · Playbooks（8–12 周）

**目标：让经验复利，而不是每次从零开始。**

**A. 证据化 procedure**

- 输入：`error`（含 `cmd:` 签名）+ 后续成功运行、已闭环任务（artifact +
  evaluation）、用户偏好。
- 输出：`procedure` 记忆，带 `evidenceCount`、`lastVerifiedAt`、`invalidatedBy`。
- 晋升规则：同一命令成功 ≥3 次且最近 14 天无失败 → 可进索引；
  再次失败 → 立即失效并降权（现有 failure→fix 闭环的加强版）。
- **禁止**从一次成功就泛化；禁止跨 workspace 自动迁移（需显式提升到 user scope）。

**B. 导出为 DSH Skill**

- 宿主已有 `dsh-skill` / `dsh-skill-filesystem`（SKILL.md + 渐进披露）。
  procedure 满足门槛后，可**一键导出**为项目级 skill（`.dsh/skills/…` 或 workspace
  `.engram/skills/`），由宿主按需加载，而不是常驻索引。
- 这同时是分发杠杆：用户把「这个仓库怎么干活」的技能带走，形成生态。

**C. Subagent handoff capsule**

- 子代理结束时，父代理只收一条 ≤500 tok 的胶囊：结论、证据、未决问题、建议下一步。
- 与 SoL-Pi 的 Evidence-Preserving Reducer 同构；也是 1665 次 splice 的一部分解药
  （把长上下文留在子代理里，父级只留胶囊）。

**D. 用户审批门**

- playbook 晋升、偏好转规则、跨 scope 提升 → 需要显式确认（GUI 或
  `esr_close` 式证据门）。**防投毒的第一道闸**。

**门：**

- playbook 复用率（被召回后实际被工具调用引用）≥ 30%；
- 目标任务一次通过率提升 ≥ 5%，且无「照抄过时 playbook」导致的失败；
- 失效检测：人为注入 10 个过时 procedure，7 天内全部被降权/失效。

### v1.0 · Context OS / 生态（12 周+）

- **预算规划器**：按任务类型（探索/实现/修复/评审）分配 memory / tools / skills /
  history 的预算，给出策略而不是旋钮。
- **可移植**：`.engram/` 文件格式（可 review、可 git、可 PR）+ MCP server
  （让 Claude Code/Cursor 等客户端也能读写同一份记忆）+ 双向导入导出。
- **公开账本基准**：把 `oracle-analysis` + ledger 抽成中立的「harness 上下文
  浪费基准」，接受外部语料投稿——这是唯一能建立「度量权威」的方式。
- **上游提案**：`finalizeContent` 链、compaction 内容钩子、memory 事件——
  与其被动适配，不如参与定义。

---

## 5. 架构与工程收敛

### 5.1 分层（保持「薄组合」）

```
core        store / recall / index-block / capture      （不变）
policies    ledger / boundary-prune / consolidation / playbook
projections [ENGRAM] [RECALL] [ESR] entity-card resume-brief
adapters    DSH seams (storageDomain, tokenMeter, pruner, compaction, skill)
```

- 新机制**只能**加在 policies/projections；core 的召回与存储不动。
- 每个 policy 必须自带 `dry_run` + 账本 + 独立 kill switch（沿用 BoundaryPrune 纪律）。

### 5.2 减法清单（v0.6 同步做）

| 项 | 现状 | 目标 | 先例 |
|---|---|---|---|
| client bundle | 284KB / 5263 行 | 拆分查看器懒加载；主页 < 150KB | — |
| 工具数 | 15 | ≤10（读工具融合为 `engram(op=…)`；休眠工具下线） | MCP memory server 也只暴露少量工具 |
| 设置旋钮 | 27 | 面向用户的 ≤12；其余进 `advanced` | — |
| 面板数 | 6+ | 冻结新增；合并「注入预览 / 遥测 / 账本」为一页 | — |
| 包体 | 924KB | < 600KB（不含 docs） | — |
| 索引预算 | 700c | 保持 ≤700c，但信息密度提升（实体卡） | Claude Code：索引只加载前 200 行 / 25KB |

### 5.3 兼容性工程

- **最低版本 CI job**（长期缺口）：pin `0.1.2-alpha.2`（或 `0.1.2-rc.1`）实跑
  测试，而不是只测最新。这是「声明范围」与「实际验证」的诚实性问题。
- 宿主版本矩阵进 CI：`0.2.0-rc.2` / `latest` / `next` 三档。
- 用**特性检测**而非版本号分支（现有做法正确，保持）；新接缝（spill、tokenMeter、
  skill）全部走 `if (ctx.xxx)` + 缺席降级。
- Context GC 的预设改写加「一次性、显式确认、可一键还原」三件套。

---

## 6. 验证协议（防止自欺）

**指标定义：**

| 指标 | 定义 | 用途 |
|---|---|---|
| NetTokens | avoided − injected − rewrites×cacheFactor | 唯一主指标 |
| Activation | fire 过的会话 / 挂载会话 | 机制是否真的跑 |
| DrillRate | detail / recall-with-hits | 推送是否被采纳 |
| Quality Δ | 配对任务成功率差 | 质量红线 |
| StaleRate | 索引里已被 supersede 的行占比 | 真相维护 |
| ReuseRate | playbook 被引用 / 被召回 | 复利是否发生 |

**实验纪律（沿用 SoL-Pi + τ-bench）：**

1. 预声明能力下限（例如「质量下降 >2pp 即回滚」），先写后测。
2. 配对 A/B：同一任务、同一模型、同一仓库，只切换插件开关；3 种子。
3. 密封清单：评测任务不参与调参；fail-before / pass-after 双向记录。
4. **结果态优先**：记忆评测用 LongMemEval 的五项能力（含**拒答**）做回归，
   任务评测用 τ-bench 式**最终状态比对 + pass^k**，而不是只看检索命中。
5. 负结果公开：机制没激活就关掉（现有 `boundaryPrune: false` 是正确姿态，
   但要有「自动重新评估」）。
6. 账本必须扣缓存重写；只报 avoided 的账本是营销，不是工程。
7. LOCOMO 只作参考：规模小、易过拟合，不把它当发布门槛。

**对照口径（对外可复现）：**

| 对照 | 目的 |
|---|---|
| 无插件（宿主默认） | 基线成本/成功率 |
| 仅 masking（BoundaryPrune） | 验证零 LLM 路线（对齐 arXiv:2508.21433） |
| 仅记忆注入（无剪枝） | 分离「记得多」与「省得多」 |
| 全开（账本调参后） | 产品化目标 |

> 目标不是「赢过谁」，而是画出本 harness 的 **cost-vs-solve-rate 曲线**——
> 这正是 §2.8 指出的空白。

---

## 7. 风险登记

| 风险 | 信号 | 缓解 | Kill switch |
|---|---|---|---|
| 宿主原生记忆 | DSH 发布 memory 包 | 上移语义/度量层；数据可导出；参与上游 | 关闭接管，保留纯记忆 |
| 记忆投毒/注入（OWASP 2026；SpAIware；PERSIST；Zombie Agents） | 召回内容含指令性文本；`.engram/`、导入文件、AGENTS.md 被污染 | 数据非指令不变量、provenance 分级、quarantine、召回扫描、**路径穿越校验**、导入审批 | 一键禁用自动注入 |
| 陈旧/错误记忆 | StaleRate 上升、用户纠正 | 锚点重验证（hash/mtime/git blob）、分层 TTL、冲突可视化、负反馈 | 回滚到「只读历史」 |
| 复杂度失控 | 旋钮/工具/面板增长 | 减法清单、预算上限（工具/字节） | 冻结发布 |
| 单人语料偏差 | 只有作者数据 | 5–10 名外部用户；可导出的账本报告 | 推迟宣称收益 |
| 隐私 | 跨 workspace/团队共享 | 本地优先、脱敏、显式 scope、可删除 | 默认 strict 隔离 |
| 性能 | 大 workspace 召回变慢 | 进程内 BM25 已有界；巩固离线 | 降级为 FTS |
| 前缀不兼容 | API 拒绝重放失效块；缓存命中骤降 | 批量/定点注入 + 账本计价；不做逐轮改写 | 关闭 JIT 推送 |

---

## 8. 需要拍板的六个决策

1. **是否接受「账本证明 + 自适应默认为开」**（替代「默认关、用户自己开」）？
2. **是否把 Context GC 从「默认替换 compaction」降级为 opt-in**？
   这会影响现有用户的压缩行为（默认回到宿主摘要），但大幅降低代际风险。
3. **是否允许离线巩固期使用本地 LLM**（热路径仍零 LLM）？
4. **是否执行 UI/工具减法**（冻结新面板、融合工具）？
5. **目标优先：自用最优，还是社区采用？** 前者可不做 MCP/多 harness；后者必须做。
6. **是否押注 playbook→skill**（依赖宿主 skill 生态的稳定性）？

我的建议：**1 是、2 是、3 可选（默认关）、4 是、5 先自用后社区、6 小步试点**。

---

## 9. 备选路线（如果主线不成立）

| 路线 | 内容 | 适用条件 | 代价 |
|---|---|---|---|
| B 极简可靠 | 冻结功能，只做兼容/文档/分发 | 目标是「更多人稳定用」 | 放弃差异化，易被宿主替代 |
| C 工具化 | 把 oracle/ledger 抽成独立「上下文剖析器」 | 目标是开发者工具市场 | 与插件主线分叉 |
| D 可移植协议 | `.engram/` + MCP，做跨 harness 记忆层 | 赌「记忆属于用户不属于宿主」 | 早期投入大、需求未验证 |

**我不建议现在切 B/C/D**：本项目的独特资产（零 LLM 捕获 + ESR 证据门 + 零依赖
召回 + 真实语料工具链）还没有被榨干，主线仍有 2–3 个高置信机制可做。

---

## 10. 未来 6 周的具体落点（业余节奏）

| 周 | 交付 | 文件/接缝 | 验收 |
|---|---|---|---|
| 1 | Ledger 数据结构 + 纯函数单测 | 新 `lib/ledger.js` | 口径表与 oracle 对齐 |
| 2 | 账本接入 usage/api/stats | `lib/usage.js`、`lib/api.js` | `/stats` 出 net |
| 3 | 自适应 BoundaryPrune | `lib/boundary-prune.js`、settings | 干跑净收益为正才开 |
| 4 | JIT 错误复发推送 + 计价 | `lib/index-block.js`、`lib/trigger.js` | DrillRate 提升、净收益 ≥0 |
| 5 | ResultPack 复用 spill + 默认值调整 | `lib/result-pack.js`、`lib/index.js` | 无重复归档；默认关 GC 接管 |
| 6 | 配对任务基准 + 文档/发布 | `eval/`、README | 质量 Δ ≤2pp，账本可复现 |

---

## 11. 参考

**本项目证据**

- [ORACLE-ANALYSIS.zh.md](ORACLE-ANALYSIS.zh.md)：重放暴露 / 融合候选 / 激活率
- [PROPOSAL-resultpack.zh.md](PROPOSAL-resultpack.zh.md)：L0 仿真 → L1 → L2
- [PROPOSAL-contextgc.zh.md](PROPOSAL-contextgc.zh.md)：指针摘要替代有损压缩
- [CONTEXT-GC-GUIDE.zh.md](CONTEXT-GC-GUIDE.zh.md)：接管与回滚
- `eval/oracle-analysis.mjs`、`eval/simulate-boundary-prune.mjs`（可复现本文数字）

**外部**

- Anthropic, *Effective context engineering for AI agents*, 2025-09-29 —
  <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- Chroma, *Context Rot* — <https://research.trychroma.com/context-rot>
- Lindenbauer et al., *The Complexity Trap: Simple Observation Masking Is as
  Efficient as LLM Summarization for Agent Context Management*, NeurIPS'25 DL4C —
  <https://arxiv.org/abs/2508.21433>
- Zhang et al., *Agentic Context Engineering (ACE)*, ICLR 2026 —
  <https://arxiv.org/abs/2510.04618>
- Rasmussen et al., *Zep: A Temporal Knowledge Graph Architecture for Agent Memory* —
  <https://arxiv.org/abs/2501.13956>
- Chhikara et al., *Mem0: Building Production-Ready AI Agents with Scalable
  Long-Term Memory* — <https://arxiv.org/abs/2504.19413>
- Xu et al., *A-MEM: Agentic Memory for LLM Agents* — <https://arxiv.org/abs/2502.12110>
- *LongMemEval*, ICLR 2025 — <https://arxiv.org/abs/2410.10813>
- Yao et al., *τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World
  Domains* — <https://arxiv.org/abs/2406.12045>
- *The Horizon Gap*（long-horizon / long-context / long-term memory 的测量综述） —
  <https://arxiv.org/abs/2608.06663>
- *Sleep-time Compute* — <https://arxiv.org/abs/2504.13171>
- Anthropic, *Context management / memory tool* —
  <https://www.anthropic.com/news/context-management>
- Anthropic API, *Context editing* / *Compaction* —
  <https://platform.claude.com/docs/en/build-with-claude/context-editing>、
  <https://platform.claude.com/docs/en/build-with-claude/compaction>
- Claude Code, *Explore the context window* —
  <https://code.claude.com/docs/en/context-window>
- Claude Code, *Memory*（MEMORY.md 索引 + 按需读取，200 行 / 25KB 上限） —
  <https://code.claude.com/docs/en/memory>
- Kevin Liao, *Agents Don't Need Memory. They Need Documentation.*, 2026-10 —
  <https://liao.gg/blog/agents-dont-need-memory>
- OWASP GenAI, *Memory Is a Feature. It Is Also an Attack Surface*, 2026-05 —
  <https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface/>
- AgentPoison（记忆/知识库投毒） — <https://arxiv.org/abs/2407.12784>
- *Zombie Agents*（自强化记忆注入） — <https://arxiv.org/abs/2602.15654>

> 注：外部数字均来自各论文摘要/官方文档，未在本地复现；标注为【外部】。DSH 行为以
> `@deepseek-ai/dsh@0.2.0-rc.2` 安装包为准（`dsh-base/cordis.patch.yml` 的
> `spill-policy: maxInlineTokens: 12500` 等）。
