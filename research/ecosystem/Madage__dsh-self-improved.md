# dsh-self-improved

**Long-term memory & self-evolving plugin** for DeepSeek Harness (fully local).

> Status: M0–M6 complete and deployed to a real environment (web profile). Design/research docs stay local only (see `.gitignore`).

## What it is

Adds the two missing capabilities to DSH — "cross-session memory + self-evolution":

- **Memory**: automatically distills key points from conversations (facts / preferences / events / instructions) into a local memory store; before each new turn, relevant memories are injected to the model — the AI "remembers you".
- **Self-evolution**: memories are consolidated, decayed and corrected; successful workflows can be distilled into reusable skills; the user persona keeps evolving with conversations.

The architecture follows the four-layer memory pyramid of TencentDB Agent Memory (L0 capture → L1 extraction → L2 scene grouping → L3 persona), but **reuses DSH-native services** (`ctx.llm` / `session` events / `agent/pre-step` injection / `dsh-skill` / `storageDomain`) with a fully local SQLite store (FTS5 + sqlite-vec). No data is uploaded anywhere.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M0 | Probe: event capture / recall injection / tool registration / settings namespace | ✅ Verified (isolated headless) |
| M1 | Memory store: SQLite + FTS5 + jieba + sqlite-vec; L0 capture to disk; memory/search tools | ✅ Verified (unit + headless integration) |
| M2 | Extraction pipeline: `ctx.llm` L1 extraction + strict JSON validation/fallback + dedup + throttled pump | ✅ Unit-tested; running in production |
| M3 | Recall injection: `agent/pre-step` injection + keyword/vector/hybrid retrieval (RRF) | ✅ Unit-tested + end-to-end verified |
| M4 | Self-evolution: L2/L3 consolidation (scenes + versioned persona), decay, correct/forget tools, skill synthesis → dsh-skill | ✅ Unit-tested; synthesized skills in production |
| M5 | UI/ops: settings panel (auto-rendered) + hot runtime toggles + `/memory` command + memory browser | ✅ Complete, deployed to web profile |
| M6 | Growth governance (caps/cleanup) + scheduling (nightly review / free maintenance / startup backfill) | ✅ Complete: governance caps, nightly review (default 22:00), 15-min loop is maintenance-only, master switch stops all timers |

## Installation

> **Since 0.1.1**: the package declares `dsh.bundle`, so **`dsh plugin add` / plugin-marketplace one-click install auto-mounts it** (dsh registers it as a profile layer automatically) — **no manual `cordis.patch.yml` edits needed**. Just restart dsh after installing.

### Option 1: npm (recommended; same as marketplace one-click)

```bash
dsh plugin --profile web add dsh-self-improved
# or find dsh-self-improved in the plugin marketplace and click install
# restart dsh — it auto-mounts
```

### Option 2: from GitHub (source snapshot, prepare builds lib/ automatically)

```bash
# 1) One-time environment prep (only if you hit store mismatch / blocked build):
#    - point the store back to the directory consistent with node_modules:
#      pnpm config set store-dir E:\dshPro\.pnpm-store --global   # or set store-dir=... in a profile-level .npmrc
#    - allow prepare builds for git-installed packages (pnpm >= 10 blocks by default); in pnpm-workspace.yaml:
#      allowBuilds:
#        dsh-self-improved: true

# 2) Install (dsh plugin forwards to pnpm in the profile; github:owner/repo fetches the snapshot and runs prepare=tsc)
dsh plugin --profile web add github:madage/dsh-self-improved

# 3) Restart dsh (auto-mounts since 0.1.1; if it still doesn't load, add the manual insert below)
```

> Manual mount (legacy versions or special layouts only): add to the `insert` list of `$DSH_HOME/profiles/web/cordis.patch.yml`:
> ```yaml
> - insert:
>     - id: dsh-self-improved
>       name: dsh-self-improved
> ```

### Option 3: local development (file: link)

```bash
# build, then copy lib/ + client.js + package.json into
# $DSH_HOME/profiles/web/node_modules/dsh-self-improved/
# add "dsh-self-improved": "file:node_modules/dsh-self-improved" to package.json dependencies
# add the cordis.patch.yml insert (above) → restart
```

### ⚠️ Install notice: peerDependencies double-instance pitfall (located & fixed)

**Symptom**: after install, **new sessions work but resuming an old session errors** — `deployment:persona already registered`, with a hint "register through that agent's agent.ctx instead".

**Root cause (not a plugin bug)**: pnpm's default `autoInstallPeers` installs the plugin's `@deepseek-ai/*` peerDependencies as **physical copies** inside the profile's `node_modules`, creating two independent module instances of the same package as the ones embedded in the dsh main install (e.g. `dsh-scope`). DSH's scoping (preset/persona layers) binds identity via `Symbol("dsh.scope")`; with two instances the persona registration lands in the global layer and collides with the host's `deployment:persona` → resume fails. New sessions happen to succeed because the global layer is not yet occupied on first registration.

**Fix (verified)**:
1. Replace the redundant `@deepseek-ai/*` physical copies in the profile with **symlinks** to the packages embedded in the dsh main install (dsh's self-healing layout `$DSH_HOME/profiles/node_modules`);
2. Set `auto-install-peers=false` in a profile-level `.npmrc` (or turn off `autoInstallPeers` in `pnpm-workspace.yaml`).

**Note for users (keep when publishing)**:
> dsh-self-improved's peerDependencies may be auto-installed as physical copies in the profile; use the dsh self-healing symlink layout, or set `auto-install-peers=false` in the profile's `.npmrc`.

### ⚠️ Install notice: duplicate loader entry id (bundle re-mount, instant boot crash)

**Symptom**: dsh **fails to start** (window flashes and closes), and `dsh --profile web --dump-config` shows the same entry `id` twice.

**Root cause**: packages declaring `dsh.bundle` (this plugin since 0.1.1, `dsh-plugin-marketplace`, etc.) are **automatically** added to `dsh.profile.bundles` and their bundled `cordis.patch.yml` inserts one entry; if the profile-level `cordis.patch.yml` **also manually inserts the same id** → the loader throws `duplicate loader entry id` at boot.

**Fix (verified)**: reset the profile-level `cordis.patch.yml` to `[]` — bundle assembly is fully owned by `dsh.profile.bundles`; do **not** manually insert bundle plugins at the profile layer.

**Debug tip**: if dsh crashes at startup, run `dsh --profile web --dump-config` and count each entry id; more than one occurrence is this problem.

## Configuration

```yaml
# $DSH_HOME/settings.yaml
dsh-self-improved:
  enabled: true
  modules:
    capture: true
    extract: true
    consolidate: true
    evolve: true
    recall: true
    tools: true
  review:
    enabled: true      # nightly review (one full evolution per day)
    time: "22:00"      # HH:MM, 24h
```

Notes:

- **Master switch off = plugin fully dormant**: all background timers stop (15-min maintenance loop / nightly review / startup backfill), `/memory` and memory tools are unregistered; stored memories are kept and everything resumes when re-enabled.
- **Scheduling**: the 15-minute loop only does extraction + free maintenance (decay/governance, no LLM cost); full evolution (scenes/persona/skills) runs at the nightly review (default 22:00), ~60s after startup, or via manual `/memory evolve`.
- **`/memory` commands are zero-LLM**: they query the local memory store directly; the command declares `input`, so parameterized input is handled by the command system (trigger via the command menu, `/`).
- The memory browser (Settings → "Self-evolving memory" → "Memory" tab) lets you view/filter/correct/forget memories, the persona, scenes and synthesized skills.

## Compliance

- The plugin's **architecture is inspired by** [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) (MIT); it is an **independent implementation** with no affiliation with Tencent.
- The plugin and all its dependencies are MIT-licensed and run fully locally.

## Acknowledgements

This project references the following open-source projects; many thanks to their authors and communities:

- **[TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)** (Tencent Cloud) — the four-layer memory pyramid (L0 capture → L1 extraction → L2 scene grouping → L3 persona) and memory-management ideas are the direct inspiration for this plugin's pipeline;
- **[self-improving-agent](https://github.com/pskoett/self-improving-agent)** (author **pskoett**) — a self-evolution skill in the OpenClaw ecosystem: distilling lessons, corrections and reusable flows from experience; this plugin's self-evolution module (memory consolidation / forgetting / correction + skill synthesis) takes design inspiration from it.

## Docs

- `README.md` — this file (English)
- `README.zh.md` — 中文版说明
- `docs/` (install/verify checklists, testing guide, design docs, DSH research) — **local only**, excluded via `.gitignore`

Unit tests: `node scripts/test-storage.mjs` / `test-extract.mjs` / `test-recall.mjs` / `test-evolve.mjs` / `test-commands.mjs` (all PASS).

## License

MIT License — see [LICENSE](./LICENSE) for the full text.

Summary:

- **Grant**: anyone may obtain a copy of the software and associated docs and use, copy, modify, merge, publish, distribute, sublicense and/or sell it;
- **Condition**: the above copyright notice and permission notice must be included in all copies or substantial portions;
- **Disclaimer**: the software is provided "AS IS" without warranty of any kind; in no event shall the authors or copyright holders be liable for any claim, damages or other liability.

Copyright (c) 2026 mashao. `package.json` declares `license: MIT`.
