# dsh-engram v0.8.1

**v0.8-B：验证过的 procedure 可以导出成真正的 DSH Skill。**

## 为什么

v0.8.0 让 procedure 有了证据。但一条 `[ENGRAM]` 行只是提示：会话压缩后它就不在了，
subagent 也看不到它。DSH Skill 是另一层表面——宿主从 `.dsh/skills` 发现它、在会话
catalog 里挂上名字、任何 agent 都能按需加载**全文**。被验证 3 次的东西，应该是一个
真实产物，而不是一行会被压掉的回忆。

## 怎么用

```bash
npx dsh-engram skill export            # → <workspace>/.dsh/skills/<name>/SKILL.md
npx dsh-engram skill export --dry-run  # 只看计划，不落盘
```

导出的是 `engram-fix-<command>`，正文包含：验证次数、首次捕获与最近验证时间、
它闭合的那次失败签名（同命令最新的 resolved error，最多 3 行）、以及"这条是证据不是
保证——先跑一遍"的使用说明。

## 三条安全规则

1. **只导出过门的**：≥3 次验证、14 天内验证、未失效。手写的 procedure（只有 hits）
   不会被导出——召回次数不是验证次数。
2. **只碰自己的文件**：每个 SKILL.md 带 `generated-by: dsh-engram skill-export` 标记；
   没有标记的同名文件一律跳过（人写的技能永远不被覆盖）。
3. **失效即消失**：procedure 不再成立（失效/过期/归档）后，下一次 export 会把它的
   SKILL.md 删掉——catalog 不能继续推荐一条刚坏掉的修法。

## 宿主契约是核实过的，不是猜的

读的是 `@deepseek-ai/dsh-skill-filesystem` 源码：

- 根目录优先级：`<project>/.dsh/skills` (100) → `<project>/.agents/skills` → custom →
  `$DSH_HOME/skills` → `$AGENTS_HOME/skills` → bundled；
- 一个技能 = 含 `SKILL.md` 的目录（或平铺 `*.md`）；
- frontmatter 必须有 `name` + `description`，`name` 匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`；
  `whenToUse`、`disable-model-invocation`、`user-invocable` 可选；
- 根目录有 watcher，新文件不需要重启 dsh。

## 证据

`npm run skill:check` 不走我们自己写的解析器——它 **import 宿主自己的 provider**
（`FileSystemSkillProvider.list()` / `.get()`），在临时工程里验证 11 条：

```
✓ promoted procedure is advertised by the host
✓ unproven row is not exported
✓ invalidated row is not exported
✓ hand-written skill survives
✓ stale generated skill was swept
✓ second export is a no-op
✓ host parses description
✓ host parses whenToUse
✓ host loads the full body
✓ name matches the host grammar
✓ model-invocable + user-invocable by default
```

单测：`test/skill-export.test.mjs` 8 条（命名文法、门规则、失败签名取最新 resolved、
幂等、人类文件不被覆盖、失效即删、dry-run 不落盘）。全量 `npm test` 463/463。

## 还没做的

- v0.8-C（subagent 交接胶囊）、v0.8-D（审批门）还没动；
- 导出目前是 CLI 触发的，插件内部还没有"晋升时自动导出"的钩子；
- 真实账本里这个 workspace 还没有过门的 auto procedure，所以本机暂时导不出东西——
  机制已用合成数据验证，等真实 procedure 自然晋升后即可用。
