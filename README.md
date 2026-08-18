# dsh-loom

> **[English](README.md) · [中文](README.zh.md)**

Minimalist long-term memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), distilled from the
[pi-loom](https://github.com/skepsun/pi-loom) and [pi-esr](https://github.com/skepsun/pi-esr) ideas —
with one goal: **save tokens**.

- **Zero-LLM intake** — auto-captures meaningful events from tool results by pure
  pattern matching (git operations, edits to key files, repeated errors), plus an
  explicit `loom_store`. Nothing on the hot path calls a model.
- **Symbolic index + progressive disclosure** — a compact `[LOOM]` block (default
  budget 700 chars ≈ 175 tokens; one line per memory) is injected at prompt
  assembly and **frozen per session**, keeping the request prefix byte-stable for
  KV-cache reuse. The agent drills down with `loom_recall` / `loom_detail` instead
  of dumping raw hits into context.
- **ESR-lite closure protocol** — `esr_task` / `esr_close` / `esr_link` give tasks
  a `draft → active → stable` lifecycle where `stable` requires real evidence
  (`artifact` / `evaluation` / `memory_ref`), surfacing closure gaps instead of
  letting the agent declare victory without proof.
- **Web viewer** — a memory browser with benchmark-ish stats and a config card,
  built entirely on DSH's native settings slots (no third-party UI package).

```
MIT   ·   node >= 22.19   ·   host-half + browser-half in one package
```

## Why another memory plugin?

Surveys of the existing DSH plugin ecosystem show the recall-bridge, approval-gate,
LLM-distillation and vector/graph niches are already crowded. dsh-loom fills the
three gaps that matter for token discipline:

1. **No model in the write path** — capture is deterministic pattern matching.
2. **No raw text in the prompt** — a bounded symbolic index is injected, retrieval
   stays on demand ("retrieved ≠ injected").
3. **Honest task closure** — STABLE cannot be declared without evidence.

DSH already provides cross-session FTS (`ctx.sessionQuery`), storage
(`ctx.storageDomain`), prompt-injection hooks and settings slots; dsh-loom is a
thin composition layer over them, not a re-implementation.

## Install

```sh
# from GitHub (this repo)
dsh plugin --profile web add github:skepsun/dsh-loom

# once published to npm
dsh plugin --profile web add dsh-loom

# local development (symlink — edits apply immediately)
dsh plugin --profile web add link:/path/to/dsh-loom
```

Then **restart `dsh web`**. Data persists in `~/.dsh/storages/dsh_loom.json`.

> A fresh session is required to see the injected `[LOOM]`/`[ESR]` blocks and the
> six tools; both prompts and the tools registry are assembled per session.

## What you get in the GUI

After restart, inside the **native** DSH settings surface:

- **Settings → Loom Memory** — overview stat cards (counts by workspace/kind,
  auto-capture totals, per-workspace `[LOOM]` index token estimate), a searchable /
  filterable memory table with archive + delete actions, the ESR task board with
  evidence gaps, and the relation list.
- **Settings → Plugins → dsh-loom** — a config card bound to the `dsh-loom`
  settings namespace. Changes apply to new sessions (frozen blocks stay stable).

The browser half is served by DSH's client-module loader directly from this
package (`dsh.client` + `exports["./client"]`, no web-application rebuild); the
data comes from the loopback-fenced `/api/dsh-loom/*` route family. If you change
`client/src`, rebuild the bundle with:

```sh
npm run build:client
```

## Tools

| Tool | Purpose | Kind |
|---|---|---|
| `loom_store` | Explicitly store one memory (kind, tags, optional entity anchor) | write |
| `loom_recall` | Deterministic keyword recall over workspace memories; optional `search_sessions` FTS over past sessions | read |
| `loom_detail` | Full record of one memory id (provenance, tags, hits) | read |
| `esr_task` | Create a task entity (draft → active) | write |
| `esr_close` | Close a task via the evidence protocol (artifact + evaluation + memory_ref) | write |
| `esr_link` | Add a typed relation between two entities (mini graph) | write |

## Injected blocks

What the model actually sees (rendered once per session, then frozen):

```
[LOOM] workspace: pi-loom · 2 memories · 1 task(s) active · 0 links
[D] 06-18 Decided: use sqlite-vec for retrieval #a2331d87
[T] 06-18 Retrieval upgrade — ACTIVE · gap: artifact, evaluation, memory_ref #tsk_8b26
drill: loom_recall <query> | loom_detail <id> | esr_task / esr_close / esr_link

[ESR] tasks: 1 active / 1 stable
- tsk_0d: Retrieval upgrade — ACTIVE · gap: artifact, evaluation, memory_ref
- closed: tsk_9a (RAG eval)  ·  +1
```

Prefixes: `[D]` decision · `[E]` error · `[P]` procedure · `[F]` fact ·
`[I]` insight · `[H]` handoff · `[T]` task. `#` ids address the full records
via `loom_detail`.

## Config

Defaults are token-conscious; override any key via the profile patch
(`~/.dsh/profiles/web/cordis.patch.yml`) or the web config card:

```yaml
- id: loom
  config:
    autoCapture: true        # zero-LLM tool-result capture
    sessionSearch: true      # loom_recall may also FTS past sessions
    autoCapturePerSession: 40
    indexMaxLines: 12        # [LOOM] line cap
    indexMaxChars: 700       # [LOOM] char cap (token budget)
    minIndexSignal: 0.4      # auto-captures below this stay out of the index
    promoteHits: 3           # ...until recalled this many times
    expireDays: 180          # memory TTL (0 = never)
    maxMemoriesPerWorkspace: 2000
    loomIndexOrder: 40       # systemPrompt section order (before tools band)
    esrOrder: 41
```

## Development

```sh
npm test            # 15 tests: core + web API (node:test)
npm run build:client
```

Repo layout: `lib/` (host half: store / capture / index-block / tools / api /
settings), `client/` (browser half, TSX + `build.mjs`), `test/` (node:test).

## Related

- [pi-loom](https://github.com/skepsun/pi-loom) — the original cross-session
  memory plugin (5-signal RRF fusion, sqlite-vec, Dream Engine).
- [pi-esr](https://github.com/skepsun/pi-esr) — project-lifetime evidence-driven
  task states; the closure protocol here is its lite form.

## License

MIT
