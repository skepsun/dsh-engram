# dsh-memory 🧠

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）开发的**跨会话记忆插件**。

基于 YAML 存储的 `remember` / `recall` / `view` / `list` / `forget` / `pin` 工具，支持 **embedding 语义检索**、**标题优先注入**与**两级（session/auto）自动注入**——智能体"天生带着"记忆，无需记得调用工具。

> [English](README.en.md) | 中文

### 🎯 注入策略：精准、克制、缓存友好

| 设计原则 | 说明 |
|---|---|
| **首轮注入，后续复用** | 固定记忆只在**会话第一步**注入一次，之后随对话历史自然携带——不再每轮重复渲染 |
| **标题优先，按需展开** | 注入的是精简标题（带 id），全文细节通过 `view` 工具按需展开——prompt 紧凑 |
| **动态记忆独立于固定集** | `auto` 级别记忆按话题检索，**不污染固定记忆的注入集**，避免重复 |
| **不破坏前缀缓存** | 记忆注入后进入历史消息，后续轮次的 system prompt + 历史前缀不变——**LLM 的 KV cache 命中率不受影响** |
| **来源隔离标注** | 注入记忆带前缀 `Retrieved memories from the memory store (not conversation history)`，模型不会误认为对话历史 |

### 📊 与其他方案对比

| 方案 | 每轮注入 | 缓存影响 | Token 消耗 |
|---|---|---|---|
| 每轮全量注入 | ❌ 每轮重复 | ❌ 破坏缓存 | 高 |
| 本插件 | ✅ 首轮一次 | ✅ 零影响 | 低 |

## ✨ 特性

| 特性 | 说明 |
|---|---|
| **六个工具** | `remember`（写）/ `recall`（语义检索）/ `view`（按 id 展开全文）/ `list`（标题列表）/ `forget`（软删除）/ `pin`（强制注入） |
| **标题优先注入** | 记忆以**总结标题**（带 id）注入而非全文——prompt 精简；细节用 `view` 工具按需展开 |
| **两级注入** | `injectLevel: session` 的记忆会话级常驻（首轮注入一次）；`auto` 记忆按话题动态检索 |
| **首轮一次注入** | 固定记忆只在**会话第一步**注入一次，之后随历史携带——不再每轮重复渲染（省 token、前缀缓存友好） |
| **Embedding 检索** | HybridSearch（关键词 2-gram + 本地 ollama embedding，RRF 融合）——能命中关键词检索漏掉的口语化表达 |
| **匹配调优** | 泛词降权（文件/测试/文档…）、关键词至少 2 词命中、检索门控跳过测试性话语（"别管/只是测试"） |
| **来源标注** | 注入记忆带前缀 "Retrieved memories from the memory store (not conversation history)"，模型不会误认为是对话历史 |
| **数据安全** | 串行写入队列（无丢失更新）、损坏文件隔离备份、原子写入、mtime 缓存失效 |

## 📦 安装

```sh
# 方式一：从 GitHub 安装（源码，需 prepare 构建）
dsh plugin --profile <name> add github:towzai/dsh-memory

# 方式二：本地路径安装
dsh plugin --profile <name> add ./dsh-memory

# 方式三：npm 包（如已发布）
dsh plugin --profile <name> add @towzai/dsh-memory
```

首次 git 安装若被 pnpm 拒绝运行 `prepare`，按提示把包键加入该 profile 的 `pnpm-workspace.yaml`：

```yaml
allowBuilds:
  '@towzai/dsh-memory': true
```

**依赖**：本地 [ollama](https://ollama.com) 实例 + embedding 模型（默认 `qwen3-embedding:0.6b`，可用环境变量 `DSH_MEMORY_EMBED_MODEL` 覆盖）。

## 🛠️ 工具

| 工具 | 作用 |
|---|---|
| `remember` | 保存记忆（content / title / category / tags / importance / forceInject / injectLevel / source） |
| `recall` | 混合检索（关键词 + embedding）top-N |
| `view` | 按 id 展开一条记忆的完整内容（标题优先注入的细节入口） |
| `list` | 标题列表（支持分类/标签/重要性过滤，`full` 看全文） |
| `forget` | 软删除（标记 `retired`，保留历史） |
| `pin` | 切换 `forceInject`——行为铁则，始终常驻 |

## 🗂️ 存储

单个 YAML 文件（默认 `memory.yaml`）。每条记忆：

```yaml
- id: MEM-20260814-001
  title: "总结标题（缺省自动推导）"   # 注入时显示标题
  content: "..."
  category: preference | project | lesson | fact
  tags: [tag1, tag2]
  importance: high | normal | low
  created: 2026-08-14
  updated: 2026-08-14
  source: user | agent | conversation
  retired: false
  forceInject: false           # 行为铁则：始终常驻
  injectLevel: session | auto  # 会话级常驻 vs 按需检索
  vector: [...]   # 1024 维 embedding，写入时自动计算
```

> ⚠️ 记忆文件是你的私有数据——请加入 `.gitignore`，不要提交到仓库。

## 🔧 架构

```
src/
├── index.ts    # 插件入口：工具 + 会话首轮注入 + pre-step 监听
├── storage.ts  # Storage 接口 + YamlStorage（写队列、mtime 缓存、损坏隔离）
├── search.ts   # KeywordSearch / EmbeddingSearch / HybridSearch（RRF）/ OllamaEmbedder
├── inject.ts   # selectForInjection / renderSection（标题优先）/ deriveTitle / entryTitle
├── dynamic.ts  # DynamicInjector（按会话去重 + 检索门控 + 固定集排除）
└── types.ts    # 数据模型（预留 vector/scope/weight 字段）
```

架构说明：[`docs/architecture.md`](docs/architecture.md) · 更新日志：[`CHANGELOG.md`](CHANGELOG.md)。

## 🗺️ 规划中

计划中的后续功能（尚未实现）：

| 功能 | 说明 |
|---|---|
| **反馈评分**（`weight`） | 从隐性信号（使用频率、被忽略、agent 反馈）中学习，按"有用程度"给记忆排序，替代静态的 importance |
| **多作用域隔离**（`scope`） | 按项目/工作区隔离记忆命名空间，互不串味 |
| **自动学习** | 自动从会话中提炼新记忆（需人工确认），而不是只靠显式调用 `remember` |
| **更多存储后端** | 基于现有 `Storage` 接口扩展 SQLite / JSON |
| **Web 界面** | 在 dsh WebUI 中浏览、编辑、管理记忆（目前只有 agent 侧的 `view` 工具） |
| **测试套件** | 扩充存储、检索、注入逻辑的自动化测试覆盖 |

## ⚠️ 注意事项

- 更换 embedding 模型会使已存向量失效（维度不匹配会被检测并告警）
- 插件针对 dsh `v0.1.0-rc.5` 开发，peerDependencies 版本范围可能需要随 dsh 升级调整
- 依赖本地 ollama——无 ollama 时自动降级为纯关键词检索

## 🔗 相关引用

本插件属于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）插件生态。

- **官方仓库**：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- **插件开发文档**：[docs/user/develop](https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/user/develop)——插件生命周期、配置与发布指南
- **生态话题**：[`dsh-plugin`](https://github.com/topics/dsh-plugin)

## 📄 许可证

MIT
