<p align="right">
  <strong>English</strong> · <a href="./README_ZH.md">简体中文</a>
</p>

<p align="center">
  <strong>dsh-memory</strong> · Long-term memory plugin for DeepSeek Harness
</p>

<p align="center">
  A two-phase memory pipeline (per-session extraction → global consolidation), a summary that is always injected into new sessions, and four on-demand retrieval tools.
</p>

## Why long-term memory

Without memory, every session restates user preferences and re-steps known landmines.
`dsh-memory` extracts durable knowledge from finished sessions and periodically consolidates it
into a dense navigation summary (injected into every session) plus a grep-friendly handbook, so
future sessions **need fewer repeated instructions, waste fewer tool calls, and avoid known
failure modes**.

The design is adapted from the Codex memories system (two-phase extraction/consolidation,
three-layer artifact layout, job claims, cooldown, redaction) and re-composed for DSH: no
SQLite, no git baseline, no resident consolidation subagent.

## Features

- 🧠 **Phase 1 per-session extraction**: after a session turns stop (debounced, 3 min default),
  its log is read, filtered, rendered, and redacted, then a model extracts structured memory
  (`raw_memory` + `rollout_summary` + `slug`). Low-signal sessions produce an empty no-op.
- 🧩 **Phase 2 global consolidation**: on a cooldown (6 h default) the new raw memories are
  merged into `MEMORY.md` (handbook) and `memory_summary.md` (dense index, exact `v1` first
  line); raw input is rotated into an archive and never consolidated twice.
- 📥 **Always-injected summary**: `memory_summary.md` (hard size cap) is injected through the
  system prompt of every session — zero effort for the model to see the index.
- 🔍 **Four memory tools**: `memory_list` / `memory_read` / `memory_search` / `memory_add`
  (writes only on explicit user request).
- 🔒 **Safety discipline**: session content is treated as data, never instructions; secrets are
  redacted on both input and output; memory paths are confined to the memory root.
- 🔁 **Reliable scheduling**: one durable claim per session (KV-persisted); restarts never
  re-extract or double-consolidate; failures retry with backoff; orphaned claims recover.
- ⚙️ **Settings page**: Settings → Long-term memory for stats, manual runs, and config.
- 🗂️ **Memory manager**: the "Open memory bank" button opens a dedicated dialog with a
  VS Code-style collapsible file tree (folders nest their contents), in-dialog editing,
  and two-step deletion. A persistent warning reminds you: memory files generally need no
  manual edits unless you know what you are doing.
- 🎚️ **Per-phase reasoning effort**: Phase 1 extraction and Phase 2 consolidation each have
  their own reasoning level (off/low/high/max; empty follows the model default), so you can
  balance speed and memory quality per stage; run logs record the effort actually applied.

## How it works

```
turn end ──► Phase 1 (per session) ──► rollout_summaries/<slug>.md + raw_memories.md
                                            │
                              (cooldown elapsed / new memories)
                                            ▼
                                     Phase 2 (global)
                                            │
              ┌─────────────────────────────┴────────────────────────────┐
              ▼                                                          ▼
   memory_summary.md (injected into every session)     MEMORY.md (searched on demand)
```

## Installation

> [!NOTE]
> Requires [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
>
> Naming: `@nanmicoder/dsh-memory` is the package identifier (`@nanmicoder` is the npm-style
> scope, `dsh-memory` the name). This plugin is **distributed via GitHub** (not npm):

```sh
dsh plugin --profile web add 'git+https://github.com/yan5236/dsh-memory.git#main'
```

Then verify the composition and start:

```sh
dsh --profile web --dump-config
dsh web
```

Open **Settings → Long-term memory**. Memory files live in `$DSH_HOME/memories/` by default.

> [!TIP]
> If `dump-config` does not contain the `- id: dsh-memory` row, the package is missing from the
> profile's `dsh.profile.bundles` array (the bundle patch layer is not applied) — add
> `"@nanmicoder/dsh-memory"` to that array.

## 📋 One-prompt install: let DSH do it

Copy the whole block and paste it into a DSH conversation; the agent installs, registers, and
verifies the plugin for you:

````text
Please install the DSH long-term memory plugin `dsh-memory` into the `web` profile.
GitHub repo: https://github.com/yan5236/dsh-memory

Requirements:
1. Run: dsh plugin --profile web add 'git+https://github.com/yan5236/dsh-memory.git#main'
2. Check $DSH_HOME/profiles/web/package.json: dependencies should include
   "@nanmicoder/dsh-memory", and the dsh.profile.bundles array should contain
   "@nanmicoder/dsh-memory" (add it if missing — without it the plugin's patch layer
   is not applied).
3. Run: dsh --profile web --dump-config — confirm the output contains "- id: dsh-memory"
   with no errors.
4. Restart DSH: stop the running `dsh web` process, then run `dsh web` again.
5. Verify: the settings page shows "Long-term memory", and the session tool list contains
   memory_list / memory_read / memory_search / memory_add.
6. If any step that writes into the DSH profile directory ($DSH_HOME/profiles) is blocked
   by a permission policy, ask the user to switch to Full access or approve the operation —
   do not bypass it or fail silently.
````

## Configuration

The composition `config` provides the base layer (the bundled `config: {}` uses all defaults);
the settings page overrides common entries and persists them to DSH storage:

```yaml
- id: dsh-memory
  config:
    memoryRoot: C:/path/to/memories   # default $DSH_HOME/memories
    provider: deepseek-official       # optional: pin the pipeline model route
    model: deepseek-v4-flash          # paired with provider
    consolidationCooldownMs: 21600000 # consolidation cooldown (6 h default)
    idleDebounceMs: 180000            # post-turn idle window (3 min default)
    maxRolloutsPerRun: 3              # sessions extracted per run
    maxSummaryChars: 8000             # injected-summary character cap
```

See [README_ZH.md](./README_ZH.md) for the full option table.

## Memory layout

```text
<memoryRoot>/
├── memory_summary.md          # injected navigation summary (first line `v1`)
├── MEMORY.md                  # handbook: preferences, procedures, failure shields
├── raw_memories.md            # Phase 1 output awaiting consolidation
├── raw_memories.archive.md    # rotated history of consolidated raw blocks
├── rollout_summaries/         # per-session recaps (evidence layer)
├── skills/                    # reusable procedures promoted by consolidation
└── extensions/ad_hoc/notes/   # user-requested ad hoc notes
```

## Development

```sh
pnpm install
pnpm verify
git diff --check
```

Design and decisions: [DESIGN.md](./DESIGN.md).

## License

[MIT](./LICENSE)
