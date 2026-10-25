# dsh-engram v0.7.9

**L1 转职：从「自己剪」变成「记账 + 归因」。**

## 1. 真机发现（2026-10-25）

v0.7.8 修好重入之后，边界第一次真的 `fired`，但 `pruned: 0`——即使 surface 里躺着一个
10 KB 的工具结果。查会话事件流，答案在事件顺序里：

```
4976 tool/result 10146 chars
4977 step/end
4978 compaction/prune   ← 宿主自己剪的，没有任何边界参与
4979 tool/result 5466 chars
4980 compaction/prune
4986 todo/write        ← 我们在这里 fire，已经没有可剪的了
```

DSH 0.2.x 会在步与步之间、请求装配之前**自己剪掉超阈值结果**。等我们的边界到达时，
候选早就被剪过一遍了。真机上它一天剪掉 12,491 token，而账本一分没记——因为入账只挂在我们
自己的剪枝钩子上。

结论：在 0.2.x 上「再剪一遍」是白干。**能挣钱的那部分不是剪，是记账。**

## 2. 这次做了什么

- **两条腿分开记账**（`lib/ledger.js`）：
  - `prunedChars` —— engram 造成的剪枝（续接 `avoidedChars`/NetTokens）；
  - `hostPrunedChars` —— 宿主自己剪的，**可见但不认领**；
  - 两者都付 `rewriteCount/rewriteChars`（前缀失效是真实成本）。
- **观察者**（`lib/index.js`）：监听 `compaction/prune`，按 `shadowedTokenCount×4` 计入
  host 腿；我们自己 fire 过的 seq 会被标记，命中即跳过（不双记）。
- `summary()` 与 `readLedger()` 都暴露 `hostPrunedChars`。
- 测试：账本级（两条腿互不污染、只有 engram 腿进 avoidedChars）+ 插件级（宿主 prune
  事件落到 host 腿）。441/441 通过。

## 3. 为什么这不是「把宿主的功劳算到自己头上」

G1 问的是「engram 的上下文投资是否正收益」。宿主剪枝在**没有 engram 时也会发生**，
把它算进 NetTokens 等于自欺。所以：host 腿只做**可见性**（用来判断 L1 还值不值得留），
不参与净收益判定。

## 已知边界

- host 腿用 `shadowedTokenCount × 4` 估算字符，与压缩入账同一口径。
- 账本里 host 腿要等 0.7.9 上线后的新 prune 事件才会开始长数；历史不给补。
