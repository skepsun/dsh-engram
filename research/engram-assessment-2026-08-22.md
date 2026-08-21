# dsh-engram 全局再评估 · 2026-08-22（手动重启后）

> 视角：**极简 / 零 LLM / 对编程有益 / 节省 token**。
> 现状：host 源码 ~3,730 行（不含 build 产物 client.js 4,925）；13 个工具；
> 12 个设置键；7 张数据表（memories/tasks/links/entities/usage/observations/models）；
> 全链路零 LLM 调用（已 grep 确认，仅客户端文案出现"LLM"字样）。

## 0. 四维 × 部件评分（5=满分）

| 部件 | 行数 | 极简 | 零LLM | 编程有益 | 省token | 评注 |
|---|---|---|---|---|---|---|
| store (BM25+GC+dedupe) | 833 | 3 | 5 | 4 | 4 | 核心，健康 |
| tools (14 工具) | 714 | 2 | 5 | 4 | **2** | description 过肥 |
| api (REST) | 486 | 3 | 5 | 3 | n/a | 治理面合理 |
| index-block ([ENGRAM] 注入) | 193 | 4 | 5 | 4 | 5 | 每会话 12 行/700ch |
| capture (auto-capture) | 208 | 4 | 5 | 3 | 5 | 提取器偏少（缺文件锚）|
| obs (observations) | 202 | **2** | 5 | 2 | 3 | 第二套表示，可派生 |
| mental (esr_model) | 170 | 4 | 5 | 3 | 4 | 有 brief 预算 |
| usage+sessionstats | 209 | **2** | 5 | 1 | n/a | 纯仪表盘 |
| settings | 98 | 3 | 5 | n/a | 4 | 12+ 键略多 |
| rerank/util | 226+50 | 4 | 5 | 4 | 4 | 轻，共享良好 |

## 1. 过度设计（按收敛收益排序）

1. **工具 description 过肥（最大的 token 漏点）**——13 工具 description 合计 ≈4,950 字符
   ≈1.3–1.7k token，**每次模型请求都随 schema 进入上下文**。最肥：esr_close 642、
   esr_model 553、esr_node 510、engram_recall 481、esr_gc 427。
   → 压到一句话（≤200 字符/工具）可省 ~700+ token/请求，agent 高频 loop 收益直给。
2. **observations 作为落库的第二套表示**（202 行）——`integrateObservation` 在主写入路径
   （storeMemory/revive）做副作用；与「hits=证明计数」职责重叠。
   → 降级为**派生视图**：recall 时对候选里 `hits>=2` 的记忆现场投影「×N 证据」，
   不落表、不进写入路径、GC 少一类。
3. **usage.js + sessionstats.js 双统计层**（209 行，纯观测）——一个记账插件自身调用，
   一个扫描 session.jsonl 数 todo vs esr。不服务模型行为。
   → 合并为一个 usage 函数，sessionstats 挪到 API 层按需计算（GUI 请求时才跑）。
4. **配置面 12+ 键**——多数有默认、很少被调。
   → 收敛：只暴露 autoCapture / expireDays / maxRecallPerSession / indexMaxChars 四个调点，
   其余固化为默认（schema 仍可配，但 UI 只显 4 个）。
5. **文档-实现漂移**——index.js 头注释仍写「six tight tools」，现实 14 个。
   → 主/辅工具分层：主 = engram_store/recall/detail + esr_task/close/ready（日常），
   辅 = esr_link/dep/claim/unclaim/node/gc/model（进阶），description 里点出层级。

## 2. 遗漏（四维×编程增益）

1. **filePath 锚缺失（对编程受益最大、最轻的高杠杆项）**——error/decision 记忆不锚定到
   文件，同文件重犯只能靠文本相似 revive。MemorySchema 加可选 `filePath`（zod nullable）；
   capture/engram_store 接受 filePath；recall 行尾显示 `· path`；同 path 重犯 revive 提权。
   确定性、零 LLM、~40 行。
2. **repo 级上下文绑定**（MemoraX repositoryKey 启示）——engram 已用 workspace=cwd 隐式隔离，
   足够；不必新增（补一句文档即可）。
3. **token 面已基本齐**：index 12 行/会话、recall limit≤50 默认 12、engram_detail 按需。
   唯一可再省的是上面第 1 条（schema 瘦身）+ observations 节只在命中高时输出（已触发式）。

## 3. 简单、统一而可靠的全局架构：四个 primitive + 视图化

把现在七张表的世界收拢成四个 primitive，一切输出都是它们的确定性投影：

- **Item**（记忆，含 kind · text · tags · entity · filePath? · sessionId#seq · hits ·
  lastAccessAt）——memories 一张表即可表达，task 只是 kind=task 的 Item + 状态机。
- **Relation**（source --rel--> target · confidence）——task 依赖（dep/blocks）、entity 图
  （esr_link/node）、未来的 supersede/contradicts（候选③）全走这一张边表，不加新表面。
- **State**（active/archived；task 的 draft→active→stable 只是同一字段上的幂等状态机；
  GC 只对 archived 做）——GC/过期/retention 统一为「状态翻转」。
- **Provenance**（workspace × sessionId#seq）——所有隔离与审计的根，已存在。

所有「功能」都是视图：
- recall = BM25 排序视图；[ENGRAM] 注入 = 12 行摘要视图；esr_model = 压缩摘要视图；
  observations = hits 派生证据视图；stats = 按需统计视图。

收敛路线（不破坏现有数据/接口）：
1. 工具 description 瘦身 + 主/辅分层（token 直省）
2. observations 表→派生（去掉主写入副作用，host 减 ~150 行）
3. usage/sessionstats 合并按需（GUI 时才算）
4. MemorySchema + filePath 锚（编程受益）
5. 设置 UI 收敛为 4 调点

## 4. 落地顺序（估成本，全部纯规则/确定性）

| P | 项 | 收益 | 成本 |
|---|---|---|---|
| P0 | 工具 description 瘦身 + 主/辅分层（schema −55%） | 省 ~700 token/请求 | ✅ `4608318` |
| P1 | filePath 锚（schema+capture+recall+revive+capture error-first） | 编程受益最大 | ✅ `76de2ad` |
| P2 | observations 派生化（去副作用/派生视图，−180 行） | 减复杂度 | ✅ `ed9d0fa` |
| P3 | 统计合并为单一日志模块（热路径零写入） | 减复杂度 | ✅ `b3e4a74` |
| P4 | 设置 UI 收敛 4 调点（常用+高级折叠） | 极简 | ✅ `9693900` |
