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
