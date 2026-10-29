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

**已测**：第五轮（见 §12）20 对配对，Δ = +90.0pp（20/20 vs 2/20），
三条不可推导约定上 15/15 vs 0/15。

历史：harness 落地时先跑通 1 任务 × 2 臂（Δ=0.0pp）并如实报**未测**——1 对配对是
管线验证，不是质量证据。之后的第二轮…第四轮逐步把语料和隔离修到位，那些轮的得失记在
§7–§11，已作废的数字不再引用。

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

## 11. 第四轮：语料里真的没有规格（2026-10-27 凌晨）

第三轮说明第二轮的语料不合格，因为规格写在 `src/*.js` 的 docstring 里。第四轮换了做法：
**规格物理上不在这台机器上**——除了一处「团队约定」之外，仓库里没有任何地方写着答案。

### 语料 `eval/fixtures/ledger-kata-blind`

4 个函数、4 条纯约定，`src/` 里只有抛 `not implemented` 的空壳，没有 docstring、
没有测试、没有 README、没有示例（`test/` 目录在跑批前不存在）：

| 任务 | 约定（只在种子里） | 为什么猜不出来 |
|---|---|---|
| `codec` | 校验字符 = `charset[Σ(每位数字×3+7) mod 36]`，`charset` 是 36 位小写字母数字表 | 任意加权、任意基数、任意字母表 |
| `errcode` | `E_<CODE>: <msg>` 前缀、`.code` 去前缀、`.details` 默认 `{}`、坏码要拒 | 前缀与字段名均任意 |
| `money` | 分位「四舍五入远离零」、累加走整数分 | 与 JS 默认 `Math.round` 行为不同 |
| `ordering` | 降序、稳定、返回新数组 | 方向二选一（可猜，这是本轮的漏洞） |

四条约定先写进 `seed-memory-blind.json`（外加一条无关的干扰记忆），
oracle 在 `eval/g6/oracle-blind/`，用 `check.mjs … --dir oracle-blind` 在**跑完之后**才拷进工作区。

### 结果：12 对，Δ = +58.3pp

| arm | pass | 耗时 |
|---|---|---|
| ab-engram | **12/12 (100%)** | 131.8s |
| ab-bare | **5/12 (41.7%)** | 208.1s |

逐任务（控制臂）：

```
codec     0/3      errcode   2/3      money   0/3      ordering  3/3
```

控制臂的 5 次通过里 3 次来自 `ordering`——降序是二选一，猜得中；剩下 2 次是
`errcode` 里前缀蒙对。**在三条真正不可推导的约定上（codec/errcode/money），
控制臂 2/9，带记忆 9/9。** 这是四轮里第一次出现「不查资料就根本做不到」的差距。

### 又抓到一个泄漏，方向反而对结论有利

第一次跑完发现两个控制 run 引用了 `/private/tmp/g6z/r4/.../test/codec.test.mjs` ——
那是**上一轮被我杀掉的跑批**留下的 oracle 副本（当时 `check.mjs` 还没删 oracle）。
两个 bug 叠在一起：

1. seatbelt 里写的是 `/tmp/g6z`，但 macOS 在匹配前把 `/tmp` 解析成 `/private/tmp`，
   **deny 没生效**。现在每个条目都同时发原文和 realpath 两种写法。
2. 判完不删 oracle，副本会活到下一次 run 能看见。

修完之后，把 codec/errcode 的控制臂重新跑了 6 次（干净树、无泄漏引用），
`codec 1/3 → 0/3`，`errcode 1/3 → 2/3`，合计仍是 5/12 —— **Δ 58.3pp 不变，
而且这次两个方向的错误都修掉了**（泄漏只会帮控制臂，所以它是个偏保守的偏差）。

### 关于这组数字能说什么

- 能说：**当规格不可从仓库推导时，种下的记忆让 4 个任务从 41.7% 变成 100%**（12 对，4 任务 × 3 种子）。
- 不能说：这是「通用编程能力提升 58pp」。它测的是**一条信息通道**——把约定放进记忆，
  能不能被 agent 用上。答案在这一轮是明确的「能」。
- 边界仍在：单模型（`deepseek-v4-flash` 本地部署）、4 个任务、每个任务 3 种子、
  一条臂只种 5 条记忆。样本小，方向可靠，量级别当真。

### 命中率与耗时一起看

带记忆 131.8s vs 不带 208.1s：**知道约定不只是更快通过，还少走弯路**——控制臂在
`money` 上平均 234s（三次全挂），因为它不知道「远离零」还是「四舍六入五成双」，
只能反复试。这条比通过率更难伪造成：时间是模型的真实成本。

## 12. 第五轮：把隔离做成结构性事实（2026-10-27 午）

第四轮之后还剩两个洞：`ordering` 是二选一（猜得中），隔离是**黑名单**（列得出所有能读的地方，
就列得出漏掉的）。第五轮两个都补了。

### 语料：`ordering` → `ranking`

排序口径改成三条叠加：`score` 升序、同分给**更长**的 `id`、全平则**倒序**输入顺序。
三选一叠起来没有任何可猜之处，第四轮控制臂 3/3 靠方向蒙对的漏洞消失（本轮 0/5）。

### 围栏：从「禁止列出」换成「默认收禁」

黑名单这条路在这个仓库里输了三次：仓库自己泄漏、`/tmp` 没做 realpath 解析、以及本轮
抓到的两次（下面写）。改成结构性的收禁（`eval/g6/sandbox-profile.mjs` 的
`buildConfinedProfile`）：

```
(allow default)                    ; 进程、网络照旧
(deny file-read* (subpath "/private/tmp") (subpath "/tmp") (subpath "<$HOME>"))
(allow file-read* …)               ; 只放回：ws、node、实验用的 DSH_HOME
(deny  file-read* <另一臂的 profile>)   ; 再挖掉唯一真正算答案的那块
```

三个必须记住的实现细节，都是踩出来的：

1. **`(deny file-read*)` 全局写会直接被拒**——`sandbox-exec` 起不来（Abort trap 6）。
   所以收禁只能写成「按根 deny + 窄 allow」。
2. **规则重叠时最后一条匹配的赢**。这是这套写法能成立的全部原因：先 deny 整个 `/tmp`，
   再 allow 自己的 ws，才可能在"其余 /tmp 全黑"的同时让 run 正常工作。
3. **`getcwd(2)` 和 `realpath(3)` 要逐级祖先的读权限**，否则 node 在启动时就
   `uv_cwd EPERM` / `realpath EPERM` 死掉。祖先用 `literal` 逐个放（不是 `subpath`，
   否则等于放开整棵树）。同理 `/tmp` 和 `/private/tmp` 两种写法都要发。

另外 run 的 `TMPDIR` 指到 ws 里——`/tmp` 已经黑了，不给它一个能写的临时目录，
失败原因就会从"猜不出约定"变成"写不了临时文件"。

### 本轮自己抓住的两次泄漏（都发生在跑批中途）

1. **自己的日志目录就是答案键。** `--log-dir` 默认放在本轮 out 下，而围栏对"本轮自己的
   目录"是豁免的——于是后跑的 run 能读到先跑的 `checks/*.log`，那里面有
   `expected 101, actual 100`。现在 harness 直接拒绝这种配置：
   ```
   Error: --log-dir … is readable inside the sandbox; put it under a /tmp/g6* directory that is NOT this round's root
   ```
2. **`/tmp/verify-ranking`。** 一个更早的 run 把验证脚本写进了 `/tmp`，控制臂
   `grep -rl 'rankRows' /private/tmp` 找到它，从文件注释里读出了排序口径。
   这不是"能力"，是**通道**。收禁整个 `/tmp` 之后这条路消失。

两次泄漏都发生在"以为已经隔离好了"之后，这就是为什么最后选择收禁而不是继续补黑名单。

### 结果：20 对配对，Δ = +90.0pp

| arm | pass | 平均耗时 |
|---|---|---|
| ab-engram | **20/20 (100%)** | 147.7s |
| ab-bare | **2/20 (10%)** | 219.7s |

逐任务（控制臂）：`codec 0/5` · `errcode 0/5` · `money 2/5` · `ranking 0/5`。

**那 2 次通过全在 `money`**，且不是运气：分位「四舍五入远离零」对一个认真写浮点的
实现者是可推导的（`Math.round` 的边界处理错了会自己发现）。所以 `money` 不算
"不可猜"的任务，结论要把它排除在外算——**另外三条真·不可推导的约定上（codec/errcode/ranking），
控制臂 0/15，带记忆 15/15。**

耗时同向：带记忆 147.7s，不带 219.7s。

artifact：`eval/g6/runs/r5-confined/runs.json`（40 行，含每行 `pass/exit/wallMs`）。

### 还剩一处泄漏：臂名在路径里（已修，未复跑）

工作区路径一直是 `<out>/ab-bare/…`，agent 在自己的 cwd 里就能看到"我是没有记忆的那一臂"。
20 个控制 run 里有 8 个提到并据此推理（"bare 臂没有 engram，去翻 team memory"），
但它们翻不到任何东西——围栏挡住了 store、另一臂的 profile、以及所有会话日志。

方向判断：这个泄漏只会让控制臂**更努力**去找约定（找不到），不会让它更容易通过，
所以 Δ 是偏保守的。代码里已改成中性目录名（`arm-a`/`arm-b`，映射记在 `runs.json` 的
`armLabels`），**但没有复跑**——这一轮的数字就按上面读，不要当成"零泄漏"的终值。

### 这组数字能说什么

- 能说：**规格不可从仓库推导时，种下的记忆把 4 个任务从 10% 抬到 100%**（20 对，4 任务 × 5 种子），
  且在三条任意约定上是 15/15 vs 0/15。
- 不能说：通用编程能力提升 90pp。测的仍是一条**信息通道**。
- 边界：单模型（本地 `deepseek-v4-flash`）、4 任务、5 种子、一臂一组种子记忆。
  Δ 的量级受任务选择影响极大，方向可靠，幅度别外推。

## 13. 第六轮：把臂名从臂能看到的一切地方抹掉（2026-10-28）

§12 留下的那句话是这一轮的起点：Δ=+90pp 测出来了，但**臂名写在 cwd 里**，8/20 的控制
会话据此推理过。本轮的目标只有一个——**让 Δ 在一个控制臂不可能知道自己属于哪一臂的
环境里成立**。

这一轮跑了三次才成，而且三次的失败都不是模型的问题，是**评测工具自己的窟窿**。按顺序
摊开，因为它们比最后的数字更值得记住。

### 13.1 设计（与 §12 同构，只换名与围栏）

| 项 | 值 |
|---|---|
| 语料 | `eval/fixtures/ledger-kata-blind`（4 任务：`codec` `errcode` `money` `ranking`） |
| 种子记忆 | `eval/g6/seed-memory-blind.json`（含一条**过期**的 `[stale:ranking]`，门第二句要它） |
| 配对 | 4 任务 × 5 种子 = **20 对**，`--control-first` |
| 两臂 | `p-a`（带记忆）/ `p-b`（裸）。目录名 `arm-a`/`arm-b`，映射只写在 artifact 的 `armLabels` |
| 隐藏 | `--hide-store-for p-b`：控制臂运行时 store 改名后**由围栏把 `storages/` 整个挂空**（同目录改名不是隐藏；移到 `$TMPDIR` 在 Linux 上跨设备 `EXDEV`） |
| 围栏 | `--sandbox`：按平台选机制——macOS seatbelt（默认收禁 + 放行白名单）、Linux bubblewrap（`--ro-bind / /` + 挂空 + 放行白名单）。两侧都禁 `/tmp`、`$HOME`、本仓库，只放行本臂 ws / 本臂 profile / 启动器 / 凭据；另一臂 profile 再禁一次。见 §13.6 |
| 环境 | Linux Ubuntu（内核 6.8）、node v22.22.0、`dsh` 0.2.1-rc.2、`dsh-engram` **0.8.8**（与第五轮的 0.8.2 不同代，见 §13.4 的"不能说"） |
| 日志 | `--log-dir`：run.log 与 check 输出一起移出 run 树，且整个目录对臂不可读 |
| 判据 | 预注册留一法 `Δ ≥ −2pp`（工具内置），配对下限 10 |

### 13.2 为了让"无泄漏"成立，修掉的十三道缝

每道都有证据，都不是"顺手优化"。

| # | 缝 | 证据（谁发现的） | 修复 |
|---|---|---|---|
| 1 | cwd 里就是臂名 | §12 的 8/20（第五轮已知） | 目录 `arm-a`/`arm-b`；本轮再把 profile 名换成 `p-a`/`p-b` |
| 2 | **种子键没解析**：`--out` 写 `/tmp/…`，插件按 `getcwd()` 记 `/private/tmp/…` | 冒烟：治疗臂引不出任何 `[seed-*]`，跟控制臂一个水平 | `seedStore` 用 realpath 后的 key；测试钉住"种子行必须带臂自己会算出的写法" |
| 3 | `--resume` 名不副实（TDZ 异常被吞，打印成"没有可续的行"） | 第四轮 ENOSPC 后是靠人手重跑的 | 挪到 plan 之后；日志打印复用了多少行 |
| 4 | 产物只在跑完后写一次 | 第六轮第一次：16/40 行时 ENOSPC，1.7 小时蒸发 | 每行原子落盘（`partial: true`）+ 开始前空盘预检（< 512MB 直接拒绝） |
| 5 | **臂能 `ls` 实验根**：祖先目录给的是 `file-read*`，在目录上就是"可枚举" | 第二次的控制日志：`ls /private/tmp/g6r14` 看到 `runs.json`/`arm-a`/`arm-b`，10/20 开始推理"这是评测矩阵" | 祖先只给 `file-read-metadata`（getcwd/realpath 仍活）；产物搬到 `--log-dir` |
| 6 | **共享 home 泄漏**：两臂共用 `DSH_HOME`，插件自己的记账文件写着另一臂 | 第三次：`recall-injections.json` 里 `lastWorkspace: /private/tmp/g6-smoke3/arm-a/…`；`ledger.json` 按 workspace 路径记 `injectedChars`；7/7 控制日志引用了 `profiles/ab-engram` | `scrubSharedHome()`：矩阵开始前清 sessions / injections / context-gc / ledger；profile 改中性名 |

| 7 | **插件包自带 `docs/`**：`dsh-engram` 的 tarball 把这一轮的评测文档一起装进治疗臂自己的 `node_modules`，而 `docs/G6-quality-ab.zh.md` 第 403 行**原文写着 codec 的公式** | 移植时读安装树：`profiles/p-a/node_modules/dsh-engram/docs/G6-quality-ab.zh.md:403` | 装完即删；并把两侧围栏都加一条"本臂包内 `docs/` 挂空"（重装也不会悄悄开口）。测试钉住"自己包里的语料文档读不到" |
| 8 | **语料写死上一台机器的绝对路径**：4 条 `check` 全是 `node /Users/sunchuxiong/dsh-loom/eval/g6/check.mjs …` | 移植后第一次冒烟：两臂 `fail`，`MODULE_NOT_FOUND`；换成无围栏跑也会这样，因为问题在判分器不在臂 | 语料改用 `${REPO}` 占位符，工具展开成当前 checkout；并加一条**拒绝**规则：`check` 里出现 oracle 文件却不带占位符就拒绝开跑（否则两臂全 0 → 闸门判"两臂持平 PASS"，是静默假结论，不是报错） |
| 9 | **臂继承了调用者的身份**：矩阵本身由一个 dsh 会话启动，`process.env` 里带着 `DSH_PROFILE_DIR`/`DSH_SESSION_ID`/`DSH_PROFILE=web`/`DSH_SHELL=1` | 起跑前 `env \| grep DSH_`：臂 `env` 一敲就知道自己在别人 `web` profile 的会话里，且 `DSH_SHELL`/`DSH_PROFILE_DIR` 会影响 dsh 怎么解析自己的 profile 与策略 | `armEnv()`：两臂只拿到 `DSH_HOME`，其余 `DSH_*` 全部剔除。测试断言臂看到的 `profile=/session=/shell=` 都是空 |
| 10 | **`--control-first` 的比较器永不返回 `-1`**：`sort((a,b) => (a是控制?0:1) - (b是控制?0:1))` | 读代码：这个比较器只说"不小于"，排序结果取决于引擎实现；而顺序**就是**隔离本身（控制跑在治疗之后就能读到治疗的 session） | 改成显式分区（`filter` 两遍拼起来）。测试断言 20 行里控制臂全部排在前 |
| 11 | **仓库"恰好"被藏住**：产物目录在 `$HOME` 下，于是被 home 那条规则连带挂掉——换个 checkout 位置就漏 | 移植时把 checkout 换到 `$HOME` 之外，读 `buildBwrapArgs` 发现没有针对 repo 的规则 | `repo` 与会话目录一样显式挂空（在 `$HOME` 内则不重复挂）。测试钉住"外层挂空里必须有 checkout" |
| 12 | **两臂可能指向不同的模型端点**：官方端点跑到一半没钱，最自然的"补救"是把剩下 7 行换到本地 vLLM 补齐——那样 40 行产物里的 Δ 一半是插件、一半是服务栈，而产物、日志、报表里**看不出来** | 自己想补跑时发现的：配对比较只在端点内部成立 | `assertSameTarget()`：`run` 开头对两臂各跑一次 `--dump-config`，把 `agent-default-model` 的 `provider`/`model` 比出来，不同就拒绝开跑；产物里记 `target`（`run` 自己写，`classify --target` 只在补写历史产物时人工声明，**不从当前 profile 猜**——profile 会被改，猜出来的是今天的端点配昨天的行） |

| 13 | **一臂一个 home 只是"重命名"**：两臂共用 `DSH_HOME`，`--hide-store-for` 把 store 在同目录里改名（试点控制臂 `ls storages/` 直接读到 `.g6-hidden` 后缀），围栏再补一刀把 `storages/` 挂空；`recall-injections.json`/`ledger.json` 仍写着另一臂的 workspace | 控制臂日志（`lastWorkspace`、`injectedChars`）+ 第七轮读代码复盘：缝 #6 的 `scrubSharedHome` 只能清**上一轮**痕迹，同一轮里共享的记账文件永远清不掉 | `armHome(home, arm)`：每臂一个 `DSH_HOME`（`arms/<arm>/{profiles,storages,sessions,engram}`），store 只种进治疗臂自己的 home，控制臂的 home 里根本没有可读的东西；围栏只 bind 本臂 home；`--hide-store-for` 保留为兼容参数但会打印"已无必要"。测试断言两臂 `DSH_HOME` 不同、且控制臂 home 里不存在 `dsh_engram.json` |

前四道会让数字**看起来**比实际好看或直接丢数据，后两道才真的把"臂知道自己是哪一臂"这条路堵死。
值得记下来的是它们的发现方式：**没有一道是靠读代码发现的，全是控制臂自己在日志里说出来的**。
这个评测的每一次进步，都是被自己的对照组教出来的。

### 13.3 环境事故

- **上游 502**：12:00 前后 DeepSeek endpoint 连续返回 502，第一批治疗的 run 全部 `exit 1`。
  处理：等 + 冒烟确认恢复；判据是"check 为真"而不是"模型说完成"，所以这只会浪费时间，不会污染数字。
- **移植当天的三次环境事故（都是工具自己的问题）**：
  1. **pnpm 起不来**：`dsh plugin add` 报 `[ERR_SQLITE_ERROR] unable to open database file`，
     连 `pnpm --version` 都失败。原因不是 pnpm 坏了，是**文件沙箱**：pnpm 的状态库在
     `~/.local/state/pnpm`，当时不可写。把 `XDG_STATE_HOME` 指到工作区后立刻正常；
     提权之后默认路径也能用。
  2. **`bwrap: execvp …/bin/dsh: No such file or directory`**：启动器是**符号链接**
     （`~/.npm-global/bin/dsh` → `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`），
     围栏只放行了 `bin/`，链接指向的包不在里面。修复：`toolReadPaths()` 先 `realpath`，
     放行**那一个包**（不是整个全局前缀——全局前缀是一堆别人的 `docs/`）。
  3. **`EXDEV: cross-device link not permitted`**：`--hide-store-for` 把 store 改名到
     `$TMPDIR`，macOS 上同盘，Linux 上 `/tmp` 是 tmpfs → 不同设备。改成同目录改名 +
     围栏把 `storages/` 挂空（缝 #6 的教训仍然成立：同目录改名本身不算隐藏）。
- **跑批中途余额用尽（QUOTA）**：16:12 起 endpoint 返回 `QUOTA: Insufficient Balance`，最后 7 行
  治疗臂每次 **2.2 秒**就退出。当时工具把这 7 行记成"任务失败"——**这是这一轮最危险的一处错误**：
  它把"我们没钱了"记成"臂做不出来"，而方向恰好对插件有利（把真实的 100% 记成 65%）。
  修复两条，都是这一轮加的：① `infraReason()` 只在"识别到 QUOTA / CREDENTIAL / UPSTREAM / NETWORK
  **且这一行没有真的动手**（没通过 + 日志 < 40 行）"时标 `infra`，并将其从分母里排除，闸门备注
  写明排除了哪几行；② `--resume` 把 infra 行当作"没做"重跑，并按 `task|seed|arm` 去重（原来重跑
  会把同一行算两遍，分母直接翻倍）。
  为什么要"没有真的动手"这一条：`money/seed-2` 在 198 行真实工作后、**最后一次调用**上撞了 QUOTA，
  但它的 `check` 通过——它是一行数据。规则不能只看"日志里有没有 QUOTA 这个词"。

- **磁盘满（ENOSPC）**：12:30 那次在 16/40 行时炸掉，产物一个字没落盘。原因与本项目无关
  （`$TMPDIR` 里一个 2.5GB 的 Instruments trace，外部进程写的），但它暴露了 #4。
  清理后 7.3GB 可用，本轮产物总共 1.7MB——**评测数据从来不是磁盘问题的成因**。

### 13.4 结果

**两份矩阵，同一套语料/围栏/开关，只换端点。** 主结果是本机 vLLM 上跑满的 40 行；官方 API 那次
是第一次尝试（13/20 对，中途余额用尽），留作独立复现，两份产物都进仓库、都不改写。

#### 13.4.1 本地 vLLM（主结果，40/40 行）

端点 `local-vllm-61`（`http://172.27.221.61:8003/v1`，模型 `deepseek-v4.1-flash-1017`，与官方
开源同款），两臂都指向它——**配对比较只在端点内部成立**，所以换端点必须整轮重跑，不能混行。

| 臂 | 通过 | 通过率 | 平均墙钟 | 中位墙钟 |
|---|---|---|---|---|
| `p-a`（带 `dsh-engram` 0.8.8） | 20/20 | 100.0% | 85.2s | 67s |
| `p-b`（裸） | 2/20 | 10.0% | 199.8s | 162s |

逐任务（通过 / 行数）：

| 任务 | `p-a` | `p-b` |
|---|---|---|
| codec | 5/5 | 0/5 |
| errcode | 5/5 | 0/5 |
| money | 5/5 | **2/5** |
| ranking | 5/5 | 0/5 |

Δ = **+90.0pp**（20 对配对，only-`p-a` 18 / only-`p-b` 0）→ **G6 PASS（Δ ≥ −2pp）**。
`infraRows = 0`（没有一行没拿到模型）、`contaminated = 0`（40 行日志没有一条提到 store / `[ENGRAM]` /
另一臂 / `runs.json`）。

#### 13.4.2 官方 API（第一次尝试，13/20 对）

同一套命令、同一个模型 id，只是走官方付费端点。跑到 `money` seed 3 时账户余额用尽
（`QUOTA: Insufficient Balance`，余额 ¥0.19），最后 7 行治疗臂（`money` 3/4、`ranking` 0–4）每次
2.2 秒退出。这 7 行被标成 `infra` 并从分母里排除，**不再当任务失败算**（§13.3 第四条）。

| 臂 | 通过 | 通过率 | 平均墙钟 |
|---|---|---|---|
| `p-a` | 13/13 | 100.0% | 30.7s |
| `p-b` | 1/20 | 5.0% | 127.6s |

13 对有效配对 → Δ = **+95.0pp**；把 7 行 infra 当失败的保守口径（20 对）= `p-a` 13/20 = 65% vs
`p-b` 1/20 = 5% → **+60.0pp**。两种口径都 PASS。

#### 13.4.3 怎么读这两个数

- **方向与结论在两个端点上一致**：本地 +90.0pp（20 对完整）、官方 +95.0pp（13 对）。
  同一个模型 id、两套服务栈、两次独立跑批，`p-a` 一行没输——这比单次跑出的幅度更有说服力。
- **幅度不能跨端点比较**：本地端点明显更慢（`p-b` 200s vs 官方 128s），但墙钟不是质量证据，
  换端点只换"谁跑得更快"，不换"谁做得对"。
- **`money` 是唯一"能猜中"的任务**：裸臂 2/20 蒙对了取整口径（官方 1/20、本地 2/20）。它把 Δ 拉低，
  正好说明其余三个任务（`codec`/`errcode`/`ranking`）的约定**猜不出来**。
- **不能与第五轮的 +90pp 比同**（数值巧合，不是证据）：插件 0.8.2 → 0.8.8、语料 `check` 改成
  `${REPO}`、围栏换成 bwrap、端点也从官方换成 vLLM。两轮只能各自独立读。
- **不能外推**：4 个任务、单模型、n = 20 对；这是一份"在这套语料上没有伤害、且带去可用信息"的证据，
  不是"engram 普遍提升 90pp"。
- **墙钟不作为证据**：同一天见过 30s–814s 的抖动。

### 13.5 还剩什么缝（诚实清单）

- ~~控制臂能看见 run 树的兄弟目录名~~（第七轮前修掉）：run 根现在是 `runs/<sha1(task|seed|arm)[0:8]>`，
  臂自己的 cwd 里不再出现臂名、任务名、seed 编号，也不再透露"这是一个矩阵"；映射记在
  `runs.json` 的每一行（`runKey`）里，人能查、臂读不到。围栏再把 run 根整个挂空、只挂回
  `ws`，连本行自己的 `run.log` 都读不到。
- 控制臂仍能**看见**本臂 profile 里那个 `docs/` 曾被删掉这件事的痕迹（目录不存在），
  以及能推断出"本机的实验目录存在"（`DSH_HOME` 的祖先路径）——但内容一律读不到。
  缝 #7 的代价从"`storages/` 是个空挂载"降级成"这一臂的 home 里压根没有 `storages/`"（缝 #13）。
- 单模型、9 任务；Δ 的量级受任务选择影响极大，方向可靠，幅度别外推。
- 语料 migration 只做到"换机器能跑"：`${REPO}` 之外，产物里的 `wallMs` 仍受端点抖动
  影响（本轮见过 52s–814s），**不能**当质量证据。

### 13.6 围栏换了机制：seatbelt → bubblewrap（同一份契约，两套实现）

第五轮的围栏是 macOS 的 `sandbox-exec`（seatbelt）：**默认收禁 + 白名单放行**，规则
最后一条匹配者生效。这一轮在 Linux 上没有 seatbelt，换成 `bwrap`（bubblewrap）：
**先 `--ro-bind / /` 得到一整棵只读树，再逐条"挂空/挂回"**，规则第一个挂载者生效。
两种机制方向相反，所以不能照抄规则，只能照抄**契约**：

| 契约（围栏要保证的事） | seatbelt 写法 | bubblewrap 写法 |
|---|---|---|
| 本臂 ws 可读可写 | `(allow file-read* / file-write* (subpath ws))` | `--bind ws ws` |
| 本臂 profile 可读 | 放行实验 home，再把另一臂 profile 禁掉 | `--bind <实验 home>`，`--tmpfs <另一臂 profile>` |
| `$HOME`、`/tmp`、本仓库不可读 | `(deny file-read* (subpath …))` | `--tmpfs $HOME`、`--tmpfs /tmp`、`--tmpfs <repo>` |
| 祖先目录可 lstat 但不可枚举 | `(allow file-read-metadata (literal …))` | 由 `--ro-bind / /` 天然满足 |
| 凭据可读（否则 `MISSING_CREDENTIAL`） | `(allow file-read* (literal credentials))` | `--ro-bind credentials credentials` |
| 本臂包内 `docs/`、被隐藏的 `storages/` 不可读 | 末尾再 `(deny …)`（最后匹配者生效） | `--tmpfs <那两处>`（挂载后写） |

还有一条不属于"两套写法"，是两者的共同边界：`fenceCommand()` 在既不是 darwin 也不是
linux 的平台上**抛错**
（`G6 has no OS-level fence for <platform>`），而不是"没有围栏也照跑"。没有围栏的 Δ
只是下界（§10 的教训），工具不该让人有机会搞混这两件事。

回归测试 `test/g6-sandbox.test.mjs` 两套实现共用：搭一个真实的目录布局（本臂 ws 在
`root/out/arm-b/…/ws`，兄弟 `arm-a`、`logs/runs.json`、另一臂 `seeded-store.json`、
`creds/.credentials.yaml`），然后在围栏里断言——

- 能读能写本臂 ws、`process.cwd()` 就是 ws 的 realpath、凭据可读、本臂 profile 可读；
- 读不到：`logs/runs.json`、兄弟臂的 `answer.txt`、另一臂的 `seeded-store.json`、
  `~/.dsh`、`<ws>/package.json` 之外的本仓库文件、**本臂包里的语料文档**；
- `ls` 实验根时**看不到** `runs.json` / `arm-a` / `logs` 这些名字（bwrap 会为 bind 造出
  父目录骨架，所以断言的是"名字集合"，不是"目录不存在"）。

**变异检验**（这一条决定了测试是否真的在测围栏）：把 `--tmpfs /tmp` 注释掉，测试立刻
变红，并且打印出它看见的名字：`saw creds, home, logs, out, arm-a, arm-b, codec, runs.json`。
还原后重新变绿。换句话说，这条测试不是"跑通了"，是"该红的时候会红"。

### 13.7 换端点必须整轮重跑（这一轮踩过的坑）

第一次尝试走官方付费端点，跑到一半余额用尽（¥0.19），剩下 7 行跑不动。**不能**把这 7 行换到本地
端点补上再拼成一份 40 行——配对比较只在端点内部成立，混端点等于把"臂的差异"和"服务栈的差异"
搅在一起，而后者恰好是这一轮唯一想排除的东西。正确做法是整轮换端点重跑（第 13.4.1 节就是）：

```bash
# 两端点各跑一次，产物互相独立（r6-neutral = 官方 API，r6-local = 本地 vLLM）
node eval/quality-ab.mjs run \
  --tasks "$PWD/eval/g6/tasks-blind.json" \
  --workspace "$PWD/eval/fixtures/ledger-kata-blind" \
  --arm p-a,p-b --seeds 5 \
  --out "$PWD/eval/g6/runs/r6-local" --home "$HOME/.dsh/quality-ab" \
  --seed-memory "$PWD/eval/g6/seed-memory-blind.json" \
  --sandbox --control-first \
  --log-dir "$HOME/.dsh/quality-ab-logs/r6-local"

# 中断/余额不足之后：--resume 复用已完成的行，只重跑 infra 行（并按 task|seed|arm 去重）
# 加上 --resume 即可；产物写早了就用 classify 从日志重判 infra：
node eval/quality-ab.mjs classify --out "$PWD/eval/g6/runs/r6-local" \
  --log-dir "$HOME/.dsh/quality-ab-logs/r6-local"
```

第七轮起 `--home` 下是 `arms/<arm>/`（一臂一个 `DSH_HOME`，见 §13.2 缝 #13），
`--hide-store-for` 不再需要（参数仍接受，会打印"已无必要"）。

臂的端点由各自的 `~/.dsh/quality-ab/profiles/<arm>/cordis.patch.yml` 决定（`llm-pi-ai` 的
`providers` + `agent-default-model`）；两臂必须指向同一个 `provider`/`model`，否则整批数字作废。

## 14. 第七轮：一臂一个 home + 语料扩容（2026-10-28 晚，本地 vLLM）

### 14.1 这一轮的五个变化

| # | 变化 | 为什么 |
|---|---|---|
| 1 | 一臂一个 `DSH_HOME`（`arms/<arm>/`） | 缝 #13：共享 home 里另一臂的记账永远清不掉 |
| 2 | run 根不透明 `runs/<sha1(task\|seed\|arm)[0:8]>/ws`，围栏连本行 `run.log` 都挂掉 | §13.5 最后一项残留：臂从自己 cwd 就能读出臂名/任务/seed |
| 3 | 语料 4 → 9 任务 | 4 个任务时一个任务的运气就能翻身 25pp |
| 4 | 每个 oracle 双向验证（`test/g6-corpus.test.mjs`） | 不可满足的 oracle 会让两臂 0/0 → 闸门报"持平 PASS" |
| 5 | 端点换成**本地** vLLM（`local-vllm-61/deepseek-v4.1-flash-1017`） | 官方 API 余额耗尽；同款开源权重，但**不能**与 §13.4 的数字互比 |

**所以这一轮的 Δ 不能与第五轮（+90pp）、第六轮（+90pp）相提并论**：插件版本、语料、
围栏、home 布局、端点全都不同。数值接近只是巧合，不是复现。

### 14.2 语料：九个"只能被告诉"的约定

每个任务配一条只在记忆里存在的约定。第三列是**没有记忆时一个称职的 agent 会怎么写**——
`test/g6-corpus.test.mjs` 把这一列真的实现出来并跑 oracle，**必须挂**，否则这个任务测的是模型的先验。

| 任务 | 约定（只在记忆里） | 没有记忆时最自然的写法 | 自然写法挂在哪 |
|---|---|---|---|
| `codec` | 校验位 = `charset[Σ(digit×3+7) mod 36]`，charset 是小写 `0-9a-z` | 按 Luhn / mod 10 | 1/1 全挂 |
| `errcode` | `E_<CODE>: <msg>`，`.code` 存裸码，非 `UPPER_SNAKE` 直接抛 | `throw new Error(message)` | 3 条挂 2 |
| `money` | 金额按**整数分**累加，四舍五入远离零 | `toFixed(2)` / 浮点累加 | 2/2 全挂 |
| `ranking` | score 升序；同分**id 长者先**；再同则入参逆序 | 稳定排序 / 降序 | 2 条挂 1 |
| `pad` | `L-` + 5 位零填充；冲正数尾部加 `C` | `padStart(5)` 或 `padStart(6)` | 2 条挂 1 |
| `window` | 账期以 **Asia/Shanghai 04:00** 为界 | 按 UTC 零点切 | 2/2 全挂 |
| `dedupe` | 同 id 取**最后一条内容**、**第一次出现的位置**，不改入参 | 先到先得 | 2 条挂 1 |
| `quote` | 撇号千分位 + 负数括号 | `toFixed(2)` | 2/2 全挂 |
| `retry` | 5xx/429/`E_LEDGER_LOCKED` 可重试，`E_VALIDATION` 永不，最多 3 次 | 只重试 5xx | 2 条挂 2 |

九个 oracle 都能被"照约定写"的实现通过（参考实现在测试里），也都挡得住"照常识写"的实现。

### 14.3 这一轮又抓到的两个工具 bug

1. **`check.mjs` 在测试环境里静默跑空**：它内部 `node --test`，而调用者若本身在测试运行器里，
   环境带着 `NODE_TEST_CONTEXT`，孙进程会以"测试子进程"身份启动、**一条都不跑并退出 0**——
   所有 stub 都会被判 PASS。`test/g6-corpus.test.mjs` 上线一分钟就抓到它。现在判分用干净环境。
2. **`armEnv()` 重建环境时丢了凭据**（冒烟抓到）：`armEnv(home)` 从 `process.env` 重建，
   把 `liftCredential()` 放进副本里的 `LOCAL_VLLM_61_API_KEY` 丢了，两臂 1.5s 就
   `MISSING_CREDENTIAL`。行被正确判成 `infra`，没有污染 Δ——但那是分类器的功劳，不是跑批的。

### 14.4 结果（本地 vLLM，18 行/臂，2026-10-28 21:03–22:30）

| 臂 | 通过 | 率 | 平均墙钟 |
|---|---|---|---|
| `p-a`（挂 engram） | 18/18 | 100.0% | 72.7s |
| `p-b`（裸机） | 1/16 | 6.3% | 107.5s |

**Δ = +93.8pp，16 对配对，`local-vllm-61/deepseek-v4.1-flash-1017`，`infra` 0 行。**

逐任务（两位是 seed 0/1）：

| 任务 | p-a | p-b | 说明 |
|---|---|---|---|
| codec / errcode / money / pad / window / quote / retry | 11 | 00 | 控制臂两次都写了"常识"版本 |
| ranking | 11 | 01 | seed 1 那次**算出来的**——但它去网上查了答案（见 §14.5） |
| dedupe | 11 | 10 | seed 0 是控制臂**自己想对**的（先到先得恰好等于约定），seed 1 挂了 900s（超时） |

`p-b` 唯一有效的那一分是 `dedupe/0`：约定"取最后一条内容、保留第一次出现的位置"
在这条数据上恰好与"先到先得"同解。这是好事——它说明语料不是"不可能任务"。

### 14.5 这一轮最重要的发现：控制臂能上网查答案

`runs.json` 里两行控制臂被标 `contaminated`，日志原文：

```
ranking/seed-1: "Aha! The commit `skepsun/dsh-engram` … This is exactly the eval!
                 The repo is public. We can inspect it. … shallow clone."
dedupe/seed-1:  同类，先 `curl https://api.github.com/search/code?q=…`，再克隆仓库
```

**为什么可能**：围栏（bwrap）只围文件系统，不围网络；而语料**是公开的**——
`docs/G6-quality-ab.zh.md`（这份文档）在插件包里、也在仓库里，§14.2 那张表就是答案。
这两件事凑在一起，控制臂只要 `curl` 就能把"团队约定"读出来。

**修了什么**：

1. `analyze()` 现在**不把不盲的行算进分母**（以前只标 `contaminated`，照样计入 Δ）。
   两行被剔除后，13.5% 的"控制臂得分"变成 6.3%，Δ 从 88.9pp 变成 93.8pp——
   方向没变，但**一个会让记忆看起来更差的 bug 被修掉了**。
2. 污染正则扩到网络检索（`curl`、`git clone`、`grep.app`、`raw.githubusercontent`、
   `github.com/search`），并有测试钉住"不盲的行不进分母"。
3. 文档（本文件）从此**只描述方法，不写本轮答案**——§14.2 的约定表是"上一轮的"，
   下一轮必须换一套（见下）。

**还没修的（诚实清单）**：

- **网络围栏没有**。按 uid 做 iptables 白名单（只放行模型端点）在本机可行且已手动验证过
  （`setpriv --reuid=<uid>` + `-m owner --uid-owner`），但需要 root 和把实验 home 搬到
  中立路径（`/d1/chuxiong` 是 700，被围的 uid 进不去），这一轮没做。
- **语料仍是一次性手写的**。正解是**每轮用密钥生成**：任务模板 + 密钥文件（不入库）
  → 生成记忆文本、oracle、参考实现；公开的只有生成器。这样"能上网"不再是漏洞。
- 两行"想到了但没做"（`money/seed-1` 想 `web_fetch`、`pad/seed-1` 试了 `skill` 名字）：
  诱因普遍存在，别指望模型自己克制。

所以这一轮的 Δ=+93.8pp 只在"控制臂没去查、且查了会被剔除"的意义上成立；
**在我把密钥化和网络围栏补上之前，这个数不能当作对外结论。**

## 15. 第八轮：语料从密钥编译（公开生成器，保密这一轮）

§14.5 的结论是：**公开的语料 + 开放的网络 = 控制臂可以查到答案**。围栏只围文件系统，
所以堵网络是一半；另一半是让"公开"这件事不再有意义——**每轮的约定由密钥抽出来**。

### 15.1 怎么用

```bash
# 一次性：造一个密钥（不进 git，权限 600）
(umask 077; head -c 48 /dev/urandom | base64 | tr -d '\n' > ~/.dsh/g6-secret)

# 编译一轮：抽出约定 → 生成记忆文本 + 私有 oracle + 参考实现 + 自然错解
node eval/g6/make-round.mjs --secret ~/.dsh/g6-secret --name r8 --out eval/g6/local/r8
# 9/9 tasks usable · key.json is the answer key: keep it out of git
```

产物全在 `eval/g6/local/<轮次>/`（已 gitignore）：`key.json`（抽到的约定）、
`seed-memory.json`（同一批约定写成记忆文本）、`tasks.json`、`oracle/`、`ref/`、`naive/`。
跑法和以前一样，`--tasks`/`--seed-memory` 指过去即可。

### 15.2 三轮自证（生成器不通过就不出语料）

1. **参考实现必须过**：`ref/<id>.js` 与 oracle 是同一份约定的两个写法，若不一致就是生成器的 bug，
   **当场失败**（不重抽 —— 重抽会把 bug 藏在"某次刚好对"的抽样后面）。
2. **自然错解必须挂**：`naive/<id>.js` 是"没有记忆时会写的那版"。若它也能过，这一抽**作废重抽**
   （最多 24 次）——一轮里不允许存在"猜就猜对"的任务。
3. **oracle 只能断言记忆说过的**：若 oracle 要求抛 `TypeError` 而记忆文本没写，生成器直接报错。
   这条是第一次冒烟用真模型跑出来的：`pad` 的 oracle 要求非整数抛错，记忆里没这句话，
   **处理臂明明知道约定还是挂了**——错的不是模型，是语料。

### 15.3 这解决了什么、没解决什么

- 解决了：仓库公开不再等于答案公开。读到本文件、读到生成器、甚至读到上一轮的 `eval/g6/local/r7/`
  都没用——这一轮的约定是另一套（测试断言：换密钥后 ≥7/9 个任务的约定不同）。
- 没解决：**网络围栏仍然没有**。控制臂如果去网上找、而恰好有人把某一轮的 key 泄露出去，
  它仍可能查到。密钥化把"必然可查"降级成"没人泄露就查不到"，围栏才是把这条路彻底堵死。
  两件事都要做（`tsk_19e5e5bc`）。

### 15.4 每轮的可比性

不同轮次之间**约定不同**，所以逐任务的"这一轮对/错"不能跨轮比较；能跨轮比较的只有
"两臂在同一轮里的差"。这也意味着 `eval/g6/local/` 下的产物是**实验记录**，
丢了就要用同一个密钥重编译（同一密钥 → 同一轮，测试钉住了）。

### 15.5 第八轮结果（密钥语料 · 控制臂全盲）

`eval/g6/runs/r8-local/`（commit 见下），目标端点仍是本机 `local-vllm-61/deepseek-v4.1-flash-1017`，
9 任务 × 2 seed × 2 臂，`--sandbox --control-first`，每臂独立 `DSH_HOME`。

| 臂 | 通过 | 比例 | 平均墙钟 |
|---|---|---|---|
| p-a（挂 engam） | 18/18 | 100.0% | 94.9s |
| p-b（裸） | 0/18 | 0.0% | 117.6s |

Δ = **+100.0pp**（18 对配对，only-p-a 18，only-p-b 0）；闸门 PASS（目标 Δ ≥ −2pp）。
`infraRows 0`、`contaminated 0`、`notBlindExcluded 0`。

**控制臂这次是真的全盲**：18 份控制日志里 `dsh_engram`/`engram_recall`/`[ENGRAM]`/`curl`/`git clone`
一次都没出现（第七轮有两份在查 GitHub）。这一轮的意义不只是"处理臂满分"，而是
**它没有可以查的答案**——语料是本轮密钥抽出来的，仓库里不存在这套约定。

**必须一起说的两点**：

1. **+100pp 不是"记忆在真实任务上的提升"。** 语料的构造就要求"没有记忆必然猜不中"
   （猜得中的抽样被丢弃重抽），所以天花板本来就是 100pp。这一轮测的是
   **"把约定写进记忆，臂能不能照做"**——能，18/18。真实任务大多可猜，收益会小得多；
   G6 是机制闸门，不是效果预测。
2. **和第七轮不可比**：约定不同、语料不同。能跨轮说的只有一句：第七轮控制臂能上网查答案
   （已剔除 2 行），第八轮查不到（密钥化 + 已核实的盲区）。第七轮的 +93.8pp 因此**不能**
   对外当结果，第八轮才可以。

## 16. 网络围栏：一臂一个 uid，出网只留一个洞（2026-10-29）

§14.5 留下的洞只有一个：**围栏只围文件系统，网卡还在**。第七轮的控制臂因此去 GitHub
查到了约定。密钥化把"必然查得到"降成了"没人泄露就查不到"，但只要臂有 shell 和 socket，
"没人泄露"就仍然是一个假设。这一节把假设变成机制。

### 16.1 为什么不是"再写几条 bwrap 规则"

bubblewrap 管文件系统，不管网络：`--unshare-net` 会把网卡整个拿掉，模型端点也就没了。
要"只允许一个出口"，需要的是**按进程身份**的过滤，也就是 iptables 的 `owner` 匹配——
它需要一个独立的 uid。于是围栏变成两段：

```
sudo bwrap …（搭挂载树）
  └── setpriv --reuid=1016 --regid=1016 --clear-groups
        └── /bin/sh -c 'set -a; . $HOME/.netenv; set +a; umask 000; exec "$0" "$@"'
              └── dsh --profile p-a "<task>"
```

宿主机上另有三条 `iptables -I OUTPUT -m owner --uid-owner 1016 …`：默认 REJECT，
只放行 loopback 和 `172.27.221.61:8003`。规则**只按 uid 生效**，所以本会话、harness、
并发跑的 Web GUI 都不受影响——这是按 uid 而不是按进程过滤的意义。

```bash
node eval/quality-ab.mjs run … --sandbox --net-fence --net-endpoint 172.27.221.61:8003
```

### 16.2 两个前置探针：不合格就不计分

围栏自身会坏，而坏掉的围栏产生的恰恰是最危险的数字：一个"看起来双盲、其实不盲"的矩阵。
所以 `--net-fence` 在花任何模型时间之前先做两次自证：

1. **出网探针**（以 1016 身份跑）：端点必须可达、`github.com` 必须 000、DNS 必须死。
   任一条不符就 `throw`，不跑矩阵。实测：`endpoint reachable (401), github 000, dns dead`。
2. **写目录探针**（走同一条 fence，`touch` 一个文件）：臂必须能在自己的 ws 里写。

第二条不是形式主义。第一次带围栏的冒烟里，ws 是从模板 `cpSync` 出来的、
属 `chuxiong:chuxiong 775`，而臂是 1016——**臂能读不能写**，于是它把工作做在 `/tmp` 副本里、
汇报"这个工作区对我只读"（那是控制臂，它甚至把这个发现写进了报告）。
四条行全部 0.x 秒失败，`rm -rf` 也删不掉 1016 建的临时目录。
现在 ws 每次复制后 `chmod -R a+rwX`，并在矩阵开始前用探针证明一次。

### 16.3 密钥不进 argv

`env -i K=V …` 会被写进进程的 argv，而 argv 对宿主机上每个用户都可见（`ps`）。
所以凭据走**文件**：每行一个 `envFile`（`<runHome>/.netenv`，600，属 1016，
随行删除），由 fence 里的 sh `set -a; . file; set +a` 导出。

- 只有**本臂 provider 那一个** key 会进文件（`local-vllm-61` → `LOCAL_VLLM_61_API_KEY`），
  付费 API 的 key 不发给任何一臂。
- `set -a` 不是装饰：只 `. file` 是赋值不导出，dsh 起来就是 `MISSING_CREDENTIAL`
  ——这条也是冒烟里踩出来的（4 行全部被判 CREDENTIAL，而不是当成任务失败计分）。

### 16.4 冒烟里暴露的语料 bug（§15.2 的第 4 条自证）

带围栏的冒烟跑出 `p-a` 在 `retry` 上挂了一次，原因不是围栏：**工作区里的 stub 和 prompt
签的是两个函数**——`src/retry.js` 写着 `shouldRetry(status, code, attempt)`，
而 prompt、记忆文本和 oracle 都写 `shouldRetry(attempt, error)`。臂只能挑一份文档信，
挑哪份是硬币。第八轮 p-a 在这一题上 2/2 通过，纯粹是硬币落对了面。

生成器现在有第 4 条自证（编译期，不通过就不出语料）：

- stub 必须导出 prompt 点名的那个函数（当时 `ranking.js` 导 `rankRows`、`dedupe.js` 导 `mergeRows`）；
- stub 的参数个数必须等于 prompt 里写的参数个数（`errcode` 是 3 个，oracle 故意只传 2 个测试
  `.details` 缺省，这是合法的：**oracle 可以少传，不能多传**）。

补上这条之后，同一把密钥编译出的第九轮 **9/9 usable**，另外三处 stub 冲突
（`retry`/`ranking`/`dedupe`）一并不存在了。

### 16.5 这一节解决了什么、还剩什么

- 解决了：臂没有可用的出网路径（含 DNS）。第七轮那两份"去 GitHub 查"的日志，
  在围栏下会变成 `curl` 立刻失败——不是"没找到"，是"出不去"。
- 还剩：**`--net-fence` 需要 root**（装 iptables 规则）。这是刻意的取舍：没有 root
  就没有按 uid 的过滤；harness 会把 `sudo -n` 的失败当成硬错误，不会静默降级成"无围栏"。
- 还剩：uid 是宿主机级的（`g6arm`，1016）。同一台机器上并发的两轮矩阵会共用这个 uid
  和它的规则集，所以**同一时刻只跑一轮带围栏的矩阵**。
