# dsh-engram 改进方案 · ResultPack(工具结果边界剪枝 + 可召回归档)

> 依据:[SoL-Pi](https://nvlabs.github.io/SoL-Pi/) 四幸存机制之二(ObservationPack:归档载荷、上下文留 handle+摘录、按页召回)
> 与提案池 C11「Reduce tool output before its first prompt insertion」/ C23「Build observation packs before paying for full bodies」。
> 数据:[Oracle Analysis](./ORACLE-ANALYSIS.zh.md)(97 真实会话、13.9K 请求、15.0K 工具调用)。
> **状态:提案待审(未实施)。**

---

## 1. 实测问题(为什么是它)

Oracle M1:工具结果重放暴露 **2.77B–7.53B chars(≈692M–1.88B tok 估算)**,占重放+固定开销 21–58%;

- 结果字节 **96% 来自 bash(14.2M)+ read(10.6M)+ run_code(6.1M)**;
- **top-10 结果占会话结果字节中位数 46.1%** —— 少数大结果 × 后续请求数的乘数是浪费本体;
- 浪费不在"单次插入"(三大工具已有界:bash 64KB 尾截+spill 文件、read 行分页、run_code 序列化字节帽),而在于 **有界结果在每个后续请求里整段重放,直到 compaction 改写历史**。

SoL-Pi 的 ObservationPack 正是针对这个乘数:载荷归档、上下文只留 handle+短摘录、需要时按页召回(其配对 EdgeBench:账单 −23.58%)。

## 2. 接缝盘点(已核实 DSH 源码,诚实版)

| 接缝 | 核实结果 | 对 ResultPack 的含义 |
|---|---|---|
| `ctx.on("tools/result")` | 签名 `Readonly<ToolExecutionResult>`,返回 `undefined`,`notifyResult` 冻结且注释明言"不暴露改写通道" | **不能**在分发点改写 |
| `tools.guard()` | 同步检查、返回字符串即否决 | 只能否决,不能改写 |
| `ToolDefinition.finalizeContent` | 定义自有(`defineTool` 时闭包),`applyFinalContent` 在通知前应用 | 只能管**我们自己注册的工具** |
| `ctx.tools.register()` 重名 | 同层重复即失败;scoped 只能 shadow 全局,bash 注册在预设组合层 | **不能**包裹宿主 bash/read |
| **`toolResultPruner` 服务**(`dsh-compaction-tool-result-pruner`) | `pruneSession(session)`:对 surface 上超阈值(`thresholdChars` 8192 / `headChars` 4096 / `tailChars` 1024)的 tool/result 做 **surface-replace**,中段替换为 `[... tool result middle pruned ...]`,前置 `compaction/prune` 影子价事件,replay-safe;纯确定性、零 LLM | **唯一的结果改写通道,且是可注入服务**。宿主今天只在 context-overflow 兜底时调用;调用时机没有任何限制 |
| `BasicCompactionEngine` | "Implementations own trigger policy…" —— 触发策略归引擎所有;pressure/overflow 触发由引擎在 step 边界注册 | 自定义引擎可以引入**新触发时机**(与 PROPOSAL-contextgc 同一接缝) |

> 结论:**严格意义的首插改写(C11)在插件层不可达**(观察者只读、finalizer 定义自有、同层重名失败)——那是上游 PR(给 ToolRuntime 开放可扩展的 finalizeContent 链)。
> 但 DSH 原生的等价物已经存在:pruner 的 surface-replace 可以在**插入后的任何时刻**执行。缺的只是"何时执行"的策略 —— 这正是插件能补的。

## 3. 核心思路:三个层次,逐层验收

### L0 · 反事实仿真(先算后造,SoL-Pi M9「从关键检查点重放备选」)

扩展 `eval/oracle-analysis.mjs`:记录每个会话的 `goal/change`(completed/blocked)seq 与逐请求 seq,离线模拟"在每个 goal 完成边界,对 seq < 边界 且超阈值的结果执行 prune"后的重放暴露变化,扣除重写代价(前缀从首个被替换节点起分叉)。参数扫掠:阈值 {8192, 4096, 2048} × 边界策略 {goal-only, goal+guard N 步}。**产出:预期节省区间 + 最优参数,再决定是否实现。**

### L1 · BoundaryPrune(goal 边界 + 偿还门,纯时机策略)

新 `lib/boundary-prune.js`(~150 行):

1. 监听 goal 完成事件(复用 lib/goal-capture.js 的事件源);
2. 注入 `ctx.get("toolResultPruner")`,对**边界之前**的超阈值结果调 pruner(或带 range 的自实现变体,只剪旧结果,新结果留给活跃任务);
3. **偿还门**(SoL-Pi Online Context Compact 的时钟):`预期剩余请求数 × 节省重放 chars > 重写前缀成本` 才执行。预期剩余请求数用本会话请求速率 × 该 workspace 历史会话长度中位数估计(oracle 数据已给出);
4. 默认**关**,配置卡可开(C13:休眠机制默认关闭)。

与 PROPOSAL-contextgc 正交互补:contextgc 管 pressure 压缩的**摘要内容**(LLM 摘要 → 指针摘要),本提案管**确定性剪枝的触发时机**(overflow 兜底 → goal 边界主动)。

### L2 · ResultPack 本体(pruned 中段归档 + `result_recall` 按页召回)

L1 剪掉的中段今天直接丢弃(仅 session 日志保留原文,模型取不到)。L2 把它补成完整 ObservationPack:

- 剪枝时把中段存入插件存储域,键 = callId,带脱敏(复用 lib/redact.js);
- 注册 `result_recall(callId, offset?)` 工具,按页返回归档中段 —— 与 [ENGRAM] 渐进披露同一哲学:索引行→详情下钻;
- 剪枝结果尾部追加一行 handle:`[middle pruned: result_recall(callId) 可取]`,模型可自主决定是否下钻(M3 遥测将能看到激活率)。

### L3 · 上游提案(严格 C11)

向 DSH 提 PR:ToolRuntime 开放 per-tool 可扩展 finalizeContent 链(或"结果归档 transport")。附上 oracle 数据(96% 集中在三个工具、top-10 占 46%)作为动机。

## 4. 评测与能力下限(预声明,constrained efficiency)

- **效率轴**(L0 仿真给出预期;实现后用 oracle 重跑实测):重放暴露变化、每会话节省 chars×requests;
- **能力轴门**:①recall-bench 不回退(插件行为不变);②人工抽检边界剪枝后的会话,确认无"模型回头要被剪信息"的失败模式(bash 有 spill 文件路径保留在头部、read 本身分页,L1 阶段可恢复性风险低;L2 归档后风险趋零);
- **KV 经济诚实账**:每次剪枝都从前缀首个被替换节点处击穿缓存;偿还门显式计入。1,376 次中途 splice 已常态性击穿前缀,边界剪枝的机会成本并不总是新增的。

## 5. 风险与反面

- **能力损失**:8192 以下的小结果永不剪(pruner 语义),乘数浪费仍在 —— L0 仿真会量化这部分残余;
- **goal 事件稀疏**:实测五个最大会话 goal/change 为 4/0/4/0/2 —— 两个最大会话为 **0**,goal 边界可能根本不出现;备选边界必须有:`todo/write` 完成态、step 空转检测,L0 仿真应把"无 goal 会话"单独归档报告;
- **上游变动**:pruner 是 rc 版本(0.1.2-rc.1)服务,签名可能漂移 —— L1 用 `ctx.get` 探测 + 特性检测,缺席即禁用并告警;
- **过拟合警告**(SoL-Pi Discussion):本方案针对"交互循环的重复浪费"而非任务答案,抗过拟合;但仿真参数不应在评测语料上调到最优再宣称泛化。

## 6. L0 仿真结果(eval/simulate-boundary-prune.mjs,已执行)

语料:77 个 >10 请求的会话,M1 cut 暴露 2.77Bc;缓存价 0.1、break window 5 请求、marker 42c。缓存感知口径:节省按缓存读价 ×0.1 计,重写代价 = 首个被剪节点前的存活前缀 ×0.9 一次性付全价(保守:未扣除更早剪枝已缩小的前缀)。

**覆盖率**:goal/todo 边界存在于 32/77 会话,但它们持有 **79% 的 M1 cut 暴露**(2.19Bc vs 未覆盖会话 583Mc)——机制可达性不是天花板。

| 策略 | 阈值 | naive 上界 | 缓存感知净 | 偿还(中位/p90 请求) |
|---|---|---|---|---|
| goal-only | 8192 | 72Mc(2.6%) | +5.0Mc | 5 / 320 |
| goal-only | 2048 | 219Mc(7.9%) | +19.2Mc | 2 / 299 |
| todo-progress | 8192 | 313Mc(11.3%) | +20.9Mc | 10 / 748 |
| todo-progress | 4096 | 509Mc(18.3%) | +38.0Mc | 7 / 628 |
| todo-progress | 2048 | 670Mc(24.1%) | +51.1Mc | 11 / 527 |
| goal+todo | 2048 | 702Mc(25.3%) | +50.4Mc | 28 / 527 |

**加偿还门**(只 fire 预计能回本的边界,gate=50 请求,剩余请求数取后见之明):

| 阈值 | 无门净 | gate=50 净 | 变化 |
|---|---|---|---|
| 8192 | 21.7Mc | 28.6Mc | **+32%** |
| 4096 | 38.8Mc | 44.5Mc | **+15%** |
| 2048 | 55.0Mc | 61.6Mc | **+12%** |

### 结论(凭数字)

1. **偿还门被数据验证**:所有配置下 gate=50 都优于无门——SoL-Pi Online Context Compact 的"未来节省须偿还重写"时钟不是装饰,是净收益的主要保护者(p90 偿还 527–897 请求:无门时大量剪枝永远回不了本)。
2. **goal-only 是死路**(6 会话、2.6–7.9%):goal 稀疏性实锤。**todo-progress 是主力边界**;goal 只作锦上添花(goal+todo ≈ todo-progress)。
3. **规模与阈值**:T4096 是能力风险与收益的平衡点(18.3% naive / +38–44.5Mc 净);T2048 收益更高(24% / +61.6Mc)但剪 1,817 个结果(是 T8192 的 5.5 倍),**没有 L2 归档就不该开**。
4. **缓存价敏感性**:节省 ∝ 缓存价,代价 ∝ (1−缓存价)。0.1 是保守假设;缓存价 0.25 的服务商上净收益约 ×2.5。
5. 净收益的天花板约 **+62Mc(缓存价口径)/ 702Mc(naive 口径)** ≈ 缓存价池(277Mc)的 22% —— 单机制天花板有限,但这是零 LLM、确定性、默认关的可选开关,且 KV 未击穿部分(短会话/无边界)另有 contextgc 负责。

### L1 实施参数(由仿真直接给定)

- 边界源:`todo/write` 完成数递增(必须)+ goal complete/block(顺带);
- 阈值默认 T4096(head 2048 / tail 512),配置卡可调 T2048–T8192;
- 偿还门:预期剩余请求数 ≥ 50(剩余数用 workspace 历史会话长度中位数估计,oracle 数据已有);
- 默认关,`boundaryPrune` 配置项 + 激活遥测(每次 fire 记一条 `boundary-prune` 事件计数,进 /stats)。

## 7. 决策请求

L0 已完成,数字支持 **L1 进入实现**(todo 边界 + T4096 + 偿还门 50,默认关):预期缓存感知净节省 +44.5Mc/语料(naive 口径 ~500Mc,≈18% M1 cut 暴露),且机制完全确定性、零 LLM、可回退(不 fire 即无副作用)。T2048 与 L2 归档(中段存储 + `result_recall`)绑定,作为 L1 验证后的第二步。

