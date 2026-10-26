# dsh-engram v0.7.16

**G6 有了测量装置，并且自己先承认「跑 1 对不算数」。**

## 1. G6 是唯一不能从日志里算出来的门

日志能回答「机制跑了没有、省了多少」，回答不了「任务变容易了还是变难了」。
后者只能同题同种子跑两臂。

新增 `npm run quality:ab`（[eval/quality-ab.mjs](eval/quality-ab.mjs)）：

```bash
node eval/quality-ab.mjs prepare --arm on=ab-engram,off=ab-bare --home ~/.dsh/quality-ab
DSH_HOME=~/.dsh/quality-ab dsh plugin --profile ab-engram add ~/.dsh/vendor/dsh-engram-0.7.16.tgz
node eval/quality-ab.mjs run --tasks tasks.json --workspace ./fixture \
  --arm ab-engram,ab-bare --seeds 3 --out runs/g6 --home ~/.dsh/quality-ab
```

- 每个 run 复制一份 fixture workspace，先跑 `setup`，再 `dsh headless` 跑任务；
- 通过与否由任务的 `check` **命令**判定（退出码 0），不引入第二个 LLM 当裁判；
- Δ 用**配对**算（同一 task×seed 两臂都跑完才计入），并给出 only-A / only-B 胜场；
- 每次 run 的 `run.log` / `check.log` 全留档，判定可审计。

协议与语料挑选原则：[docs/G6-quality-ab.zh.md](G6-quality-ab.zh.md)。

## 2. 门槛：< 10 对配对一律「未测」

和 G1 的「行数 < 5 不出判定」同一条纪律。真机冒烟跑 1 任务 × 2 臂，
报告写的是 **未测（1 对配对 — 需要 ≥ 10）**，而不是 Δ=0.0pp 的假 PASS。

## 3. 两个实现细节，都是踩过的坑

- **凭据**：`dsh headless` 没有 web 的 Models 页，provider 路由从环境变量取 key。
  沙箱 `DSH_HOME` 里放 `~/.dsh/.credentials.yaml` 的符号链接/拷贝**都不够**；
  harness 直接把 `DEEPSEEK_API_KEY` 读进子进程环境（只进内存，不进报告）。
  两处都没有就立刻报错，不跑出一串 MISSING_CREDENTIAL。
- **profile 创建**：`dsh --profile <name> --from-default-profile headless --dump-config`
  才能把 one-shot 模板实例化成自定义 profile；直接 `dsh --profile <name>` 会因为没有该 profile 而失败。

## 4. 门表现状

`G1 未测（0/0 机会会话 · 共 5 行） · G2 PASS 78.8% · G4 PASS · G5 PASS 681c · G7 PASS 0.21% · G6 未测（装置就绪，缺一次真实配对实验）`
