# Oracle Analysis:真实会话 token 浪费源量化

> 方法论来自 [SoL-Pi](https://nvlabs.github.io/SoL-Pi/)(NVIDIA Labs):**动手造机制之前,先在真实轨迹上量化浪费源**("Oracle Analysis" / M6 "Use issue history and blind failure mining as proposal evidence" / M42 "Choose tasks with mechanism headroom before scaling")。
>
> 工具:`node eval/oracle-analysis.mjs`(流式解压 `~/.dsh/sessions`,零 LLM、确定性、约 90 秒跑完全量)。

## 语料

97 个真实会话日志(3 个 workspace 桶),13,900 次模型请求,15,020 次工具调用,65 轮 compaction,1,376 次会话中途 inbox splice。模型混合 local-vllm deepseek-v4-flash 为主,兼 glm-5.3 / qwen3.8-flash 等。

## M1 工具结果重放暴露(ObservationPack headroom,SoL-Pi C11/C23)

每个工具结果产生后,会在后续每个请求里重放(直到 compaction 改写历史)。exposure = Σ 结果字符 × 后续请求数:

| 口径 | 字符数 | ≈token(chars/4) |
|---|---|---|
| naive(无 compaction 截断,上界) | 7.53B | 1.88B |
| compaction 截断(下界) | 2.77B | 692M |
| 占「重放+固定开销」比重 | 57.6%(naive)– 21.2%(cut) | — |

- **top-10 结果占全会话结果字节的 46.1%(中位数)**——少数巨型输出承载了近一半的重放压力,正是 ObservationPack「归档载荷、留 handle+摘录」的靶子。
- 结果字节来源:**bash 14.2M + read 10.6M + run_code 6.1M ≈ 96%**。截断/归档机制只需覆盖这三个工具即可命中几乎全部暴露。
- 重放最重的会话(解析器开发,549–1,399 请求/会话)单会话重放高达 91–383Mc(23–96M token)——长时程会话正是 SoL-Pi 指出效率差异可测的场景。

**固定开销**(每个请求重发的 system+tools schema):全语料 436Mc ≈ 109M token,平均 ~7.8K token/请求;富预设(43 工具)单请求 schema 41.8Kc。**本插件自身 schema 仅 2.9Kc(≈730 token,占该预设 7%)——插件的开销主张成立。**

## M2 Action-Fusion headroom(SoL-Pi "Action Fusion")

编辑类调用(edit/write/str_replace_editor,共 1,993 次)之后**紧接着**由模型发起 bash(中间隔一次模型决策)的候选:607 次。

- 占全部工具调用 **4.0%**;占 bash 调用 **7.5%**;占步间转移 ~4.4%(SoL-Pi 在 Pi 上测得 12.3%,DSH 上 headroom 更小)。
- 结论:融合编辑+运行为单一工具调用是**上游 harness 的杠杆**,不是插件的;优先级排后。

## M3 engram 机制激活(SoL-Pi M15 "prove mechanism activation")

挂载插件的 66 个会话(全桶):

| 指标 | 值 |
|---|---|
| 有任何 engram/esr 工具调用 | 26/66(39.4%) |
| 显式 engram_recall | 6 会话(9.1%),共 8 次,命中 8/8 |
| engram_detail 下钻 | **0/66** |
| engram_store / esr_* | 76 / 38 次 |

**写路径激活良好,显式读路径近乎休眠**(autoRecallOnStart 的注入不走工具调用,本指标不可见——这本身就是个遥测缺口)。0 次 detail 说明渐进披露的第二层从未被用到:要么索引行已足够(设计成功,上下文成本仅 ~175 token/会话),要么模型从未想到下钻(机制休眠)。区分二者需要新增遥测:**记录每次 [ENGRAM] 注入后本会话是否发生 recall/detail,以及 recall 是否紧随索引覆盖的主题**。

## 副产品发现

- **1,376 次会话中途 splice**(agent/inbox/spliced)是 prompt 前缀抖动(C20)的主要来源,每次都可能击穿 KV 缓存、把重放从缓存价打回全价。
- 65 轮 compaction 集中在长会话;截断口径(naive vs cut)差异即来自它们。

## 下一个机制怎么选(按 headroom 排序)

1. **结果首插压缩(C11/C23)**:对 bash/read/run_code 输出在进入首个 prompt 前归档截断(保头保尾、留 handle、可分页召回)。靶子占结果字节 96%,且与 SoL-Pi 已在配对 A/B 中验证的 ObservationPack 同构。注意 KV 缓存折价与 1376 次 splice 击穿,收益按 token 占用与缓存击穿双口径核算。
2. **激活遥测(M15)**:给 /stats 增加「注入→下钻」漏斗计数,并做一次「仅索引 vs 索引+detail 工具」的 A/B,判定 detail 层是否该保留。
3. **Action Fusion**:作为上游 DSH 提案(4–7.5% headroom),不在本插件做。

## 口径与限制

- token 为 chars/4 估算(CJK 偏差存在,只用于量级)。
- KV 缓存未折价:重放 token 多数走缓存读价(约 1/10),但中途 splice/compaction 会击穿前缀,击穿部分按全价计——真实成本在两者之间。
- exposure 的真值介于 naive 与 cut 之间(compaction 摘要本身仍会重放,未计入)。
- 本机语料为单人三 workspace,非基准任务集;数字用于选机制,不宣称普适。
