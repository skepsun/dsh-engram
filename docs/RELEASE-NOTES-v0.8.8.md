# dsh-engram v0.8.8

**0.8.7 的推送腿遥测写错了一层目录——装上真机、重启、看一眼状态，5 分钟内就露馅了。**

## 修复：`push-legs.jsonl` 写到了 `engram/engram/`

0.8.7 引入的推送腿遥测，`engramHome()` 已经以 `engram/` 结尾，写入端又拼了一次
`engram`，于是文件落在 `~/.dsh/engram/engram/push-legs.jsonl`；而 `dsh-engram status`
读的是 `~/.dsh/engram/push-legs.jsonl`。

结果是**一个工作正常的遥测，在状态里显示成「还没记录」**——正好是这一版想消灭的那种
「看起来像没发生」。单测没抓到，因为测试自己造目录、两边用的是同一个临时路径。

现在把契约写死在一处：`pushLegsPath(engramDir)` 的参数就是 engram 目录本身，
写入端传 `engramHome()`、读取端传 `<dsh home>/engram`，注释里写明为什么不能拼第二次。
新增一条回归测试直接断言 `pushLegsPath(dir) === join(dir, "push-legs.jsonl")`。

## 顺带得到的一个真数据点

修好路径、把线上那条记录归位之后，本机（`dsh 0.2.1-rc.2` CLI + web）的答案是：

```
推送腿：事件日志读法 snapshotEvents · 最近 2026/10/27 15:44:35 · snapshotEvents×1
```

也就是说**我们自己的宿主走的是 `snapshotEvents`**——`ctx.sessionQuery` 在这套组合里
没挂上（宿主已把它标为 deprecated，但仍在）。这解释了为什么 0.8.6 补的
`seq`+`eventAt` 第四手值得留着：桌面运行时那类宿主一旦连 `snapshotEvents` 也去掉，
`eventAt` 就是最后的退路。

## 证据

- `npm test` **489/489**（+1 路径契约回归）
- `npm run typecheck` 通过；`prepublishOnly` 真实 tarball + peers 后 host/client 双入口导入通过
- 真机验证：`dsh-engram status` 打印出上面那行读法；`~/.dsh/engram/engram/` 这个错误
  目录已清理，记录已归位到 `~/.dsh/engram/push-legs.jsonl`

## DSH 版本支持（必填）

- **支持的 DSH 范围**：`>=0.1.2-alpha.2 <0.3.0-0`
- **验证版本**：`dsh 0.2.1-rc.2`（本机 CLI + web）
- **最后验证日期**：2026-10-27
- **安装方式已验证**：`prepublishOnly` 用真实 tarball 装 peers 后导入 host/client 双入口
- **peer 声明**：`@deepseek-ai/dsh-{settings,storage-domain,compaction,compaction-basic,llm}@>=0.1.2-alpha.2 <0.3.0-0`、`@deepseek-ai/cordis@^4.0.2`、`@deepseek-ai/schemastery@^3.18.2`
