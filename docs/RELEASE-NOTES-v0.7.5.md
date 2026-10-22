# dsh-engram v0.7.5

自 v0.7.4 以来：**账本按会话落行**，并落地 `gate-audit`——把
[PROPOSAL-evolution.zh.md](PROPOSAL-evolution.zh.md) §6 预声明的门从「口号」变成
「能在本机算出数字的表格」。顺手修掉了让这些门永远读 0 的第三个静默 bug。

## 1. 账本按会话落行（`tsk_b9` 前半）

v0.6 的账本按 `workspace × 天` 汇总，于是 §6 的第一道门
（「净收益 > 0 的会话 ≥ 50%」）**在算术上无法回答**——分母被抹掉了。

- `ledger.json` 新增 `sessions: { <sessionId>: row }`，与日汇总**写同一份 delta**：
  `requests / injectedChars / avoidedChars / rewriteCount / rewriteChars`，
  另存 `prunedChars`、`compactedChars`（唯一只存在于会话级的两个字段）、
  `workspace`、`firstDay`/`lastDay`、`updatedAt`。
- 行数与日汇总同步裁剪：`maxSessionRows`（默认 500），按 `updatedAt` 保留最新；
  会话行**永不**参与 `totals` 计算，只是门审计的分母。
- `summary()` / `readLedger()` 都返回 `sessions`（最近 50 / 全部），
  **未 flush 的活跃会话也会出现在 `summary()` 里**（临时合并 delta，不改状态）。
- 兼容老文件：缺 `sessions` 字段时按空表处理，不迁移、不重写历史。

## 2. `gate-audit`：六个门可计算（`tsk_b9` 后半）

新增 **`eval/gate-audit.mjs`**（`npm run gate:audit`），纯读本地数据、零模型、零网络：

| 数据源 | 用途 |
|---|---|
| `~/.dsh/engram/ledger.json` | 每会话净收益 → G1 / G1b |
| `~/.dsh/sessions/**/session*.jsonl.zstd` | 挂载会话、engram/esr 工具调用、`[RECALL]` 注入标记、recall 命中 → G2 / G2b / G3 |
| `~/.dsh/storages/dsh_engram.json` | 被 supersede 的行占比 → G4 |
| `--api <base>?workspace=<ws>` | 运行中宿主的 `/preview` → G5（渲染后索引字符数） |

判定只允许三种值：`PASS` / `FAIL` / **`未测`**。没有数据就说没数据——G6（配对任务
质量差）与 G7（账本时延开销）永远 未测，除非你跑配对实验/基准；脚本不会替你猜。

用法：

```bash
npm run gate:audit                          # 终端一行一门
npm run gate:audit -- --md                  # markdown 表格
npm run gate:audit -- --out docs/GATES.zh.md # 落盘
npm run gate:audit -- --api http://127.0.0.1:3080/api/dsh-engram   # G5 取真值
```

## 3. 修掉第三个静默归零：v4 会话日志的 tool-result 形状

`/stats` 与门审计都从会话日志里解析 `tool/result`。DSH 0.2.x 的 **v4 格式**把结果
直接放在 `data.message` 上（`{ role, source:{kind,callId}, toolCallId, isError, content:[{type:"text"}] }`），
不再有 v1–v3 的 `content:[{type:"tool-result", …}]` 包装层。

旧解析只认包装层 → **失败计数恒为 0、recall 命中率恒为 0**；而 `test/usage.test.mjs`
的 fixture 也只用 v3 形状，所以测试一直绿。（这是 v0.7.4 那类问题的翻版：
宿主序列化格式改了，读日志的一侧静默读到空。）

- `lib/usage.js` 新增导出 **`readToolResult(event)`**：两种形状都认，
  返回 `{ callId, text, isError }`，非结果事件返回 `null`。
- `collectUsageStats` 改接它；`/stats` 的 failures / recall 命中率恢复真实值。
- 新增 2 条回归：`readToolResult` 双形状单测 + **v4 fixture 的 usage 汇总**
  （`failures === 1`、`recall.withHits === 1`、`detailFollows === 1`）。

## 4. 本机第一次实测（2026-10-22，14 天窗口，40 个会话）

```
G2  Activation 75.9%  PASS   22/29 挂载会话 fire 过 engram/esr 工具
G2b Push        0.0%  —      0/29 会话的 request header 带 [RECALL]
G3  DrillRate   0.08  —      3 次 detail / 37 次有命中的 recall
G4  StaleRate   0.0%  PASS   0/326 条被 supersede
G5  索引        680c  PASS   dsh-loom（真机 /preview）
G1  未测                     v0.7.5 之前没有会话行 —— 重启后开始有分母
```

**G2b = 0.0% 是 v0.7.4 的验证基线**：修复上线前，14 天里没有任何一个会话的
request header 带过 `[RECALL]`。重启宿主后这个数字应当由 0 变正——那是推送腿第一次
真正被观测到，而不是被假设为在工作。

G3 = 0.08 也值得注意：模型在 recall 上很勤（37 次有命中），但几乎不 `engram_detail`
——推送被采纳率低，正是 v0.8 要解决的问题（证据化 procedure + 更短的推送行）。

## 5. 测试与兼容

- `npm test` **425/425**（v0.7.4：416）；其中 ledger 14 → 18，usage 10 → 12，
  新增 `test/gate-audit.test.mjs` 3 例。
- 老 `ledger.json` 无需迁移：新增字段可选，读侧全部做了缺省处理。
- `node client/typecheck.mjs` 干净。
