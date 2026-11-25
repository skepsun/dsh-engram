# dsh-engram v0.9.7

热修复版本，解决活跃记忆恰好达到 `maxMemoriesPerWorkspace` 上限时「写入被拒、GC 又不驱逐」的容量边界死锁（[#18](https://github.com/skepsun/dsh-engram/issues/18)）。

## 修复

### 容量边界死锁（`lib/store.js`，#18）

- **根因**：此前 `storeMemory()` 在 `active >= maxMemoriesPerWorkspace` 时直接拒绝写入，而 `gc()` 仅在 `survivable > cap` 时驱逐并恰好落回 `cap`。当工作区活跃记忆达到 `cap` 且均为永久（`preference` / `procedure`）或未到期条目时，写入与 GC 互相卡死。
- **修复**：
  - 抽取共享的 `sweepWorkspaceMemories()`，保持与 `gc()` 完全一致的工作集保护（`kind === "task"`、`hits >= promoteHits`、活跃任务 `memoryRefs` / 实体锚点）与 retention-first 归档策略（先归档已过期条目，再按 `lastAccessAt / createdAt → hits → signal → createdAt` 归档，仅归档不硬删）。
  - `storeMemory()` 在写入触顶（`active >= cap` 且 `cap > 0`）时，自动先按 `cap - 1` 执行一次受保护清理腾出槽位，写入后活跃总数仍严格保持在 `cap` 以内；`gc()` 自身保持「最多保留 `cap` 条」语义不变。
  - 若所有槽位均被受保护工作集占满（或 `cap === 0`），才抛出 `ENGRAM_CAP_EXCEEDED` 并附带可操作提示（归档记忆、关闭活跃任务或调高 `maxMemoriesPerWorkspace`）。
- **回归测试**（`test/gc.test.mjs`）：补充 3 条用例覆盖「恰好 at cap 的永久记忆写入自动驱逐」「优先归档已过期条目」「全受保护工作集与 `cap === 0` 拒绝保护」。

## DSH 版本支持

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **最后验证日期**：2026-11-25
