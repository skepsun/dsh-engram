# dsh-engram Context GC — 从 0 开始的使用教程

> 适用范围：dsh web（preset 平面）+ headless/TUI/base（host 平面）。
> 一句话：**用「机械驱逐 + 重取指针」替代 DSH 自带的有损 LLM 全量摘要压缩。**

---

## 1. 这是什么

DSH 默认的上下文压缩（`compaction-basic`）在自动 / 手动 compact 时，把被驱逐的历史压成一段
**不可查询的散文摘要**——有损、且摘要本身还要烧 token。

dsh-engram 的 Context GC 把这一步换成：

1. **扫描**被驱逐轮次里的 provenance 锚——`engram_store`/`engram_recall`/`engram_detail`
   回显的 `#记忆id`、`esr_*` 涉及的 `tsk_*`/`ent_*`、`file_path` 锚；
2. **指针摘要**——每条被驱逐类别都带显式重取调用（`engram_detail(id)` / `engram_recall(query)`
   / `[ESR]` 块 / `esr_ready`）；active 工作集在摘要里**复述**、不驱逐；
3. **兜底叙事**——只有**无锚轮次**（纯对话/推理，没有任何可重取落点）才走 scoped LLM 摘要
   （`gcNarrative`，默认开）；关掉后整条路径**零 LLM**，无锚轮次截断原文保留。

触发时机跟 DSH 现有 compact 完全一致：**自动压力（约 80% 窗口阈值）→ context-overflow → 手动
`/compact`**。任何一步出错都会回退默认压缩，**永不破坏 compact、永不弄丢会话**。

### 两个平面

| 平面 | 覆盖 | 接管方式 |
|---|---|---|
| host 平面 | headless / TUI / base 型 profile | 插件启动时直接注册 `compaction` 服务为零配置 ContextGcEngine |
| web 平面 | dsh web 的 agent preset（shipped + 用户预设） | 启动时自动把 stock 预设 `compaction` 组的 `compaction-basic` 行换成 `dsh-engram/compaction` 行 |

---

## 2. 前提

- 已安装 dsh（含 **dsh web**）与一个 web profile；
- dsh-engram 已作为 profile 依赖挂好（`link:/path/to/dsh-loom` 或 npm 包），profile patch 里有
  `engram` 行；
- 后端依赖 `@deepseek-ai/dsh-compaction-basic` 可被解析（安装 engram 时自动链接）；
- 记忆/任务侧已配置好 engram 存储域（`engram_store` 有可写域、ESR 可选）。

---

## 3. 从 0 安装并启用（3 步 + 1 条铁律）

```bash
# ① 安装（源码开发方式；生产用 npm install dsh-engram）
cd /path/to/dsh-loom && npm link            # 或 profile package.json 加 "dsh-engram": "link:..."

# ② 启动一次 dsh web —— 这一步做「自动装配」
#    - host 平面：立即注册 Context GC 为 compaction 服务
#    - web 平面：改写每个 stock 预设文件（compaction-basic 行 → dsh-engram/compaction 行，
#      每个文件旁留 agent.cordis.yml.engram.bak）
dsh web

# ③ 再重启一次 dsh web —— 让已接管的预设真正生效
dsh web
```

**铁律：代码/预设改动后必须重启 dsh。** 运行中的进程把旧 `lib/*.js` 和旧预设行都缓存/装载在内存里，
磁盘上的修复与文件改写不会热生效；只有重启（host 开机自动装配默认 `autoWebCompaction:true`）才会
加载新代码并接管 web 预设。

> 也可以先手动预写再一次性重启：
> ```bash
> npx dsh-engram enable    # 等价于启动时的自动装配（通常 no-op）
> npx dsh-engram status    # 确认 preset 已 wired
> # 然后重启 dsh web 一次
> ```

---

## 4. 验证是否生效

```bash
npx dsh-engram status      # 每个预设显示 wired（已接管）/ stock（未动）/ custom（不碰）
npx dsh-engram doctor      # status + 按缺口排序的下一步建议
```

启动日志的两行金标准：

```
engram context-gc: compaction = Context GC (mechanical eviction + re-fetch pointers)   # host
engram web-provision: wired Context GC into preset "standard" (…); restart dsh web …    # web 每个预设一行
```

其他入口：
- 记忆看板头部状态徽标（"Context GC · 主机 ·N 预设"）；
- 权威快照 `$DSH_HOME/engram/context-gc.status.json`。

---

## 5. 日常使用：它替你做掉了什么

在任意会话里照常对话、照常用工具即可。当 compact 触发（自动压力 / 溢出 / 手动 `/compact`），
落在会话里的 checkpoint 长这样：

```
## Context GC — evicted detail is RE-FETCHABLE (do not re-derive)

Older conversation was evicted to free context. The detail is NOT lost: it lives in the engram memory
store and the ESR task store. Re-fetch ONLY when you actually need it, using the tools below.

Evicted 3 turns. 2 with re-fetchable provenance, 1 narrative-only.

### ESR task state
Reload the full graph with the [ESR] block / `esr_ready` — only re-fetch what you need.
- Active working set (still tracked in ESR):
  - `tsk_act1` — migrate compaction engine
- 2 closed task(s) retained — details stay re-fetchable via the [ESR] block.

### engram memories (re-fetchable)
Fetch the exact records that are still in the store:
- `engram_detail(id: "8f7a2c4e-…")` [decision]
- Re-run recall: `engram_recall(query: "compaction shrink gate")`

### Narrative not captured elsewhere
（只有无锚轮次的 scoped 叙事；gcNarrative 关掉则为截断原文）
```

指针类别速查：

| 被驱逐内容 | checkpoint 里留下的指针 |
|---|---|
| engram 记忆（含 auto-capture / recall 命中 `#xxxxxx`） | `engram_detail(id)` / `engram_recall(query/entity)` |
| ESR 任务 / 实体 / stable 任务 | `[ESR]` 块 / `esr_ready` / 实体 `ent_*` |
| 文件锚 | `filePath` 路径提示 |
| 无锚轮次（纯对话 / 推理） | `gcNarrative` 叙事（默认开）或截断原文（关闭后） |
| active 工作集 | **在摘要里复述，绝不驱逐** |

手动触发：`/compact` 命令（来自 `command-compact` 插件）。

---

## 6. 配置项

> 位置：dsh web 设置卡「记忆 GC」区 / profile patch 的 `engram` 行 `config:` / 配置 JSON。

| 键 | 默认 | 作用 |
|---|---|---|
| `autoWebCompaction` | `true` | 是否在启动时自动改写 stock 预设并接管 web 平面 |
| `gcReplacesCompaction` | `true` | `true`=用 Context GC；`false`=回退 DSH 默认 LLM 摘要（`compaction` 服务永不缺席） |
| `gcNarrative` | `true` | 无锚轮次是否走 scoped LLM 叙事；`false`=**纯机械、整条路径零 LLM** |
| `gcNarrativeMaxTokens` | `1024` | 叙事生成的最大 token 数 |
| `gcNarrativeMaxChars` | `4000` | 无锚轮次原文兜底的截断长度（字符） |

**改配置后要重启 dsh web**——web 预设行会在下次启动时被自动刷新成新配置（幂等重写）。

---

## 7. 运维与卸载

| 命令 | 作用 |
|---|---|
| `npx dsh-engram status` | 查看 host + 每个预设的接管状态与生效配置 |
| `npx dsh-engram doctor` | status + 按缺口排序的下一步 |
| `npx dsh-engram enable` | 手动重跑启动时的自动装配（通常 no-op） |
| `npx dsh-engram revert` | 把全部预设还原成 stock `compaction-basic` 行 |

- 仓库内 `npm run web-compaction:*` 是同一 CLI 的别名。
- 每个被改写文件旁有 `agent.cordis.yml.engram.bak`（create-only，保留首次原件）。
- **卸载 dsh-engram 之前先 `npx dsh-engram revert`**——否则预设里的 `dsh-engram/compaction` 行会
  悬空，web 会话挂 loading。

---

## 8. 排障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| 自动压缩没触发，反而触发模型侧上下文溢出 | 运行中的进程还是**旧代码**（shrink-gate 回滚 bug） | **重启 dsh web** 加载修复（本教程最典型场景） |
| 手动 `/compact` 报 `manual compaction did not commit cleanly` | 旧 Context GC 代码缺 provider/model 落盘，commit 阶段被拒 | 同上：重启加载新代码 |
| 长会话自动压缩仍不提交（`start` 涨、`summary` 不涨） | 同上 / 或某些后端版本旧 | 重启；确认日志有 `compaction = Context GC` |
| 日志 `… keeping the existing compaction service` | 同域已有 compaction provider（基座行未禁 / 双 provider） | 检查 patch 与预设行，避免重复注册 |
| 日志 `web-provision … skipped (custom)` | 该预设是自定义/无 compaction 布局 | **设计如此**，不会碰 |
| 日志 `dsh-compaction-basic unavailable` | 环境缺后端依赖 | 安装依赖；自动回退默认压缩，host 不崩 |
| 极小被驱逐片段（span 小于 checkpoint 开销）不压缩 | harness 收缩闸门对**任何**后端一视同仁 | 属正常，没必要为几十 token 起 checkpoint |
| 改配置后没变化 | web 行要重启才刷新 | 重启 dsh web |

---

## 9. FAQ

- **有损吗？** 锚定细节**无损**（全部可通过工具重取）；只有无锚轮次走叙事/截断；所有原文仍留在
  会话日志里，即使 checkpoint 被裁剪也能找回。
- **会不会更烧 token？** 默认叙事只覆盖无锚轮次；需要完全零 LLM 就开 `gcNarrative:false`。
- **和记忆面板 GC 什么关系？** 完全正交：面板 GC 管**存储有界**（TTL/超容量归档），Context GC 管
  **上下文窗口**（compact 时驱逐）。
- **是强制的吗？** 不是。`gcReplacesCompaction:false` 即回退 DSH 默认 LLM 摘要。
- **什么时候触发？** 与默认 compact 完全一致：自动压力（约 80% 窗口阈值）→ 溢出 → 手动 `/compact`。
- **之前失败过的会话有没有被弄坏？** 没有。收紧闸门/commit 失败都会**整事务回滚**并写
  `compaction/end`（含 error），不留半成品；修复后直接再 `/compact` 即可。
