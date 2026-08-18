# dsh-loom

Minimalist long-term memory for DeepSeek Harness, distilled from the
[pi-loom](https://github.com/skepsun/pi-loom) and
[pi-esr](https://github.com/skepsun/pi-esr) ideas:

- **Zero-LLM intake** — auto-captures meaningful events from tool results by
  pure pattern matching (git operations, file edits to key paths, repeated
  errors) plus an explicit `loom_store`; nothing here calls a model.
- **Symbolic index + progressive disclosure** — a compact ~300–500 token
  `[LOOM]` block (one line per memory, prefix-stable per session for KV cache
  reuse) is injected at prompt assembly; the agent drills down with
  `loom_recall` / `loom_detail` instead of dumping raw hits into context.
- **ESR-lite closure protocol** — `esr_task` / `esr_close` / `esr_link` give
  tasks a `draft → active → stable` lifecycle where `stable` requires real
  evidence (`artifact` / `evaluation` / `memory_ref`), exposing closure gaps
  instead of letting the agent declare victory without proof.

## Principles

- `检索到 ≠ 注入`: only a bounded symbolic index is injected; recall is on demand.
- Deterministic everywhere: no semantic retrieval, no embeddings, no model calls
  on the hot path — every byte is reproducible.
- Storage rides DSH's own `ctx.storageDomain` (JSON unit `~/.dsh/storages/dsh_loom.json`),
  no external server, no self-built SQLite.
- Cross-session full-text fallback reuses `ctx.sessionQuery` (FTS5 over the
  lossless session log) when it is mounted.
- Restrained: TTL expiry + access-count promotion, capped per workspace.

## Install

```sh
# from a checkout (development: symlink — live edits applied immediately)
dsh plugin --profile web add link:/d1/chuxiong/code/dsh-loom
# from a tarball or once published
dsh plugin --profile web add dsh-loom
```

Restart `dsh web`. Data persists in `~/.dsh/storages/dsh_loom.json`.

## Web viewer (native settings surface)

The plugin ships a browser half that plugs into DSH's **own** settings slots
(no third-party UI package is touched):

- **Settings → Loom 记忆** (`settings.section`) — a full page with overview
  stat cards (counts by workspace/kind, auto-capture totals, per-workspace
  `[LOOM]` index token estimate), memory search/filter table with archive and
  delete actions, the ESR task board with evidence gaps, and the relation list.
- **Settings → Plugins → dsh-loom** (`settings.plugin.item`) — a config card
  bound to the `dsh-loom` settings namespace; changes land live for new
  sessions (frozen `[LOOM]` blocks stay stable by design).

Both are served by the client-module loader straight from this package
(`dsh.client` + `exports["./client"]`); the host API behind them is the
loopback-fenced `/api/dsh-loom/*` route family. Rebuild the browser bundle
after touching `client/src`:

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

The injected `[LOOM]` block print the current counts and the disclosure hint;
`[ESR]` lists active tasks and their closure gaps.

## Injected blocks

```
[LOOM] workspace: pi-loom · 14 memories · 1 task active · 3 links
[D] 06-15 | Arch: use sqlite-vec for search | #ab12cd34
[E] 06-14 | CI: type error in handlers.ts → fixed | #d4e5f6a7
[T] tsk_7f3e | Retrieval upgrade — ACTIVE · gap: evaluation
drill: loom_recall <query> | loom_detail <id> | esr_task/esr_close | esr_link

[ESR] tasks: 1 active / 5 stable
- tsk_7f3e Retrieval upgrade — ACTIVE · needs: evaluation
- tsk_9a2b RAG eval — STABLE (artifact ✓ evaluation ✓ memory_ref ✓)
```

Prefixes: `[D]` decision · `[E]` error · `[P]` procedure · `[F]` fact ·
`[I]` insight · `[H]` handoff · `[T]` task.

## Config

All keys override via the profile patch
(`~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- id: loom
  config:
    autoCapture: true        # zero-LLM tool-result capture
    sessionSearch: true      # loom_recall may also FTS past sessions
    indexMaxLines: 12        # [LOOM] line cap
    indexMaxChars: 700       # [LOOM] char cap
    minIndexSignal: 0.4      # auto-captured below this stay out of the index
    promoteHits: 3           # ...until recalled this many times
    expireDays: 180          # TTL for memories (0 = no expiry)
    maxMemoriesPerWorkspace: 2000
    loomIndexOrder: 40       # systemPrompt section order (before tools band)
    esrOrder: 41
```

## License

MIT
