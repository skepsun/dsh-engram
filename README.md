# dsh-engram

> **[English](README.md) · [中文](README.zh.md)**

Minimalist long-term memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), distilled from the
[symbolic-index](https://github.com/skepsun/symbolic-index) and [pi-esr](https://github.com/skepsun/pi-esr) ideas —
with one goal: **save tokens**.

- **Zero-LLM intake** — auto-captures meaningful events from tool results by pure
  pattern matching (git milestones with a written `-m` commit message, edits to
  key files, repeated errors), plus an explicit `engram_store`. Nothing on the hot
  path calls a model, and pure plumbing — `git push` / `git stash` / silent
  commits — is deliberately never recorded (see *Auto-capture policy* below).
- **Symbolic index + progressive disclosure** — a compact `[ENGRAM]` block (default
  budget 700 chars ≈ 175 tokens; one line per memory) is injected at prompt
  assembly and **frozen per session**, keeping the request prefix byte-stable for
  KV-cache reuse. The agent drills down with `engram_recall` / `engram_detail` instead
  of dumping raw hits into context.
- **ESR-lite closure protocol** — `esr_task` / `esr_close` / `esr_link` give tasks
  a `draft → active → stable` lifecycle where `stable` requires real evidence
  (`artifact` / `evaluation` / `memory_ref`), surfacing closure gaps instead of
  letting the agent declare victory without proof.
- **Memory GC (pi-esr constraints)** — a scheduled, mechanical, archive-only
  sweep: TTL-expired memories are archived, over-cap workspaces evict the
  lowest-value entries, stable tasks past their retention window leave the
  `[ESR]` surface, and dangling link edges are dropped. The working set (active
  task refs, task memories, indexed hits) is never touched, and nothing is
  hard-deleted — every archived entry keeps its id and stays re-fetchable.
- **Web viewer** — a memory browser with benchmark-ish stats and a config card,
  built entirely on DSH's native settings slots (no third-party UI package).

```
MIT   ·   node >= 22.19   ·   host-half + browser-half in one package
```

## Why another memory plugin?

Surveys of the existing DSH plugin ecosystem show the recall-bridge, approval-gate,
LLM-distillation and vector/graph niches are already crowded. dsh-engram fills the
three gaps that matter for token discipline:

1. **No model in the write path** — capture is deterministic pattern matching.
2. **No raw text in the prompt** — a bounded symbolic index is injected, retrieval
   stays on demand ("retrieved ≠ injected").
3. **Honest task closure** — STABLE cannot be declared without evidence.

DSH already provides cross-session FTS (`ctx.sessionQuery`), storage
(`ctx.storageDomain`), prompt-injection hooks and settings slots; dsh-engram is a
thin composition layer over them, not a re-implementation.

## Install

```sh
# from GitHub (this repo)
dsh plugin --profile web add github:skepsun/dsh-engram

# once published to npm
dsh plugin --profile web add dsh-engram

# local development (symlink — edits apply immediately)
dsh plugin --profile web add link:/path/to/dsh-engram
```

Then **restart `dsh web`**. Data persists in `~/.dsh/storages/dsh_engram.json`.

> The npm and GitHub installs below need **no manual dependency step**: pnpm
> installs `zod` and vendors the optional `@deepseek-ai/*` peers into the
> plugin's own `node_modules`, and the CLI auto-registers the plugin into the
> profile's `dsh.profile.bundles`. The `setup-links` step below is only for
> the `link:` development workflow, where pnpm deliberately does not install a
> symlinked directory's dependencies.

> A fresh session is required to see the injected `[ENGRAM]`/`[ESR]` blocks and the
> tools; both prompts and the tools registry are assembled per session.

### Dependencies for `link:` installs

A *symlinked* plugin resolves its imports from its own `node_modules`, so the
host-side dependencies must be present **next to the checkout** — they are not
tracked by git:

```sh
cd /path/to/dsh-engram
node scripts/setup-links.mjs     # one command: links the @deepseek-ai
                                 # workspace packages into node_modules AND
                                 # installs zod (reused from the harness
                                 # pnpm store, or via `npm install`)
```

The script auto-locates the harness checkout at `../deepseek-harness` (also
works when it sits next to the repo's *parent*, e.g. `E:\deepseek-harness` +
`E:\kototoro_demo\dsh-engram`); override with `DSH_HARNESS_DIR`. Without this
step, `dsh web` boot fails with `ERR_MODULE_NOT_FOUND: Cannot find package
'zod'` (and would fail on the `@deepseek-ai/*` peers next). `node
scripts/setup-links.mjs --check` prints the state without writing anything.

## What you get in the GUI

After restart, inside the **native** DSH settings surface:

- **Sidebar "ESR 看板" entry + full-screen kanban** — one more row under
  New Session with a **live active-task badge** (polled from /overview every
  30s across all workspaces). Clicking it opens a full-screen board in the
  center column: **草稿 / 进行中(gaps) / 就绪(evidence ready) / 已闭环** columns,
  workspace filter + search, an inline create form, and per-card
  "补齐证据 → 关闭" closure forms sharing the esr_close gates (artifact +
  evaluation + memory_refs). Following the task-board precedent, the entry and
  the board are DOM-mounted and self-heal (MutationObserver re-inserts on shell
  re-renders), with cross-panel exclusivity against task-board/ssh (opening one
  evicts the others; clicking a sidebar session/workspace row hands the center
  column back to the conversation). The conversation subtree stays mounted
  underneath and is hidden by `html[data-dsh-engram-board-active]`, so toggling loses
  no state.


- **Unified task strip above the composer** — the conversation dock that DSH
  ships for its built-in todo tool is taken over (same `conversation.input.dock`
  cell / `id: todo` at a lower priority) and **merged** into one modern control:
  the session's current plan (`todo_write`'s `todos` projection) plus the
  workspace's persistent **ESR tasks** (with evidence-gap badges and an inline
  "补齐证据 → close" form) plus the **relation graph** rendered as
  node → relation → node chips with entity/task names resolved. It only shows
  while there is something to show, stays live with 15s polling, and the built-in
  plan still renders (without the ESR parts) if the loopback-fenced API is
  unreachable. A **workspace-switcher chip** leads the strip: it defaults to
  following the current session (the tooltip says so), and its dropdown pins the
  ESR task/relation source to any workspace (✓ marks the active pin; the × or
  "follow session" entry reverts). Switching refetches immediately and is a pure
  UI focus change — the model's session context and the per-session frozen
  injection blocks are untouched.

- **Settings → Engram Memory** — a standalone first-class settings section
  (right after the Plugins section, not a child tab of it). Default
  "All workspaces" view shows every workspace's memories/tasks/links
  grouped by workspace (dropdown + prev/next workspace pager; the memory
  table additionally pages 10 rows per page with a jump dropdown, fixed
  column widths, 3-line clamped content ellipsis and full text on hover).
  Overview
  stat cards (counts by workspace/kind, auto-capture totals, per-workspace
  `[ENGRAM]` index token estimate, cumulative GC totals), a searchable /
  filterable memory table with archive + delete actions, an ESR task board
  with an inline "new task" form and a per-task "fill evidence to close"
  (artifact / evaluation / memory_ref → STABLE, same gates as esr_close),
  a node + relation list (nodes are domain objects the model registers via
  esr_node — package/service/repo/concept; relations via esr_link), a separate
  **relation-graph** tab (hand-rolled force-directed SVG, no chart library so
  the bundle stays pure: entities as circles, tasks as check badges, relations
  colored per type with direction arrows; drag nodes, pan, wheel-zoom, re-layout,
  hover highlights the neighborhood, clicking a node pops a floating panel with
  its incident relations and linked objects; dangling links are counted and
  warned about), an **injection-preview** tab that renders the exact
  `[ENGRAM]` index block (order 40) and `[ESR]` task/closure block (order 41)
  the model sees each session — same pure functions as the system-prompt
  sections — as two terminal-style panes with per-line coloring (block
  headers, task lines, drill hint, and the data-driven `escalate:` reminder
  highlighted), line/char/~token cost chips plus memory/task/link/node count
  chips, 20s auto-refresh and one-click copy of the raw block text (backed by
  the new `GET /api/dsh-engram/preview?workspace=…` route). Every ESR task
  card (board and ESR tab) carries an **evidence-progress ring** — a small
  three-arc SVG donut mapping artifact · evaluation · memory_ref, all green
  when closure-ready, amber while gapped, gray with no evidence yet; the
  board header adds an **aggregate ring** showing overall evidence
  completeness (%) plus how many in-progress tasks are closure-ready. Pure
  SVG, no chart library, bundle stays clean. A **telemetry dashboard** tab
  turns the /stats usage rollup (workspace × day) into a pure-SVG dashboard:
  three gauges for **ESR proactivity** (benchmarked against the 0.34 escalate
  threshold, amber + hint when low), **recall hit rate** and **detail
  follow-through**, five stat cards (total / esr / memory calls, avg hits per
  query, failures), a 14-day mem-vs-esr stacked bar chart and a Top-8 tool
  breakdown (mem blue / esr purple), 20s auto-refresh with an automatic
  small-sample (<10 calls) warning. A **details sidebar** (master–detail)
  opens on the right when you click any task / memory / node / relation
  row: task cards show state badge, evidence ring, full id + timeline,
  gap list, clickable memory references and an inline "fill evidence to
  close" form that refreshes the lists on success; memory cards show full
  text, tags, signal/hits/TTL and provenance metadata; node cards list all
  incident relations (typed, colored, with direction + confidence); clicking
  a task's memory reference jumps straight to that memory, with a hint when
  it is not in the loaded set. And a
  memory-GC panel (dry-run toggle + run button + pointer report). The GUI
  create/close use the host's new `POST /api/dsh-engram/tasks` and
  `POST /api/dsh-engram/tasks/close` routes. Model-side proactivity is driven
  by the [ENGRAM]/[ESR] injected blocks: multi-step work gets a task now,
  recurring domain objects get a node, related tasks/nodes get a link.

  **Real behaviour telemetry (agent observability)** — the ESR page opens
  with an "agent behaviour" panel fed by a new `usage` table (per workspace
  × day rollup) + `GET /api/dsh-engram/stats`: every `engram_*`/`esr_*` tool call
  is recorded (counts, failures, recall mechanics). Reported ratios:
  **ESR proactivity** = esr calls / (memory + esr calls); **recall hit rate**
  = recalls returning ≥1 hit / total recalls; **mean hits per query**;
  **detail conversion** = a engram_detail following a hit recall within 8
  session events. Per-tool counts + a 14-day daily rollup are shown too.
  Numbers are real, from real sessions — lift ESR proactivity by watching
  this panel and tuning the injected prompt.
- **Settings → Plugins → Plugin configuration → dsh-engram** — a collapsible
  config card in the same style as the built-in "Shell / Agent loop / Web
  search" cards: title + one-line description + chevron, collapsed by default,
  click to expand/collapse. Open, its ~12 options render under four groups —
  Capture & Search / Index / Lifecycle & GC / Security. Changes apply to new
  sessions (frozen blocks stay stable); Discard / Save with an "unsaved" badge
  on the header. The card drives the namespace through the connection's own
  settings RPCs (not the isLoopback-gated scope), so it stays editable even
  when the GUI is reached through an operator-authorized tunnel.

The browser half is served by DSH's client-module loader directly from this
package (`dsh.client` + `exports["./client"]`, no web-application rebuild); the
data comes from the loopback-fenced `/api/dsh-engram/*` route family. The fence
stays closed by default; to reach the memory viewer from an authorized tunnel
hostname, list it in the plugin's `trustedHosts` config (e.g. via the registry
or a profile patch):

```jsonc
// patch/engram.json
{ "engram": { "trustedHosts": ["cream-club-fragrances-caught.trycloudflare.com"] } }
```

If you change `client/src`, rebuild the bundle with:

```sh
npm run build:client
```

## Tools

| Tool | Purpose | Kind |
|---|---|---|
| `engram_store` | Explicitly store one memory (kind, tags, optional entity anchor) | write |
| `engram_recall` | Deterministic keyword recall over workspace memories; optional `search_sessions` FTS over past sessions | read |
| `engram_detail` | Full record of one memory id (provenance, tags, hits) | read |
| `esr_task` | Create a task entity (draft → active) | write |
| `esr_close` | Close a task via the evidence protocol (artifact + evaluation + memory_ref) | write |
| `esr_link` | Add a typed relation between two entities (mini graph) | write |
| `esr_gc` | Run the memory GC for the workspace (`dry_run:true` previews) | write |

## Memory GC

A scheduled sweep (`gcIntervalHours`, default 24h) plus a manual `esr_gc` /
GUI button keeps the store bounded the pi-esr way — **mechanical, working-set
protected, archive-only**:

- TTL-expired memories are archived (soft; the id stays, retrievable via the
  GUI's archived filter);
- over-cap workspaces evict the lowest-value *non-protected* memories;
- stable tasks past `gcStableRetentionDays` become archived and leave `[ESR]`;
- links whose **both** endpoints are gone are dropped (dangling edges).

GC never touches the working set: memories referenced by an active task
(`memory_refs`), task-kind memories, and already-indexed hits
(`hits >= promoteHits`). Run `esr_gc` with `dry_run: true` to preview. Nothing
is hard-deleted — the report ends with re-fetch pointers for everything it
archived, so archives are recoverable, not lost.

## Auto-capture policy

Capture is deterministic and offline — it only sees tool *results*, never the
conversation. Exactly what earns a memory record:

| Tool result | Action | Signal |
|---|---|---|
| `git commit … -m "subject"` | record — the written subject is the memory | 0.55 |
| `git merge` / `rebase` / `cherry-pick` / `tag` / `checkout -b` | record (milestone) | 0.5 |
| `git push` / `git stash` / commit without `-m` | **skip** — plumbing echo, not a decision | — |
| write/edit of a significant config & doc path | record | 0.3 |
| read of a config path | record | 0.3 |
| repeated tool error | record (deduped by message) | 0.25 |

Explicit `engram_store` writes are always recorded regardless of these rules
(rate-limited per session).

**Who earns a `[ENGRAM]` index line** (this is what actually touches the prompt):
`signal >= minIndexSignal` **or** `hits >= promoteHits` **or** `kind === "task"`,
then capped by `indexMaxLines` / `indexMaxChars`. One extra guard keeps the pipe
clean: auto-captured git command echoes — text that embeds a shell chain
(`git push: cd … && …`) — stay out of the index even when above the signal
threshold, until recall hits have promoted them. Everything else sits quietly in
storage, reachable on demand via `engram_recall` / `engram_detail` — "retrieved ≠
injected".

## Injected blocks

What the model actually sees (rendered once per session, then frozen):

```
[ENGRAM] workspace: symbolic-index · 2 memories · 1 task(s) active · 0 links
[D] 06-18 Decided: use sqlite-vec for retrieval #a2331d87
[T] 06-18 Retrieval upgrade — ACTIVE · gap: artifact, evaluation, memory_ref #tsk_8b26
drill: engram_store (user asks to remember) | engram_recall <query> | engram_detail <id> | esr_task / esr_close / esr_link

[ESR] tasks: 1 active / 1 stable
- tsk_0d: Retrieval upgrade — ACTIVE · gap: artifact, evaluation, memory_ref
- closed: tsk_9a (RAG eval)  ·  +1
```

Prefixes: `[D]` decision · `[E]` error · `[P]` procedure · `[F]` fact ·
`[I]` insight · `[H]` handoff · `[T]` task. Membership follows the
*Auto-capture policy* (signal threshold / recall promotion / git-echo guard),
bounded by the configured line and character budgets. `#` ids address the full
records via `engram_detail`. When a workspace has no tasks, `[ESR]` still renders
one line naming `esr_task`/`esr_close` so the mechanism stays visible to the
model instead of vanishing.

## Config

Defaults are token-conscious; override any key via the profile patch
(`~/.dsh/profiles/web/cordis.patch.yml`) or the web config card:

```yaml
- id: engram
  config:
    autoCapture: true        # zero-LLM tool-result capture
    sessionSearch: true      # engram_recall may also FTS past sessions
    autoCapturePerSession: 40
    indexMaxLines: 12        # [ENGRAM] line cap
    indexMaxChars: 700       # [ENGRAM] char cap (token budget)
    minIndexSignal: 0.4      # auto-captures below this stay out of the index
                             # (git command echoes are excluded regardless,
                             # until promoted by recall hits)
    promoteHits: 3           # ...until recalled this many times
    expireDays: 180          # memory TTL (0 = never)
    maxMemoriesPerWorkspace: 2000
    gcEnabled: true          # scheduled memory GC
    gcIntervalHours: 24      # sweep cadence
    gcStableRetentionDays: 120  # stable tasks leave [ESR] after this
    engramIndexOrder: 40    # systemPrompt section order (before tools band)
    esrOrder: 41
```

## Development

```sh
npm test            # 29 tests: core + web API + GC + usage-observability (node:test)
npm run eval        # offline recall + structure benchmark (deterministic)
npm run build:client
```

### Testing & evaluation (two layers of real testing)

**npm run eval** (eval/recall-bench.mjs) is the deterministic layer —
LongMemEval-style: a controlled corpus (ASCII + CJK, known tags/entities/
timestamps) measured through the real store/recall path (openEngramDomain +
domain.recall), reporting Precision@k / Recall@k / MRR / Hit@1 per probe
(exact tag, substring, multi-term, CJK, phrase-single, ordering, negative)
plus StructMemEval-flavoured structure metrics (exact-duplicate dedup rate,
entity anchoring coverage, dangling-link hygiene). Honest, reproducible
numbers — everyone gets the same output. Current run: AVG P@k 0.770 /
AVG R@k 1.000 / MRR 0.889 / hit@1 0.889 / 0 negative false-positives /
dedup 1.0.

**/api/dsh-engram/stats + the observability panel** is the real-session layer —
it answers how the model actually uses the memory in production (ESR
proactivity ratio, recall hit rate, detail conversion), while the eval
answers how good the retrieval layer itself is.

Repo layout: `lib/` (host half: store / capture / index-block / tools / api /
settings), `client/` (browser half, TSX + `build.mjs`), `test/` (node:test).

## Troubleshooting

**The web GUI opens and immediately shows “Failed to load plugins”**, with a
loader error like:

```
failed to apply loader entry … (@linxin666/dsh-client-ui-web-ui-settings):
keyed slot "settings.plugin.item" requires options.key
```

Cause: DSH hosts since `0.1.0-rc.7` declare the config-card slot
`settings.plugin.item` as **keyed by the settings namespace a card edits** —
which is exactly how dsh-engram's own config card registers (under
`key: "dsh-engram"`). The `@linxin666/dsh-web-ui-all` family **before 0.2.0**
(`dsh-client-ui-web-ui-settings`) registered its group card into that slot
**without a `key`**, and because a single failed loader entry aborts the whole
boot, the GUI stays stuck on the failure page.

Fixes:

- **Proper fix — upgrade the family**: `@linxin666/dsh-web-ui-all@^0.2.x`.
  The 0.2 line moved its settings surface out of the keyed slot into a
  first-level `settings.section` (the upstream fix for exactly this error).
- **Immediate unblock**: add `key: "web-ui-plugins"` to that one
  `settings.plugin.item` registration in the installed
  `node_modules/@linxin666/dsh-client-ui-web-ui-settings/lib/client.js`, then
  restart `dsh web`. (Under namespace-keyed dispatch the group card simply
  stays hidden; nothing else on the page is affected.)

## Related

- [symbolic-index](https://github.com/skepsun/symbolic-index) — the original cross-session
  memory plugin (5-signal RRF fusion, sqlite-vec, Dream Engine).
- [pi-esr](https://github.com/skepsun/pi-esr) — project-lifetime evidence-driven
  task states; the closure protocol here is its lite form.

## License

MIT
