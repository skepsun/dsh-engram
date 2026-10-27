# dsh-engram v0.8.6

**桌面宿主上那三个「一直在休眠」的特性，修好了；顺手把「静默」改成会说话。**

这是 0.8.x 第一次发布到 npm（上一版 npm `latest` 还是 `0.7.4`），
所以从 npm 升级的用户这一跳是 `0.7.4 → 0.8.6`，`0.8.0`–`0.8.5` 的内容一起到达——
见文末「0.8.0–0.8.6 一次性带给你什么」。如果你只是想知道自己踩的坑修没修：
**issue #9 修了**。

## 修复：宿主没有批量读接口时，退回逐条读

`episode`（会话沉淀）、`[RESUME]` 简报、`[RECALL]` 启动召回、会话结束的 todo sink，
四件事都读会话事件日志。`lib/session-events.js` 原本有三手：

1. `session.events`（DSH ≤0.1.x 的旧字段）
2. `ctx.sessionQuery.live()`（≥0.2.x 的正规租约）
3. `session.snapshotEvents()`（宿主已标 deprecated 的同步批量读）

Windows 桌面运行时（`@deepseek-ai/dsh-desktop-runtime` 0.2.1-rc.2）**三样都没有**，
于是四项特性一起休眠，且没有任何配置能绕过。issue #9 的报障就是这么来的。

现在有第四手：

4. **`session.seq` + `session.eventAt(seq)`** —— 逐条读。这是上面所有批量读底下
   的原语，宿主可以砍掉批量接口而留下它。慢一点，但能让特性活着。

顺序不变，前一手能用就不走后面；`sessionEventsSource()` 也把 `"eventAt"` 报进状态，
`/stats` 与冒烟检查都能看见这一轮到底走了哪条路。

## 「静默休眠」本身也是 bug

报障的同学是解 `session.v4.jsonl.zstd` 的帧才确认「不是还没触发，是根本不会触发」的。
这个成本不该由用户付。两处改进：

- 休眠时的 warn 现在**报出它有什么**：
  `… no session.events, no ctx.sessionQuery, no snapshotEvents, no eventAt … Session surface: seq, eventAt, append`
  —— 下一份报障带上这一行，就能直接判定对面是哪代宿主。
- README 的 episode 小节加了明确的宿主要求段：哪些接口能满足、三样都没有时会休眠、
  以及存储与 `engram_recall`/`engram_detail` 仍然照常工作。已知案例点名桌面运行时。

## 证据

- `npm test` **483/483**（新增：只有 `seq`+`eventAt` 也能读出日志、episode 仍能生成、
  完全没有可读接口时 `sessionEventsSource === "none"` 且 surface 探测能报出它有什么）
- `npm run typecheck` 通过；`prepublishOnly` 真实打包 + 装上 peers 后 host/client 双入口导入通过
- G6 第五轮（同批）：**20 对配对，Δ = +90.0pp**（带记忆 20/20，裸臂 2/20），
  在三条不可推导约定上 15/15 vs 0/15 —— 见 `docs/G6-quality-ab.zh.md` §12

## 0.8.0–0.8.6 一次性带给你什么（相对 npm 上的 0.7.4）

- **0.8.0 证据化 procedure** — procedure 记忆要带「验证过」的证据才进索引，并有失效检测
- **0.8.1 Skill 导出** — 验证过的 procedure 能导出成真正的 DSH Skill
- **0.8.2 subagent 交接胶囊** — 留档做全（替换做不了，理由写在代码里）
- **0.8.3 审批门** — 证据让你进索引，人点头才让你写文件
- **0.8.4 审批门 GUI + G6 门方向修正** — 单边门（Δ ≥ −2pp）与隐藏规格语料
- **0.8.5 记忆行上的文件信号** — `⚠file-changed` / `⚠file-missing`，让「这条记忆指向的文件变过」可见
- **0.8.6 本版** — issue #9 修复 + 休眠不再静默

逐版细节见 `docs/RELEASE-NOTES-v0.8.{0,1,2,3,4,5}.md`。

## DSH 版本支持（必填）

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh 0.2.1-rc.2`（本机 CLI + web，`dsh --version`）
- **最后验证日期**：2026-10-27
- **安装方式已验证**：`prepublishOnly` 用真实 tarball 装 peers 后导入 host/client 双入口
- **peer 声明**：`@deepseek-ai/dsh-{settings,storage-domain,compaction,compaction-basic,llm}@>=0.1.2-alpha.2 <0.3.0-0`、`@deepseek-ai/cordis@^4.0.2`、`@deepseek-ai/schemastery@^3.18.2`

> 已知限制：桌面运行时（`@deepseek-ai/dsh-desktop-runtime`）若不暴露
> `sessionQuery` / `snapshotEvents` / `eventAt` 中的任何一个，四项注入特性仍会休眠
> （存储与工具不受影响），此时请把 warn 里的 `Session surface:` 一行贴进 issue。
