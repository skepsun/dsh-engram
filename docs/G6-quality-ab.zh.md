# G6 · 配对质量实验（Quality Δ）

> G6 是唯一**不能从日志里算出来**的门。日志能告诉我们「机制跑了没有、省了多少」，
> 不能告诉我们「任务变容易了还是变难了」。要看后者，只能同题同种子跑两臂。

## 1. 判据

| 项 | 值 |
|---|---|
| 指标 | 配对成功率差 Δ = rate(engram) − rate(bare) |
| 门 | \|Δ\| ≤ 2pp |
| 最少配对 | 10 对（task × seed，两臂都跑完） |
| 低于下限 | **未测**——不猜，一个任务不是质量证据 |

`Δ` 用**配对**算：同一 task × seed 下两臂都跑过才计入，避免任务难易不同造成的伪差。
`only-A wins` / `only-B wins` 把差异摊开，防止「互相抵消所以 Δ=0」。

## 2. 为什么必须有 oracle

每个任务带一条 `check` 命令（bash），退出码 0 即通过。用命令而不是用 LLM 打分：
LLM 打分引入第二个模型，G6 就变成「两个模型同不同意」，不再是「机制有没有帮助」。

`check` 必须确定：同一个最终状态永远给同一个答案。

## 3. 准备两臂

```bash
# 1) 建两个 profile：on 臂装 engram，off 臂保持裸机
node eval/quality-ab.mjs prepare --arm on=ab-engram,off=ab-bare --home ~/.dsh/quality-ab

# 2) 只给 on 臂装插件（off 臂什么都别装——这是对照）
DSH_HOME=~/.dsh/quality-ab dsh plugin --profile ab-engram add ~/.dsh/vendor/dsh-engram-<ver>.tgz

# 3) 确认真的挂上了
DSH_HOME=~/.dsh/quality-ab dsh --profile ab-engram --dump-config | grep -A2 'id: engram'
```

**凭据**：`dsh headless` 没有 web 的 Models 页，provider 路由从环境变量取 key。
harness 会自动从 `~/.dsh/.credentials.yaml` 把 `DEEPSEEK_API_KEY` 读进子进程环境
（只进内存，不进报告、不打日志）。两处都没有就直接报错退出，不会跑出一堆 MISSING_CREDENTIAL 的空跑。

## 4. 跑

```bash
node eval/quality-ab.mjs run \
  --tasks tasks.json --workspace ./fixture \
  --arm ab-engram,ab-bare --seeds 3 \
  --out runs/g6-$(date +%F) --home ~/.dsh/quality-ab
```

`tasks.json`：

```json
{ "tasks": [
  { "id": "fix-import",
    "prompt": "…给 agent 的任务描述…",
    "setup": "git checkout -- . && git clean -fd",
    "check": "npm test --silent",
    "timeoutMs": 600000 }
] }
```

- `setup` 在**复制出来的 workspace** 里先跑（每个 run 一份新副本，互不污染）；
- `prompt` 两臂逐字相同——臂是唯一变量；
- 每次 run 的 `run.log` 和 `check.log` 都留在
  `runs/<date>/<arm>/<task>/seed-<n>/`，判定可事后审计。

## 5. 语料怎么挑（这一节决定实验有没有意义）

1. **有确定答案的真实任务**——从自己最近的会话里挑那些「跑过一次、结果已知正确」的小任务
   （改一个 import、补一个断言、跑通一个脚本）。不要自己发明玩具题。
2. **两种难度都要**：太简单的题两臂都 100%，测出 Δ=0 什么也没说；至少一半任务原本会失败或要多次尝试。
3. **不要让任务依赖 engram 才能完成**：如果题目需要「回忆上次怎么做的」，那测的是提示而不是质量。
4. `fixture` 是一个干净的 git 仓库副本，每个任务靠 `setup` 回到起点。

## 6. 成本

一次 run ≈ 一个完整 agent 会话。10 任务 × 2 臂 × 3 seed = 60 次。按本机 step p50 5s 估，
wall time 约 30–60 分钟；token 成本按单次会话的实际用量算。**建议先跑 5 任务 × 2 臂 × 1 seed
（10 对，正好踩到下限）看方向，再决定要不要扩。**

## 7. 和 G1 一起读

单看 G6 会得出「两臂质量一样」的结论，单看 G1 会得出「省了 token」。两个一起看才有意义：

- Δ ≈ 0 且 G1 为正 → 白捡的节省；
- Δ 明显为负 → 省下的 token 是用质量换的，门不过；
- Δ 明显为正 → 也许该考虑把注入做得更狠。

## 8. 现状

harness 已落地并**真机跑通**（1 任务 × 2 臂，两臂都跑完、oracle 判定、Δ=0.0pp），
但按自己的规则报 **未测**：1 对配对是管线验证，不是质量证据。

下一次真实运行从这里开始：`node eval/quality-ab.mjs run … --seeds 3`。
