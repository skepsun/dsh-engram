# dsh-engram v0.8.2

**v0.8-C（能做的部分）：subagent 交接胶囊——留档做全了，替换做不了，理由写在代码里。**

## 提案想要的

> 子代理结束时，父代理只收一条 ≤500 tok 的胶囊：结论、证据、未决问题、建议下一步。

## 为什么这一版只做了一半

去读了宿主的结果路径：`dsh-tools` 的 `notifyResult()` 把 `tools/result` 用
`ctx.events.dispatch("emit", …)` 发出去，函数自己的注释写着 *"Notify observers
without exposing a mutation or error channel into the outcome"*——**监听者改不了父代理
读到的东西**。所以"父代理只收胶囊"需要一个宿主目前没有的接缝。

能做且做了的是另一半，而且它是真的：

- 子代理报告 ≥ `capsuleMinSourceChars`（1500）字时，用**纯结构规则**（标题、列表、
  问号、next/未决线索）抽成胶囊，存成 `handoff` 记忆；
- 子代理会话结束后结论不再随会话蒸发——压缩、跨会话、`engram_recall` 都能捞到；
- 胶囊自己在脚注里写清 `源 → 胶囊` 字符数，所以"如果替换能省多少"是**可测的**，
  不是拍脑袋的。

## 胶囊长什么样

```
**结论**：The recall benchmark reranks by recency and the fix is a stable tie-break.
**证据**：
- tests pass 184/184 after the change (npm test)
- touched lib/rerank.js and test/rerank.test.mjs
**未决**：
- open question: should BM25 weight decay with age?
**下一步**：
- next step: measure the CI wall-clock delta

---
胶囊：rerank review 1770 → 849 字符；全文在子代理会话日志里（可用 session 搜索回取）。
```

没有结构可提炼时它**不假装总结**：保留首尾 + 标明省略；而且有一条硬规则——
胶囊永远不会比原文更长（否则退化成保证更小的首尾截断）。

## 顺手加的

`npx dsh-engram status` 现在报当前 workspace 的 playbook 与胶囊计数：

```
playbook（当前 workspace）：13 条 procedure · 过门 0 · 未过门 13 · 失效 0
subagent 胶囊：N 条 · 源 → 胶囊 字符（只做留档，父代理仍收到全文）
```

## 证据

- `test/capsule.test.mjs` 7 条：结论/证据/未决/下一步抽取、无结构保留首尾、
  maxChars 上限、胶囊不长于原文、resultText 三种形状、长报告入库、短报告不入库；
- 全量 `npm test` **470/470**。

## C 的后半段要等什么

如果宿主将来暴露"结果变换"接缝（或在 `toolResultPruner` 上给出可插拔的渲染），
胶囊就能从留档升级成真正的替换；在那之前，任何"父代理上下文变小"的说法都是假的。
D（审批门）也还没动。
