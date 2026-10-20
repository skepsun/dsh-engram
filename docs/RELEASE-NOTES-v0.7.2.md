## dsh-engram v0.7.2

自 v0.7.1 以来：**修复 L1 边界剪枝的启动时序竞态**——此前在部分 profile 上 L1 整个进程
生命周期都不武装，账本的「剪枝节省」入账腿静默断掉，而状态快照把它报成"行不存在"。

### 根因（真机定位）

`BoundaryPrune` 在插件安装时用**严格** `ctx.get("toolResultPruner")` 取宿主剪枝器，拿不到
就 `log.warn` 后放弃。但 DSH `0.2.0` web profile 里 `tool-result-pruner` 行虽然由 bundle patch
重新启用，它的 fiber 却比插件**晚激活约 100 ms**：

```
t0        strict=undefined  loose=object   ← 服务已注册，fiber 未激活
inject    100 ms 后 strict=object          ← 服务激活
```

严格查找在 `t0` 为空 → `installBoundaryPrune` 直接返回 noop → **L1 永久休眠**（本次问题
只在组合里多挂 bundle 时出现：最小 profile 里剪枝器恰好先激活，所以此前的真机验证是绿的）。

### 修复

- **改经 `ctx.inject(["toolResultPruner"], callback)` 武装**：cordis 在服务真正激活那一刻
  回调（插件重载后也会重新武装），武装顺序不再由 bundle 组合顺序决定；武装成功后立刻
  重写持久化状态快照（首刷可能早于剪枝器激活）。
- **区分「缺失」与「晚到」**：`boundaryPruneAvailability` 增加非严格查找——
  - 行被禁用/没装：`no toolResultPruner service in the host plane (the bundle patch must re-enable the tool-result-pruner row)`
  - 只是 fiber 未激活：`toolResultPruner is registered but its fiber is not active yet (L1 arms when it activates)`
- **CLI 同步**：`npx dsh-engram status` 的 L1 行直接复用该 reason，未武装时打印「节省不会入账」告警。

### 验证

- 把真实 web profile（`dsh-context` + `dshmarket` + `dsh-engram`）克隆到隔离 `DSH_HOME`
  复现 `armed:false`；换成修复后的代码，同一组合 `armed:true · threshold 8192`。
  `dshmarket` 组合对照组一直 `armed:true`（说明差异来自激活顺序，不是组合内容）。
- 单测新增「registered-but-inactive 报 pending 而非 missing」一例；`npm test` 406/406，
  `npm run typecheck` 干净。

### 升级步骤

```bash
npm publish                      # 或先 npm pack 检查产物
dsh plugin --profile web add dsh-engram@0.7.2
# 重启 dsh web 后确认：
npx dsh-engram status | head -6  # 期望「L1 边界剪枝：已武装（threshold 8192）」
```

> 升级不会回填历史账本：`avoidedChars` 从 0 开始累计，第一次边界剪枝/checkpoint 之后
> 「节省 · 剪枝/压缩」才会出现正数。
