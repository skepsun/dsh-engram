# dsh-loom

> **[中文](README.zh.md) · [English](README.md)**

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 设计的极简长期记忆插件，融合了
[pi-loom](https://github.com/skepsun/pi-loom) 与 [pi-esr](https://github.com/skepsun/pi-esr) 的思想——
目标只有一个：**省 token**。

- **零 LLM 摄入** — 纯模式匹配从工具结果自动捕获有意义的事件（git 操作、关键文件编辑、反复出现的错误），
  另有显式 `loom_store`。热路径上没有任何模型调用。
- **符号索引 + 渐进披露** — 一个紧凑的 `[LOOM]` 块（默认预算 700 字符 ≈ 175 token；每条记忆一行）在
  组装提示词时注入，并**按会话冻结**，让请求前缀字节稳定以复用 KV 缓存。模型需要细节时用
  `loom_recall` / `loom_detail` 下钻，而不是把命中的原文灌进上下文。
- **ESR-lite 证据闭环** — `esr_task` / `esr_close` / `esr_link` 给任务一个 `draft → active → stable`
  生命周期，其中 `stable` 必须要有真实证据（`artifact` / `evaluation` / `memory_ref`），把"缺什么"
  摊在明面上，而不是让 agent 没有证据就宣布完成。
- **Web 查看器** — 一个带统计的记忆浏览器和配置卡片，完全构建在 DSH 原生设置槽位上（不碰任何第三方 UI 包）。

```
MIT   ·   node >= 22.19   ·   host 半边 + 浏览器半边合在一包
```

## 为什么还要一个记忆插件？

对既有 DSH 插件生态的调研显示，记忆领域里"召回桥 / 审批门 / LLM 蒸馏 / 向量+图"这几个方向已经挤满了。
dsh-loom 补的是对 token 纪律真正重要的三个空白：

1. **写入路径没有模型** — 捕获是确定性的模式匹配。
2. **提示词里不灌原文** — 只注入有界的符号索引，检索按需进行（"检索到 ≠ 注入"）。
3. **诚实的任务闭环** — 没有证据就不能宣布 STABLE。

DSH 已经提供跨会话 FTS（`ctx.sessionQuery`）、存储（`ctx.storageDomain`）、提示词注入钩子和设置槽位；
dsh-loom 只是这些能力之上的一层薄组合层，而非重新实现。

## 安装

```sh
# 从 GitHub（本仓库）
dsh plugin --profile web add github:skepsun/dsh-loom

# 发布到 npm 之后
dsh plugin --profile web add dsh-loom

# 本地开发（符号链接——改动立即生效）
dsh plugin --profile web add link:/path/to/dsh-loom
```

然后**重启 `dsh web`**。数据保存在 `~/.dsh/storages/dsh_loom.json`。

> 需要新建会话才能看到注入的 `[LOOM]`/`[ESR]` 块和六个工具——提示词与工具注册表都是按会话装配的。

## 在 Web 端能得到什么

重启后，全部落在 **DSH 原生**设置界面里：

- **设置 → Loom 记忆** — 概览统计卡片（各工作区/类型的计数、自动捕获总量、各工作区 `[LOOM]` 索引
  token 估算）、可搜索/可过滤的记忆表格（含归档与删除操作）、ESR 任务看板（含证据缺口）、以及关系列表。
- **设置 → Plugins → dsh-loom** — 绑定 `dsh-loom` 设置命名空间的配置卡片；改动对新建会话即时生效
  （已冻结的块保持稳定）。

浏览器半边由 DSH 的 client-module loader 直接从本包提供（`dsh.client` + `exports["./client"]`，无需重建
web 应用）；数据来自 loopback 围栏保护的 `/api/dsh-loom/*` 路由族。修改 `client/src` 后重建 bundle：

```sh
npm run build:client
```

## 工具

| 工具 | 用途 | 类型 |
|---|---|---|
| `loom_store` | 显式存入一条记忆（kind、tags、可选实体锚点） | 写 |
| `loom_recall` | 工作区记忆的确定性关键词召回；可选 `search_sessions` 跨会话 FTS | 读 |
| `loom_detail` | 一条记忆 id 的完整记录（来源、标签、命中数） | 读 |
| `esr_task` | 创建任务实体（draft → active） | 写 |
| `esr_close` | 按证据协议关闭任务（artifact + evaluation + memory_ref） | 写 |
| `esr_link` | 在两个实体之间添加类型化关系（迷你图） | 写 |

## 注入块

模型实际看到的内容（每个会话渲染一次，然后冻结）：

```
[LOOM] workspace: pi-loom · 2 memories · 1 task(s) active · 0 links
[D] 06-18 Decided: use sqlite-vec for retrieval #a2331d87
[T] 06-18 Retrieval upgrade — ACTIVE · gap: artifact, evaluation, memory_ref #tsk_8b26
drill: loom_recall <query> | loom_detail <id> | esr_task / esr_close / esr_link

[ESR] tasks: 1 active / 1 stable
- tsk_0d: Retrieval upgrade — ACTIVE · gap: artifact, evaluation, memory_ref
- closed: tsk_9a (RAG eval)  ·  +1
```

前缀：`[D]` 决定 · `[E]` 错误 · `[P]` 流程 · `[F]` 事实 · `[I]` 洞察 · `[H]` 交接 · `[T]` 任务。
`#` id 通过 `loom_detail` 取完整记录。

## 配置

默认值以 token 为优先；可通过 profile 补丁（`~/.dsh/profiles/web/cordis.patch.yml`）或 Web 配置卡片覆盖任意键：

```yaml
- id: loom
  config:
    autoCapture: true        # 零 LLM 工具结果捕获
    sessionSearch: true      # loom_recall 也可对历史会话 FTS
    autoCapturePerSession: 40
    indexMaxLines: 12        # [LOOM] 行数上限
    indexMaxChars: 700       # [LOOM] 字符上限（token 预算）
    minIndexSignal: 0.4      # 低于此信号的自动捕获不进索引
    promoteHits: 3           # ……直到被召回这么多次才进索引
    expireDays: 180          # 记忆 TTL（0 = 永不过期）
    maxMemoriesPerWorkspace: 2000
    loomIndexOrder: 40       # systemPrompt section 顺序（位于 tools 段之前）
    esrOrder: 41
```

## 开发

```sh
npm test            # 15 个测试：核心 + Web API（node:test）
npm run build:client
```

仓库结构：`lib/`（宿主半边：store / capture / index-block / tools / api / settings）、
`client/`（浏览器半边，TSX + `build.mjs`）、`test/`（node:test）。

## 相关项目

- [pi-loom](https://github.com/skepsun/pi-loom) — 原始跨会话记忆插件（5 信号 RRF 融合、sqlite-vec、Dream Engine）。
- [pi-esr](https://github.com/skepsun/pi-esr) — 项目全周期的证据驱动任务状态；这里的闭环协议是它的简化形态。

## 许可

MIT
