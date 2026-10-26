# INVALID — 第二轮第一次矩阵（保留作证据链）

12 对配对，Δ=0.0pp。**这一轮的结论作废**，原因不是数字，是隔离：

控制组跑到同任务的实验组目录，读了 `ab-engram/<task>/seed-0/run.log`，
而那份日志里 agent 自己把团队约定复述了一遍（`ab-bare/errors/seed-0/run.log` 里有原话：
「It inspected `~/.dsh/storages/dsh_engram.json`… I can still infer from sibling logs」）。
harness 的污染检测在 12 条控制组里命中 1 条，但**结构上每条都可能读到**——
控制组和实验组交替跑，同任务的前一个日志总是就躺在隔壁。

修法（`--control-first` + `--log-dir` + 记忆库移出 `DSH_HOME`）之后重跑，
结果见 `eval/g6/runs/hidden-*/`。这份留着，因为它记录的是一次「数字漂亮但无效」
的真实教训：**控制组不是「没有工具」，是「没有信息」——而 agent 有 shell，
任何留在可读路径上的信息都算给了它。**
