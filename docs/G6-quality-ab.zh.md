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

## 5. 实测（2026-10-26，第一轮）

```bash
node eval/quality-ab.mjs run --tasks eval/g6/tasks.json \
  --workspace eval/fixtures/ledger-kata --arm ab-engram,ab-bare --seeds 2 \
  --out eval/g6/runs/g6-2026-10-26 --home ~/.dsh/quality-ab \
  --seed-memory eval/g6/seed-memory.json
```

| arm | pass | rate | median wall |
|---|---|---|---|
| ab-engram | 12/12 | 100% | 41.5s |
| ab-bare | 12/12 | 100% | 27.2s |

**Δ = 0.0pp · 12 对配对 · G6 PASS（PASS 条件 \|Δ\| ≤ 2pp）。**

### 两臂差在哪（否则这不是实验）

同一个 fixture（`eval/fixtures/ledger-kata`，6 个模块各带一条会失败的测试），
同一个 prompt，同一个本地模型（local-vllm-61 / deepseek-v4-flash）。
**on 臂额外预置 4 条记忆**（`eval/g6/seed-memory.json`）：2 条真事实（guard 是 oracle、
金额用整数分）+ **2 条故意过时的经验**（「timefmt 固定 TZ 再用 toLocaleString 就行」、
「sort 直接用就够」）。预置是逐 run 覆盖写入的，所以每个 run 的记忆状态相同——
否则两臂就不是配对了。

不加预置的话，on 臂只有一个协议块，两臂几乎没差别，实验测的是空气。

### 这轮测得的是「不伤害」，不是「有提升」

12/12 vs 12/12 是**天花板效应**：fixture 的 6 个任务对这一档模型都太容易，两臂都做满。
所以这轮证据支持的结论只有一条硬结论（PASS 的门本身）：**挂上 engram 没有让任务质量下降**；
它**不能**支持「记忆让任务更容易」。

值得单独记的是延迟：on 臂中位 41.5s vs bare 27.2s（+52%，max 都撞到 ~77s）。
这是 `[ENGRAM]` 注入 + 2 条过期经验测带来的一次性成本，不是质量差。
下一步要提高区分度，得换更难的任务（多文件、跨模块、需要历史决策），
或者把 fixture 的测试藏起来让记忆成为唯一规格来源。

### 关于那 2 条过期经验

两臂都 12/12 —— 没有一次「照抄过时 playbook 导致失败」。但注意：**没观察到不等于不会发生**，
本轮任务里过期经验恰好都不致命（TZ 方案在 timezone 测试上会挂，两个 on 臂也没照抄，
而是自己读了测试）。要测这一条，得设计「照抄就会挂、且不看测试就会信」的任务。

### 第三轮之前的一个坑（流程证据）

第一次 pilot 里，harness 写入的预置行用了 `sessionId: null`，违反 `MemorySchema`
（`z.string().min(1)`），插件把整个域判成不可用 —— on 臂实际是「engram 离线」，
不是「engram 在场」。数字照样是 100% / 100%，**但它测的是故障**。
修好后才跑正式轮。这条记在这里，是因为「先跑一对看接缝通不通」救了这次实验：
12 对跑完再发现 schema 漂移，代价是半小时和一个假结论。
`eval/g6/runs/pilot/README.md` 保留了当时的日志说明。
