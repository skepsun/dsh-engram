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

### 13.2 为了让"无泄漏"成立，修掉的十一道缝

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

> 状态：**13/20 对有效**。`codec`/`errcode` 各 5 对、`money` 3 对有效；**`ranking` 的 5 行治疗臂
> 一次都没跑起来**（余额用尽，见 §13.3 第四条）。数字是真的，但"ranking 这一轮没被测到"必须
> 和数字一起读。

| 臂 | 通过 | 通过率 | 平均墙钟 |
|---|---|---|---|
| `p-a`（带 `dsh-engram` 0.8.8） | 13/13 | 100.0% | 31s |
| `p-b`（裸） | 1/20 | 5.0% | 128s |

逐任务（通过 / 有效行；infra = 从未拿到模型，不计入）：

| 任务 | `p-a` | `p-b` |
|---|---|---|
| codec | 5/5 | 0/5 |
| errcode | 5/5 | 0/5 |
| money | 3/3（另有 2 行 infra） | 1/5 |
| ranking | 0/0（5 行全是 infra） | 0/5 |

Δ = **+95.0pp**（13 对配对，only-`p-a` 13 / only-`p-b` 0）→ **G6 PASS（Δ ≥ −2pp）**。

两种口径都写下来，因为它们回答两个不同的问题：

- **配对口径**（13 对，两臂都真的跑过）：**+95.0pp** —— "记忆在场时能到什么程度"。
- **保守口径**（20 对，把 7 行没跑起来的治疗臂当失败）：`p-a` 13/20 = 65% vs `p-b` 1/20 = 5%，
  **+60.0pp** —— "就算那 7 行全失败也不会翻转"。

两个口径都 PASS，所以**判定**不依赖口径；**幅度**依赖口径，所以别引用单一数字。控制臂唯一
那一分（`money` seed 3）正落在治疗臂 infra 的那一对上，配对时整对被丢掉——这是唯一一处"排除
对插件有利"的地方（丢掉的是控制臂的运气分）。因此 +95.0pp 读作"13 个完整对上的值"，+60.0pp
是下界。

污染标记：**0 行**。第四轮 10/20、第五轮 2 行控制日志提到过评测矩阵；这一轮（围栏 + `--log-dir`
+ 缝 #7–#11）一条都没有。

墙钟 31s vs 128s 方向一致（治疗臂知道约定，不用试探），但同一天见过 17s–814s 的抖动，
**不当作证据**。

**能说什么**

- 在"约定只写在记忆里、`check` 私有、仓库与另一臂都被挂空"的前提下，挂载臂把 `codec`/`errcode`
  做到 10/10，裸臂 0/10（`money` 上蒙对 1/5）。这不是"模型更努力"能解释的差：语料里没有约定，
  也没有任何可读的答案。
- 记忆注入没有让任务变差：单侧门 Δ ≥ −2pp 就是为"挂载会不会拖累"设的，13 个完整对里
  没有任何一对是 `p-a` 输。
- 围栏现在是**可复制的**：同一份契约在 macOS seatbelt 与 Linux bubblewrap 上跑同一套回归测试，
  变异检验能把它弄红（§13.6）。

**不能说**

- **不能说 0.8.8 比 0.8.2 强**：这一轮插件版本变了（0.8.2 → 0.8.8），语料的 `check` 也从写死路径
  改成 `${REPO}`，**与第五轮的 +90pp 不可比**，两轮只能各自独立读。
- **不能外推幅度**：4 个任务、单模型、13 对；`money` 上控制臂 1/5 是蒙对了取整口径——"能猜中的
  任务"会把 Δ 拉低，`ranking` 这一轮则完全没测。
- **不能把墙钟当质量**：端点抖动与任务难度无关。
- **不能把这一轮当成"第六轮已完成"**：还差 `ranking` 5 行 + `money` 2 行（治疗臂），补跑命令见 §13.7。

### 13.5 还剩什么缝（诚实清单）

- 控制臂仍能**看见**两项 profile 存在、能看见 run 树的兄弟目录名（`arm-a`/`arm-b`）——
  它知道"有另一个臂"，但不知道哪个臂有什么，也读不到任何东西（围栏测试钉住了这一点）。
- 单模型、单语料、4 任务；Δ 的量级受任务选择影响极大，方向可靠，幅度别外推。
- 控制臂仍能**看见**本臂 profile 里那个 `docs/` 曾被删掉这件事的痕迹（目录不存在），
  以及 `storages/` 是个空挂载（缝 #7/#8 的代价是"空"而不是"无"）。
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

### 13.7 补跑剩下的 7 行（账户有钱之后）

```bash
node eval/quality-ab.mjs run \
  --tasks "$PWD/eval/g6/tasks-blind.json" \
  --workspace "$PWD/eval/fixtures/ledger-kata-blind" \
  --arm p-a,p-b --seeds 5 \
  --out "$PWD/eval/g6/runs/r6-neutral" --home "$HOME/.dsh/quality-ab" \
  --seed-memory "$PWD/eval/g6/seed-memory-blind.json" \
  --hide-store-for p-b --sandbox --control-first --resume \
  --log-dir "$HOME/.dsh/quality-ab-logs/r6"
```

`--resume` 复用 33 行（控制臂 20 行 + 治疗臂 13 行），只重跑 7 行 `infra`（`money` seed 3/4、
`ranking` seed 0–4）。跑完 `runs.json` 里 `infraRows` 归零，再照 §13.4 重算两个口径；
如果哪个任务仍然 `infra`，说明是环境问题，不是臂的问题——**别把它算成失败**。

