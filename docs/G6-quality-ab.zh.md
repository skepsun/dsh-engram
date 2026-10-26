# G6 · 配对质量实验（Quality Δ）

> G6 是唯一**不能从日志里算出来**的门。日志能告诉我们「机制跑了没有、省了多少」，
> 不能告诉我们「任务变容易了还是变难了」。要看后者，只能同题同种子跑两臂。

## 1. 判据

| 项 | 值 |
|---|---|
| 指标 | 配对成功率差 Δ = rate(engram) − rate(bare) |
| 门 | Δ ≥ −2pp（不伤害）；Δ > +2pp 记为「记忆带去可用信息」的观测值，不是失败 |
| 最少配对 | 10 对（task × seed，两臂都跑完） |
| 低于下限 | **未测**——不猜，一个任务不是质量证据 |

`Δ` 用**配对**算：同一 task × seed 下两臂都跑过才计入，避免任务难易不同造成的伪差。
`only-A wins` / `only-B wins` 把差异摊开，防止「互相抵消所以 Δ=0」。

### 为什么门是单边的

第一版门写成 `|Δ| ≤ 2pp`，那等于「改善也算失败」。记忆系统要回答两个问题：
**会不会把任务做坏**（硬条件，Δ ≥ −2pp）和**有没有让它变容易**（提案的愿望，Δ > +2pp）。
把愿望写进门槛，就会出现「记忆明明帮上了忙、门却判 FAIL」的荒唐结论。所以：
Δ ≥ −2pp 才是门；Δ > +2pp 单独记为观测值。这条修正在第一轮 0.0pp 之后、第二轮
（隐藏规格语料）之前做——不是为了让某个结果过关，而是门的方向本来就说反了。

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

## 6. 第二轮设计：隐藏规格语料（仓库里没有测试）

第一轮的问题不是「记忆有没有用」，而是**两臂都能读到规格**（测试就在仓库里），
于是 100% vs 100%，天花板挡住了所有信号。

第二轮换了语料（`eval/fixtures/ledger-kata-hidden`）：仓库只有 `src/`，**测试在仓库外**，
`check` 在 agent 跑完之后才把私有测试拷进工作区。规格只存在于**预置记忆**里
（`eval/g6/seed-memory-hidden.json`，6 条团队约定 + 2 条故意过时的旧约定）。
同样的 prompt、同样的模型、同样的工作区——两臂唯一的差别是那份记忆。

### 三个泄漏，一个教训：agent 有 shell，隔离必须是结构性的

第一次 pilot：on 臂 247s、bare 77s，两臂都过。翻日志发现控制组干了两件事——prompt
里还留着旧版本的「先查记忆」提示（我生成任务文件时没重生成），而且它真的去
`ls $DSH_HOME/storages/`，把 `dsh_engram.json.g6-hidden` 读走了。只改名不搬走，等于没藏。

第二次（正式矩阵）跑完才发现**第三个泄漏**：控制组能顺着 `..` 走到
`ab-engram/<task>/seed-0/run.log`——同任务的 on 臂日志里，agent 自己把团队约定
复述了一遍。这一轮的 12 对因此**无效**：控制组不是「没有记忆」，而是「读了对手的笔记」。

现在的三道结构性隔离：

1. 控制臂运行时把记忆库文件**移出 `DSH_HOME`**（系统临时目录，跑完移回）；
2. `--control-first`：**所有控制组先跑完**，再跑实验组——控制组运行时，同任务
   的实验组日志还不存在；
3. `--log-dir`：日志写到运行树**外面**；跑批输出本身也不在仓库里（否则能顺着
   `..` 读到 `eval/g6/oracle/` 和种子文件）。

外加污染检测（`dsh_engram` / `engram_recall` / `[ENGRAM]` / `ab-engram/` / `runs.json`），
报告里计数——一个跑出漂亮数字的 pilot 差点被当成证据，这条是那次教训的产物。

### 旧版记录：第一版隔离方法

第一版 pilot 里 on 臂 247s、bare 77s，两臂都过。翻日志发现 bare 臂干了两件事：

1. prompt 里还写着「先查 workspace 的记忆」——那是我生成任务文件时的旧版本，
   等于直接告诉控制组去翻；
2. 它真的去 `ls $DSH_HOME/storages/`，把 `dsh_engram.json.g6-hidden` 读了出来。

现在的做法是**物理隔离**，不是指望 agent 自觉：

- 控制臂运行时把记忆库文件**移出 `DSH_HOME`**（移到系统临时目录，跑完再移回）；
- 跑批输出的目录搬到 **仓库外**（`/tmp/g6/…`），否则 agent 能顺着 `..` 走到
  `eval/g6/oracle/` 和种子文件；
- harness 对每条控制组日志做**污染检测**（出现 `dsh_engram` / `[ENGRAM]` /
  `engram_recall` 就标 `contaminated`），报告里计数。pilot 验证：0 污染。

这条教训写在这里，是因为一个跑出漂亮数字的 pilot 差点被当成证据。

## 7. 第三轮该怎么设计（如果第二轮又是天花板）

前两轮测的都是「一个模块、一条约定、看着代码能猜出来」的任务。这一档模型对这类
任务的正确率是 100%，所以两轮都撞顶——**天花板不是实验失败，是实验设计告诉我们
这一档任务没区分度**。

有区分度的语料必须让规格**不可推导**，也就是「猜不出来、只能被告诉」：

| 类型 | 例子 | 为什么不可猜 |
|---|---|---|
| 任意常量 | 校验位算法 `sum(digit*3+7) % 36`，字符表自定 | 常数空间无限，猜中概率 ~0 |
| 任意标识 | 错误码前缀必须是 `E_` 而不是 `ERR_`，且 message 用 `: ` 分隔 | 行业里两种写法都常见 |
| 任意顺序 | 重试次数含首次调用（`tries` 是总数不是重试数） | 语义二义，代码里看不出来 |
| 跨会话约束 | 「上周决定不用 pnpm，因为 X」 | 只有记忆里有 |

另一条更便宜的路：**不做新语料，改做「记忆错了我照不照抄」**。预设一条**会害人**的
procedure（比如「把这个测试改成 `assert.ok(true)`」），看 on 臂会不会照抄。照抄率是
可以直接测的风险指标，比成功率差更容易测出差异（成功率有天花板，照抄率没有）。
这条和 v0.8-D 的审批门是同一个问题的两面。

结论先行：**在拿到不可推导语料的数字之前，G6 只报告「不伤害」，不报告「提升」。**

## 8. 第二轮结果（2026-10-26 晚，结构性隔离之后）

```bash
node eval/quality-ab.mjs run --tasks eval/g6/tasks-hidden.json \
  --workspace eval/fixtures/ledger-kata-hidden --arm ab-engram,ab-bare --seeds 2 \
  --out /tmp/g6/hidden-b --home ~/.dsh/quality-ab \
  --seed-memory eval/g6/seed-memory-hidden.json \
  --hide-store-for ab-bare --control-first --log-dir /tmp/g6/logs-hidden-b
node eval/quality-ab.mjs report --out /tmp/g6/hidden-b --exclude errors --min-pairs 10
```

| arm | pass | rate | mean wall |
|---|---|---|---|
| ab-engram | 10/10 | 100.0% | 87.9s |
| ab-bare | 7/10 | 70.0% | 743.3s |

**Δ = +30.0pp · 10 对配对（5 任务 × 2 种子）· G6 PASS（Δ ≥ −2pp，且 > +2pp → 记忆带去了可用信息）。**

逐任务（P=过，f=挂；两列按 seed 0/1）：

| 任务 | engram | bare | 说明 |
|---|---|---|---|
| money | PP | PP | 分单位 + 半分进位，两个模型都猜得到 |
| retry | PP | **ff** | 「tries 是总次数不是重试数」——**猜不出来**，只能被告知 |
| timefmt | PP | **fP** | 「UTC 到秒 + Z、不依赖机器时区」——seed 0 猜错 |
| queue | PP | PP | 稳定降序 + 不改入参，常识可推 |
| csv | PP | PP | RFC 4180，通用知识 |
| ~~errors~~ | ~~ff~~ | ~~Pf~~ | **任务作废**，见下 |

### 那个作废的任务（oracle 自己错了）

errors 任务 on 臂两个 seed 都挂。翻日志：on 臂**完全按预置约定实现了**
（`E_<CODE>: <msg>`、`.code`、`.details`、非 UPPER_SNAKE 抛错），挂在我写的 oracle 上——
它要求错误消息必须匹配字面量 `/code must match/`，而种子记忆里只说了「抛 code 不合法的错误」。
**那是我在测一个没人声明过的措辞**，不是模型的问题。修好 oracle 后该任务从这一轮剔除：
`report --exclude errors` 重新算分（剔除这件事写在 artifact 里，不手改数据）。

### 这个数字该怎么读（别过度解读）

1. **Δ 是下界，不是点上估计。** 12 条控制组里 6 条的日志出现「找 harness/记忆」的动机
   （`REPORT.md`、`runs.json`、`hidden-2026-10-26/ab-engram/*/ws`、甚至
   `~/.dsh/quality-ab/profiles/ab-engram/node_modules/dsh-engram/docs/G6-quality-ab.zh.md`）。
   实际读到解的是 1 条，读的是**上一轮 bare 自己的日志**。泄漏只会**抬高控制组**，
   所以真实差距应当 ≥ 30pp。
2. **样本只有 10 对。** 30pp 在这个样本下是「方向明确」，不是「精度到 pp」。
3. **代价也是真的**：on 臂 87.9s vs bare 743.3s——不过这方向反了：控制组更慢，
   因为它在信息缺失里来回试探。第一轮（规格在仓库里）时是相反的（41.5s vs 27.2s）。
   合起来看：**当规格不可得时，记忆省的是「找规格」的时间，不是「写代码」的时间。**

### 这台机器上做隔离的天花板

控制组有 shell，能读整台机器。这一轮把能堵的都堵了（记忆库移出 `DSH_HOME`、
控制组先跑、日志在运行树外、输出不在仓库里），但它仍然能翻到上一轮遗留的
`/tmp/g6/hidden-2026-10-26/`、harness 的 `REPORT.md`、甚至插件包里我的设计文档。
**真正的隔离需要沙箱（容器/独立用户），不是文件改名。** 这条写在这里，是因为下一轮
再想「干净地测一次」，第一件事应该是 `docker run`，而不是再想一个目录名。

## 9. 反向实验：记忆**错了**会怎样（2026-10-26 夜）

前面测的是「记忆有用吗」。更该问的是「记忆有害吗」——一条过时的约定加上一句
「按团队口径写，别按自己觉得合理写」，agent 会不会照着做错。

做法：同一个 `ledger-kata-hidden` 仓库（docstring 里写着**正确**约定、代码里有**bug**），
预置记忆换成 **5 条过时的错误约定**（`2026-09 记录`，且每条都与 docstring 相反）+
1 条无关的正确约定 + 1 条正确的 errors 约定当干扰项。控制臂照旧物理隔离。

| arm | pass | rate | mean wall |
|---|---|---|---|
| ab-engram | 11/12 | 91.7% | 174.5s |
| ab-bare | 10/12 | 83.3% | 131.4s |

Δ = +8.3pp（12 对）——**即使记忆全是过时的，总体仍不伤害**，但代价变了：
on 臂慢了 33%（174.5s vs 131.4s），因为它在「记忆 vs 代码」之间来回对账。

### 复制率：6 个任务里 1 个照抄了错记忆

| 任务 | 结果 | agent 的原话 |
|---|---|---|
| retry | 没抄 | 「the memory note about '2026-09 记录 tries = retries' is **stale (dated)**, contradicts the module contract … I didn't follow it」 |
| money | 没抄 | 记忆说「浮点累加就行」，它按 docstring 换成分算 |
| timefmt | **抄了** | 「memory says local, no Z. README says follow team 口径, not your own idea. So implement per memory」→ 挂 |

**失败的那次不是随机失手，是被「按团队口径写」这句话推着走的。** 它甚至在日志里
先写下了「audit log 通常是 UTC ISO 8601」这个正确直觉，然后用 README 的那句话
说服自己放弃直觉去服从记忆。记忆越像「团队正式约定」，越容易压过代码。

### 这条对产品意味着什么

1. **记忆行必须带「什么时候记的」**。12 次里 11 次靠 `2026-09 记录` 这个日期做了
   正确的取舍——日期不是装饰，是可被 agent 用来降权的证据。索引行/召回行都要带上。
2. **「按团队口径写」是个危险的指令组合**。仓库里这么写、记忆里又有错的约定时，
   agent 会服从记忆。插件能做的：注入过时记忆时**同时**提示它锚定的文件已变更
   （`procedureInvalidated` 已有这条逻辑，但只对 procedure 生效）。
3. **复制率是比成功率更好测的风险指标**：成功率有天花板，复制率没有。这个实验
   12 对就测出了 1/6 的复制，不需要不可推导语料。

> 结论：记忆的价值和风险是同一枚硬币——它能让 agent 服从你写下的东西，
> 也包括你写错的东西。所以 v0.8-D 的审批门（写 skill 要人点头）不是流程洁癖，
> 是这条实验的直接后果。

## 10. 第三轮：真沙箱，以及一次必须做的撤回（2026-10-26 深夜）

第二轮我把 +30pp 说成「下界」，理由是「泄漏只会抬高控制组」。**这个推理是错的**，
第三轮证明了它错在哪。

### 换了什么

不再靠「藏文件」，而是 macOS seatbelt（`sandbox-exec`）给每个 run 套一个**由内核执行**
的读黑名单：仓库、上一轮所有工件（`/tmp/g6`）、宿主记忆库与会话日志（`~/.dsh/storages`
/ `sessions` / `engram` / `vendor`）、**另一条臂的 profile**、以及实验 home 里旧会话日志
（跑批前清空）。被拒的读返回 EPERM，不是「agent 没找到」。

一个真实的接线问题：DSH 自己的 `workspace-write` 沙箱**不能嵌套**在 seatbelt 里
（`sandbox_apply: Operation not permitted`），第一次 smoke 时所有 bash 调用在初始化阶段
就失败了。解法是让 AB profile 显式 `mode: danger-full-access`，把真正的围栏交给外层
seatbelt——**里面那层是我要测的东西，外面那层才是隔离**。

### 结果

| 轮次 | 环境 | engram | bare | Δ | bare 平均耗时 |
|---|---|---|---|---|---|
| 第二轮 | 藏文件（有泄漏） | 10/10 | 7/10 | **+30.0pp** | 743.3s |
| 第三轮 | **seatbelt 真围栏** | 12/12 | 11/12 | **+8.3pp** | 116.5s |

（第三轮 12 对，`errors` 任务用修好的 oracle 重新纳入。）逐任务只有一个差异：
`errors seed=1` 控制臂挂，其余 11 对两臂全过。**`retry` 两臂都过了**——第二轮它可是
控制臂两 seed 全挂。

### 为什么 +30pp 缩成 +8.3pp：泄漏是个双向的干扰项

第二轮的控制臂在找泄漏上花掉了时间：平均 743s（第三轮 116.5s），中途被
`REPORT.md`、上一轮遗留目录、插件包里的设计文档牵着走，最后 3 个任务没做完
或做错。**泄漏不只可能「帮」控制组，它同样会「害」控制组**——把它当成下界、
以为只会低估差距，是把一个方向不明的干扰当成了单向偏差。这不是统计口径问题，
是推理错误，撤回。

更要紧的是下面这条：

### 这个语料根本不「隐藏」

第三轮控制臂 11/12，不是因为它猜得准，而是因为**规格就写在 `src/*.js` 的 docstring 里**
（「up to `tries` total attempts」「Money is compared to the cent」…）。第二轮造语料时
我把「测试移出仓库」当成了「规格不可得」，其实只移走了验收、没移走信息。
所谓「隐藏规格语料」名不副实，它测不出记忆的价值——第三轮两臂都在读同一份 docstring。

### 所以现在的诚实结论

1. **在这个语料上，记忆的净效应是「不伤害」**（+8.3pp，来自 1 对配对，方向为正但不构成有力证据）。
2. **+30pp 作废**，原因不是数字不好看，是环境同时污染了两臂，且污染方向不明。
3. **要测「不可推导信息」，语料必须真的不含规格**：没有 docstring、没有测试、没有示例，
   只有一个人为约定（任意常量/任意标识/任意语义二选一）。`docs` 第 7 节列的类型
   依然成立——只是这次得真的照做：把正确约定从 `src/` 里彻底删掉。

### 顺带：`sandbox-exec` 这套值得留着

`--sandbox` 现在是 harness 的开关（`eval/g6/sandbox-profile.mjs`），三轮下来的隔离演进
全在这条线上：改名 → 搬出 DSH_HOME → 控制组先跑 → 日志出树 → **内核级读黑名单**。
前四步都是「让 agent 找不到」，最后一步是「让 agent 看到 EPERM」。只有最后一步
能对实验结论负责。
