# dsh-engram 已交付 UI 控件清单

> 中文交付说明。英文总览见 [README.md](./README.md)。
> 全部为客户端控件（`client/src/*.tsx`），除特别注明外 **改完即生效**（client-hmr 自动推送，无需重启 `dsh web`）。

## 一览

| # | 控件 | 入口 | 提交 | 宿主依赖 |
|---|------|------|------|----------|
| 1 | 关系图谱（力导向 SVG） | 设置 → Engram 记忆 →「关系图谱」· 侧栏 ESR 看板「图谱」 | `4646fb4` | — |
| 2 | 全屏 ESR 任务看板 | 侧栏「ESR 看板」入口（带实时活动任务徽标） | `548f8f6` / `7b4229e`(修复) | — |
| 3 | [ENGRAM]/[ESR] 注入预览 | 设置 → Engram 记忆 →「注入预览」 | `9fd46d5` | ⚠️ 需重启（见下） |
| 4 | 证据进度环 | 看板任务卡 + ESR 任务行 + 看板头部聚合环 | `b4109fa` | — |
| 5 | 遥测仪表盘 | 设置 → Engram 记忆 →「遥测」 | `9c88ebd` | — |
| 6 | 详情侧栏（主从布局） | 设置 → Engram 记忆：任务/记忆/节点/关系行「详情」 | `d090d3d` | — |
| 7 | 工作区切换 chip | 输入框上方「任务」统一条（dock）首部 | `d4d58b3` | — |
| — | 统一任务条（合并内建 todo） | 输入框上方「任务」统一条 | `6f864b3` | — |

## 详情

### 0. 统一任务条（前置基础，`6f864b3`）
接管 DSH 内建 todo 的 dock 槽位（`conversation.input.dock` / `id: todo`，更低 `priority` 遮蔽内建
TodoPanel），把两套任务平面合并成一个控件：会话当前计划（`todo_write` 的 `todos` 投影）
+ 工作区持久 ESR 任务（证据缺口徽标 + 内联「补齐证据 → 关闭」）+ 关系图芯片。
有内容才显示，15s 轮询保持实时；loopback 围栏 API 不可达时内建计划仍照常渲染。

### 1. 关系图谱 — `4646fb4`
手写 SVG 力导向图（无第三方图库，bundle 纯净）：实体为圆形节点、任务为勾选徽标、
关系按类型着色带方向箭头；拖拽节点 / 平移 / 滚轮缩放 / 重组；悬停高亮邻域、
点选节点弹出悬浮面板看全部关系；悬空链接单独计数提示。

### 1aaaaaaaaaaa. Beads 三连：依赖图 + 可逆压缩 + 预算注入 — 上述之后
借鉴 https://github.com/gastownhall/beads（Go+Dolt 的分布式图式 issue tracker），纯规则落地：
- **依赖图 + ready 队列 + 原子 claim**：tasks 加 deps[{id,kind}]/assignee/claimedAt；addDep 防自引用与
  有向环；blocked 状态**纯派生**（blocks/parent-of 目标未闭环即阻塞，relates-to 不阻塞），关闭即解锁；
  `esr_ready` 列出无 blocker 未认领的可认领队列；`esr_claim`/`esr_unclaim` 带 anti-yank fence
  （他人持有需 force 才能抢/放）；board 卡显示 🔒 blocker 计数与 @assignee。
- **可逆压缩**：esr_close 闭环长描述（>240 字符）自动规则 summary（首行≤140）+ snapshot 存全文快照
  （零 LLM，先归档再覆盖同序）；board 显示 🗜 摘要；原文保留可回看。
- **预算注入（prime 模式）**：esr_model 加 mode=full|brief（brief≈50-token 单行摘要，从 full 派生
  永不漂移）+ max_chars 截断；会话开始建议用 brief，按需用 full。
host 侧随下次重启生效；board 三处 client-hmr 即时。宿主 84/84、dock 63/63、board 59/59。

### 1aaaaaaaaaa. Hindsight 三连：证据观测 + 常驻摘要 + 证据重排 — 上述之后
借鉴 vectorize-io/hindsight（https://github.com/vectorize-io/hindsight）三个概念，全部
纯规则 / 零向量 / 零 LLM：
- **观测（observations）**：esr_* 记忆写入后自动浓缩 — 同锚点（entity/共享 tag）+ 字符
  bigram Jaccard≥0.45 才并桶；merge 而非覆盖（proof 计数=唯一来源条数，失败复活视为新
  发生 → forceEvidence 爬 proof，exact 重复只刷时间）；反证计数削弱；趋势 30/90 天窗口
  算法算（new/strengthening/stable/weakening/stale）；每 ws 上限 50 逐出低证据。engram_recall
  注入 proof≥2 的观测段；board 可折叠「观测 · 信念 N」条。
- **常驻摘要（mental model）**：`esr_model` 工具 + `/model` 端点返回工作区预计算 markdown
  摘要（任务/实体图/观测/记忆种类/风险），零 LLM；esr_* 写操作置 dirty → 读时重算，
  10 分钟强制兜底 + 输入 hash 校验；board 顶部「常驻摘要 · 生成于 N 分钟前」可折叠条。
- **证据重排**：bm25Rank 词法分上乘 evidenceBoost（1+0.1·min(hits,5)）——被证明过 N 次的
  记忆同词频下排前；hits 由失败复活路径供给，失败记忆更容易被召回。
host 部分（rerank、/observations、/model、esr_model、dirty 钩子、观测浓缩）随下次重启生效；
board 两条（观测/常驻摘要）client-hmr 即时生效。宿主 67/67（新增 rerank 5 + obs 12 + mental 6）。

### 1aaaaaaaaa. 看板批量闭环 + markdown 导出 — 上述之后
全屏看板：每张非 draft/stable 卡头加勾选框，选中后工具栏出现「批量闭环（N）」——
一次填 artifact/evaluation/memory_refs 应用到所有选中任务（单卡已有证据自动保留）。
「导出」把当前筛选视图（含搜索/工作区过滤）生成 markdown 表（状态/任务/工作区/证据缺口/
证据/创建），下载 `esr-tasks-YYYY-MM-DD.md`。传参逻辑抽成纯函数 buildCloseEvidence、
导出抽成 buildTasksMarkdown，可单测。client-hmr 即时生效。

### 1aaaaaaaa. 实体建模引导（node/link 全零的解药）— 上述之后
针对 esr_node/esr_link 从没被调用过：agent 侧 `esr_task`/`esr_close`/`esr_node`
返回统一追加一行 `modeling:` 提示——无实体图时引导「用 esr_node 建模反复出现的领域对象、
再 esr_link 关联」；有图时展示 `entities x… / links y` 并提示可把新任务/节点并入。
web 看板头部在该范围实体数为 0 时显示「实体建模」引导条（同样指向 设置 → Engram 记忆 的
实体图）。host 部分随下次 `dsh web` 重启生效；看板条 client-hmr 即时生效。

### 1aaaaaa. 使用率迷你可视化（todo vs ESR vs 记忆）— 上述之后
dock 展开态顶部新增行为统计条：host 新端点 `/api/dsh-engram/toolstats?days=14`
读取会话日志真源（`~/.dsh/sessions/*/*/session.jsonl.zstd`，`type:"tool/call"` 计数，
60s 缓存、mtime 窗口过滤），返回全工具调用计数——**含原生 todo**（usage 表记不到的）。
dock 显示「近 14 天 · todo N · ESR M · 记忆 K · 调用 N」，ESR 为零且 todo 大于零时
附带一行「ESR 为零，todo 可用『沉淀到 ESR』转草稿」提示。注意：该 host 端点需
`dsh web` 重启一次注册（与 /preview 相同），此前 dock 统计行静默隐藏。

### 1aaaaa. todo → ESR 一键沉淀 — 上述之后
计划区新增「**沉淀到 ESR（N 项）**」按钮：把本轮未完成的 todo 项一键转成该工作区的
ESR 任务草稿（名称=todo 原文，描述标记「源自会话计划」），转完自动刷新 ESR 网格；
同一会话内按内容去重（防重复建），按钮常显「已沉淀 N 项」。直接补上漏斗最窄处
（todo 多、esr 少）。

### 1aaaa. dock 移除关系列表 — 上述之后
dock 删除「关系」区块（`source --rel--> target` 列表、`esr_node/esr_link` 建模提示、
工具栏「关系 N」计数 chip），也不再请求 links/nodes 端点（dock 每轮少 2 个 API 调用）。
关系与实体展示全部交给**实体图**（设置 → Engram 记忆，圈 1 关系图谱）；dock 只管任务。

### 1aaa. dock ESR 卡片分页 + 尺寸约束 — 上述之后
ESR 任务卡支持**分页**：每页 9 张（3 列 × 3 行），任务多于 9 张时网格下方出现
`共 N · 1/3 ‹ 上一页 下一页 ›`（首页/末页自动禁用，任务数变化自动 clamp 页码）。
卡片宽度固定为 **220px 列宽**（`repeat(auto-fill, 220px)`，不随 1fr 拉伸）、
默认行高统一（`minHeight 34`），名称超宽省略号截断——整卡尺寸稳定、不再参差。
**二次精简**：状态不再用文字徽标，改为名称后的 **7px 状态色点**（完整标签与缺口清单
在 tooltip）；「补齐证据」按钮从常驻**移入展开详情区**（点行展开后才出现）。
默认每张卡 = `▸ 任务名 ●` 一行，零按钮零徽标带。

### 1aa. dock ESR 卡片精简 + 多列布局 — 上述之后
ESR 任务卡默认只显示**单行摘要**：名称 + 状态徽标（`ACTIVE·缺口数` / `READY` / `STABLE`）+
「补齐证据」按钮；描述、缺口 chips、memory refs、时间与 id 点开行才展开（再点收起）。
卡片呈**响应式多列网格**（`auto-fill minmax(210px,1fr)`：宽条 3 列 → 窄条 1 列），
同一会话多任务不再纵向堆叠成高条，dock 保持紧凑。

### 1b. 任务来源分栏（原生 todo vs ESR）— `1ecbd6d` 后
统一任务条给两套平面打上来源徽标：「**原生 todo · 会话内**」（随会话结束）与「**ESR · 跨会话闭环**」
（带证据门、进 [ENGRAM]），并在「只有 todo 没有 ESR」时给出引导行（建议多步工作用 esr_task 沉淀）。
全屏看板头部同样在图例中明示「仅 ESR · 会话内 todo 见输入框上方任务条」，并在列上方加了分栏说明条——
漏斗一眼可见，避免「todo 一直建、esr 长期空」而不自知。

### 2. 全屏 ESR 任务看板 — `548f8f6` + `7b4229e`
侧栏「ESR 看板」入口（实时活动任务数徽标，30s 轮询 /overview）。点击打开中间列全屏看板：
**草稿 / 进行中(证据缺口) / 就绪(证据齐) / 已闭环** 四列 + 工作区筛选 + 搜索 + 内联新建 +
每卡「补齐证据 → 关闭」表单（与 `esr_close` 同一证据门）。DOM 级挂载自愈、
跨面板互斥（task-board/ssh）；对话子树保持挂载，切换零状态丢失。
头部加「**看板 / 图谱**」切换：图谱视图直接复用 §1 的关系图谱（esr_node 实体圆节点 +
esr_task 勾选徽标，拖拽/缩放/点选查关系明细），并跟随工作区筛选；图谱模式下
隐藏任务系操作（新建/导出/批量闭环），底栏计数同步切换。
**`7b4229e` 修复**：激活属性与容器 HTML 属性重名导致 `<html>` 自身被 `display:none` 整屏白屏——
激活标记改为 `html[data-dsh-engram-board-active]`，与容器 `[data-dsh-engram-board]` 分离。

### 3. [ENGRAM]/[ESR] 注入预览 — `9fd46d5`
与 systemPrompt 完全相同的纯函数实时渲染模型每个会话看到的注入块，逐字一致可审计：
左 `[ENGRAM]` 索引块（order 40，会话内冻结一次）+ 右 `[ESR]` 任务/闭环块（order 41）。
终端风双栏、行级着色（块头 / 任务行 / `drill:` / 数据驱动 `escalate:` 提醒高亮）、
每块行数·字符·~tokens 芯片 + 记忆/任务/关系/节点计数、20s 自动刷新、一键复制原文、
工作区下拉（全部工作区视图下自动落第一个）、空块友好提示。
后端新增 `service.renderEsrBlock()` + `GET /api/dsh-engram/preview?workspace=…`。

> ⚠️ **需重启**：`/preview` 是新宿主路由，`dev_reload_package` 只清入口模块缓存、
> `lib/api.js` 仍是旧实例——必须完整重启 `dsh web` 才注册。重启前页签可见但显示 `not found`。

### 4. 证据进度环 — `b4109fa`
纯 SVG 三弧圆环 `EvidenceRing`，对应 `esr_close` 三道证据门
（artifact · evaluation · memory_ref）：
- 每张任务卡（看板 + ESR 行）：全绿 = 证据齐可闭环、琥珀 = 有缺口（画几道亮几道）、灰 = 无证据；
  悬停 tooltip 显示每门 ✓/✗，≥28px 中心显示 `n/3`
- 看板头部**聚合环**：全部进行中任务的证据完备度（%）+ 就绪数，一眼看清整盘闭环进度
- fraction 模式复用于遥测仪表盘的大圆环

### 5. 遥测仪表盘 — `9c88ebd`
把 `/stats` 的真实调用累计（工作区 × 天滚动）画成纯 SVG 仪表盘：
- 三枚 64px 大圆环：**ESR 主动性**（与 escalate 阈值 0.34 比对，偏低标橙 + 提示）、**
召回命中率**、**detail 转化**
- 五张小指标卡：累计调用 / esr_* / 记忆类调用 / 平均命中每查询 / 失败
- 近 14 天 **mem-vs-esr 堆叠柱状图**（每柱悬停明细）+ **工具调用 Top 8** 横向条形图
  （mem 蓝 / esr 紫）
- 20s 自动刷新 + 手动刷新；样本不足（<10 次）自动标注；错误/空态优雅处理；
  支持全部工作区或按单工作区

### 6. 详情侧栏（主从布局）— `d090d3d`
设置 → Engram 记忆 内，ESR/记忆页右侧粘性详情卡（320px）：
- **任务**：状态徽标 + 证据进度环 + 完整 id/工作区/时间线 + 描述 + 缺口清单 +
  可点击记忆引用 + 独立「补齐证据 → 闭环」表单（成功后联动刷新）
- **记忆**：类型徽标、全文、标签、signal/hits/TTL、来源会话/序号元数据
- **节点**：名称/kind/描述 + 全部入射出射关系（按类型着色、方向、置信度）
- **关系**：两端实体名解析 + 类型 + 置信度 + 元数据
- 各行「详情」入口（任务/记忆按钮、节点/关系整行可点）；任务记忆引用跳转直达，
  不在已加载列表时给琥珀提示；sticky 布局、零壳层耦合

### 7. 工作区切换 chip — `d4d58b3`
统一任务条首部的 chip：
- 默认**跟随当前会话**（tooltip 明示）；下拉列出框架注册表全部工作区
- 选中即把 ESR 任务/关系来源**固定**到该工作区（✓ 标记 + chip 标题「已固定到 X」），
  即时重取并保持 15s 轮询；× 或「跟随会话」恢复
- 点 chip 不会误触头部分栏（stopPropagation）、点外部收起、键盘可达；
  菜单注脚说明内置 todo 仍属本会话
- **设计取舍**：宿主没有干净的会话 cwd 切换 API，且改 `session.header.cwd` 会破坏
  「注入块按会话冻结 → 前缀稳定复用 KV 缓存」的架构，故做成纯 UI 焦点切换，不动模型上下文

## 研究定位与主流对照（2026 年市场/论文调研结论）

三条来自学术与市场的支撑性结论，写进文档是为了让后续维护者知道「为什么不照抄主流」：

1. **Experience vs Memory 两轴**（清华 Awesome-Memory-for-Agents 分类）：经任务结果**显式校验**的
   知识（Experience）与未经校验的信息（Memory）本就是两条路——我们的 **ESR 证据闭环 = Experience**、
   平铺 [ENGram] = Memory，恰好落进这个两轴；「Learning from Experience」方向的 PROJECTMEM
   失败重试警告，我们以 **escalate 提示 + 失败记忆复活**（已落地）做了零 LLM 的实现。
2. **小规模不需要 RAG**（Salesforce ConvoMem：《Why Your First 150 Conversations Don't Need RAG》）：
   记忆系统从零增长，工作区级（百级）语料下关键词检索足够——我们的「无向量 + 进程内 BM25 + 实体锚定」
   路线由此获得学术背书；mem0 新算法也把 **BM25 关键词与时间感知**列为多信号检索的一路（semantic +
   BM25 + entity + temporal），我们已具备 keyword / entity / temporal 三路，唯一不在的是 semantic（刻意）。
3. **零 LLM 热路径是差异化的企业级事实**：claude-mem（91k★）靠后台 LLM worker 做语义摘要，mem0
   每条写入调一次 LLM（官方标注 ~1s 延迟）；我们每次写入 0 模型调用、前缀按会话冻结复用 KV cache
   （IAAR 综述把 KV 复用列为短期记忆标准技术）。如果要对外宣传「省 token」，这是可量化的卖点。

据此，召回已补上 **时间衰减因子**（bm25Rank 乘性 recency，半衰期 14 天、最大 +50%，不覆盖强相关）
与 **实体邻域展开**（recall 命中实体锚定记忆时，附该实体生于 esr_link 关系简表，≤8 行，纯复用现有表）。

**明确不采纳**：向量库/语义去重、LLM consolidate 后台管理器、自编辑记忆块（Letta 路线，与冻结前缀
相悖）、多跳图推理、图数据库、角色档案、视频记忆——全部与「零 LLM + 符号 + 极轻」定位冲突。

## 近期的三处核心增强（复用 DSH 本身）

- **证据硬核化（verifyArtifact）**：`esr_close` 的非 URL artifact 会按工作区（= DSH 提供的会话
  cwd）解析并在磁盘上实存校验；不存在则任务保持 ACTIVE 并给出原因（`force:true` 跳过磁盘校验，
  三种证据门仍必填）。工具与网页表单共享 `store.evidenceGate` 单一证据门，口径不漂移。设置里
  有「校验 artifact 存在」开关（DSH 自家 schemastery 表单，即时生效）。
- **BM25 召回 + 时间衰减 + DSH 会话索引兜底**：`engram_recall` / 记忆搜索对内存池做进程内 BM25
  排序（TF·IDF + 标签/短语加权 + 乘性时间衰减因子，确定性、零依赖、不建 SQLite）；本地零命中时
  自动复用 DSH 自带的跨会话全文索引（`ctx.sessionQuery`，按 cwd 过滤）作为兜底，原来的
  `search_sessions` 显式开关保持兼容。
- **失败记忆复活（repeat-failure revival）**：capture 到与某条既有 `error` 记忆**高度同源**的失败时
  （接口：≥2 个 token 重叠且覆盖较小集 ≥60%，弃权判定），不再新开一条，而是**唤醒旧条目**——
  刷新 recency + 命中 +1；重复失败把它推向 `promoteHits` 门槛，最终在 `[ENGRAM]` 里重新冒头
  （projectmem「重复失败前预警」的零 LLM 版本）。只对 error 记忆生效，fact/decision 等不受影响。

## 工程约定（复用时请遵守）

- **无图表库**：图谱/仪表盘/圆环全部手写 SVG，`lib/client.js` 保持纯净（运行期只依赖 react 系）
- **主题**：一律走 `--dsw-alias-*` / `--dsh-color-*` token + 兜底值，勿硬编码界面色
- **看板挂载先例**：DOM 注入用**独立的 HTML 属性名**标记激活态（`data-dsh-engram-board-active`
  与容器 `[data-dsh-engram-board]` 必须分开，否则 `<html>` 属性自匹配会整屏隐藏）
- **宿主路由改动**需完整重启 `dsh web` 才生效（热重载不清依赖模块缓存）；新路由先在
  `test/api.test.mjs` 用 `makeEngramRoutes` 单测覆盖
- **中文文本**进 esbuild 包后以 `\uXXXX`（大写 hex）存储，grep 校验时注意大小写

## 验收口径

- 每次改动后跑：`npm test`（宿主单测，当前 31/31）+ 各客户端无头套件
  （看板 21、注入预览 15、遥测 19、证据环 7、详情 22、dock-chip 11 —— 全绿）
- 客户端改动依靠 client-hmr 即时生效；仅「注入预览」路由需重启
