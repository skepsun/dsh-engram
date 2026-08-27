# PowerContext for DeepSeek Harness

**English** | [中文](README.zh.md)

DeepSeek Harness plugin that connects to a running [PowerContext](https://github.com/oceanbase/powercontext) Server over HTTP for recall, memory, handoff, experience, and skills. It does not embed storage, start the Server, or import the Python package.

The same plugin is also integrated into official PowerContext at [`integrations/dsh/plugins/powercontext`](https://github.com/oceanbase/powercontext/tree/master/integrations/dsh/plugins/powercontext). This standalone repository and the in-tree plugin stay in sync: fixes and improvements land in both places.

```bash
dsh plugin --profile web add <path-or-tarball>
```

## Features

The plugin calls the Server’s `/v1/...` OpenAPI surface over HTTP. It does not use MCP.

Before each model step it automatically:

1. **Recalls** bounded context with `POST /v1/context/prepare` and injects it as untrusted historical evidence.
2. **Captures** the current user input as a Content Source with `POST /v1/sources/content`.

Named `pc_*` tools expose the agent-safe Memory, handoff, experience, skill, and read-only review operations. DSH requests one-time user approval before named mutations run. Review mutations remain explicit human `/pc review` commands; destructive and administrative OpenAPI operations are not model tools. Skill `project-context` documents the same workflow for the model. If the Server is unreachable, recall is skipped and the turn continues.

| Area | Tools | HTTP |
|---|---|---|
| Memory | `pc_search` `pc_remember` `pc_memory_list` `pc_memory_get` `pc_memory_revise` `pc_memory_retire` | `/v1/memory/*` |
| Context | `pc_prepare_context` `pc_capture_source` | `/v1/context/prepare`, `/v1/sources/content` |
| Handoff | `pc_handoff_activate` `pc_handoff_prepare` `pc_handoff_finalize` `pc_handoff_commit` `pc_handoff_continue` | `/v1/handoff/*` |
| Experience / Skill | `pc_experience_generate` `pc_experience_get` `pc_skill_generate` `pc_skill_get` | `/v1/experience/*`, `/v1/skill/*` |
| Review | `pc_review_list` `pc_review_get` | `/v1/artifact-candidates/*` |

See [`openapi/powercontext.yaml`](openapi/powercontext.yaml) for the full contract.

## Quick start

PowerContext Server and DeepSeek Harness are two processes. Both are required. Use the same Git ref for the Server and the plugin.

### Install the Server

```bash
uv tool install "powercontext[cli,server] @ git+https://github.com/oceanbase/powercontext.git@master"
powercontext --version
```

From a PowerContext checkout you can use `uv run powercontext server run` instead.

### Install the plugin

Install DeepSeek Harness first and make sure the web profile exists (run `dsh web` once). From a PowerContext checkout the plugin lives at `integrations/dsh/plugins/powercontext`. Prefer the CLI so the ref stays aligned:

```bash
powercontext setup dsh --source oceanbase/powercontext --ref master
```

A local checkout works the same way:

```bash
powercontext setup dsh --source /path/to/powercontext
```

`setup dsh` calls `dsh plugin --profile web add` on that plugin directory. If the CLI is not available yet, add the directory yourself:

```bash
dsh plugin --profile web add /path/to/powercontext/integrations/dsh/plugins/powercontext
```

This standalone repository remains a release channel. A GitHub Release tarball still works:

```bash
dsh plugin --profile web add ./powercontext-dsh-0.0.5.tgz
```

If the plugin is already installed from a source checkout, remove it first. On Windows, replacing a `link:` install with a tarball fails because pnpm tries to recreate nested `node_modules` symlinks.

Rebuild after TypeScript changes: `pnpm install`, `pnpm test`, `pnpm build`, then restart `dsh web`.

Optional check:

```bash
powercontext doctor
powercontext doctor dsh
dsh --profile web --dump-config
```

`doctor` checks the Server. `doctor dsh` checks that the `dsh` CLI is on PATH and the plugin id is `powercontext-dsh`.

Remove the plugin:

```bash
dsh plugin --profile web remove powercontext-dsh
```

### Start the Server

```bash
powercontext server run
```

Defaults: `http://127.0.0.1:8000`, no authentication, SQLite under the user data directory (`POWERCONTEXT_HOME` overrides it).

```bash
curl http://127.0.0.1:8000/health/live
curl http://127.0.0.1:8000/health/ready
```

`live` must succeed. `ready` may be `degraded` when inference is not configured. Explicit Memory writes do not need a model.

### Use it

Keep the Server running, then:

```bash
dsh web
```

Open a project and chat as you normally would. The plugin recalls context and stores user input in the background. When the model needs to read or write memory, hand off work, or generate experience / skills, it calls the corresponding `pc_*` tools.

You can type `/pc doctor` in the chat to check that the Server is reachable.

## Configuration

Environment variables override patch config. Do not put secrets in files that `--dump-config` can print.

| Field | Environment variable | Default | Meaning |
|---|---|---|---|
| `baseUrl` | `POWERCONTEXT_DSH_BASE_URL` | `http://127.0.0.1:8000` | Server root URL, no trailing slash |
| `authorization` | `POWERCONTEXT_DSH_AUTHORIZATION` | empty | Full `Bearer <token>` |
| `scopeId` | `POWERCONTEXT_DSH_SCOPE_ID` | empty | Overrides automatic project scope |
| `timeoutMs` | — | `4000` | Shared recall + capture budget |
| `requestTimeoutMs` | — | `1000` | Single HTTP timeout |
| `maxBytes` | — | `8000` | `prepare_context` budget |
| `capturePrompts` | `POWERCONTEXT_DSH_CAPTURE_PROMPTS` | `true` | Persist user input as a Source |
| `flushOnCapture` | `POWERCONTEXT_DSH_FLUSH_ON_CAPTURE` | `false` | Flush immediately after capture |

For durable non-secret defaults, edit `~/.dsh/profiles/web/cordis.patch.yml`. Harness **replaces the whole `config` object** for that row, so restate every key you still need:

```yaml
- id: powercontext-dsh
  config:
    baseUrl: https://pc.example.com
    timeoutMs: 4000
    requestTimeoutMs: 1000
    maxBytes: 8000
    capturePrompts: true
    flushOnCapture: false
```

### Remote Server

The plugin runs inside the Harness process. The browser never calls PowerContext. The default Server bind is `127.0.0.1`. A remote Server must listen more widely and enable auth. Put TLS in front before exposing it on a network.

```bash
export POWERCONTEXT_SERVER_HTTP_HOST=0.0.0.0
export POWERCONTEXT_SERVER_HTTP_PORT=8000
export POWERCONTEXT_SERVER_AUTH_ENABLED=true
export POWERCONTEXT_SERVER_AUTH_TOKEN=<long-random-secret>
powercontext server run
```

Publish the API root users actually use, for example `https://pc.example.com`. No trailing slash, and no `/mcp`.

```bash
export POWERCONTEXT_DSH_BASE_URL=https://pc.example.com
export POWERCONTEXT_DSH_AUTHORIZATION="Bearer <long-random-secret>"
dsh web
```

`POWERCONTEXT_DSH_AUTHORIZATION` must be the full `Bearer <token>` and must match `POWERCONTEXT_SERVER_AUTH_TOKEN`. Keep the token in the environment variable, not in the patch file.

Common Server variables:

| Variable | Meaning |
|---|---|
| `POWERCONTEXT_SERVER_HTTP_HOST` / `_PORT` | Listen address |
| `POWERCONTEXT_SERVER_AUTH_ENABLED` / `_TOKEN` | Static Bearer |
| `POWERCONTEXT_HOME` | Data directory |
| `POWERCONTEXT_SERVER_RUNTIME_SCHEDULE_SECONDS` | Extraction interval; unset disables the job |
| `POWERCONTEXT_SERVER_INFERENCE_GENERATION_MODEL` | Generation model used for extraction |

## Development

HTTP operations are generated from PowerContext's `openapi/powercontext.yaml`. Point `POWERCONTEXT_ROOT` or `POWERCONTEXT_OPENAPI` at a checkout, then run `pnpm gen`. `pnpm gen:check` fails when `src/operations.generated.ts` has drifted.

```bash
pnpm install
pnpm gen:check
pnpm test
pnpm test:e2e
pnpm build
```

`pnpm test:e2e` starts a local Server from `POWERCONTEXT_ROOT` and calls liveness, readiness, remember, search, prepare, and capture. It does not start DeepSeek Harness and does not need a model.

- Push to `main` / `master`: run `pnpm test` and `pnpm build`, and check that `lib/` plus the generated table are committed.
- Pull requests: `pnpm test` and `pnpm gen:check`.
- GitHub Release is manual: Actions → **Release** → Run workflow → version such as `0.1.0`. The asset is `powercontext-dsh-X.Y.Z.tgz`.

## License

[Apache License 2.0](LICENSE)
