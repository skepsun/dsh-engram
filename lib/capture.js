/**
 * dsh-engram: zero-LLM auto-capture from tool results.
 *
 * Watches `tools/result` (the DSH-native equivalent of symbolic-index's PostToolUse
 * hook) and extracts meaningful events by pure pattern matching on tool name +
 * arguments. No model call, no embeddings — just deterministic extractors,
 * in-memory rate limiting, and exact-duplicate dedup at the store layer.
 *
 * Extractors (default on):
 *   - git milestones via bash (commit with an -m subject / merge / rebase /
 *     branch / tag / cherry-pick). Pure plumbing (`push`, `stash`, `status`)
 *     is deliberately NOT captured: those are operational echoes, not lasting
 *     decisions, and would only drown the memory pool and the [ENGRAM] index.
 *   - failing test runs (`npm test` / `node --test` / vitest / jest / pytest)
 *     as high-signal error memories tagged `test`.
 *   - writes/edits to significant config & doc paths
 *   - repeated tool errors (error signal, deduped by message)
 * symbolic-index's own insight: one file edit is noise; accumulated edits and rare
 * git milestones are signal. Low-signal entries stay out of the [ENGRAM] index
 * until they accumulate recall hits.
 */

import { workspaceKey as workspaceKeyOf } from "./util.js";

const GIT_MILESTONE_SIGNAL = 0.5;
const GIT_COMMIT_SIGNAL = 0.55;
const TEST_FAILURE_SIGNAL = 0.35;
const FIX_CLOSURE_SIGNAL = 0.45;

/** Concrete text: a test-run command (npm/pnpm/yarn/bun/npx/node --test/…). */
const TEST_RUN_RE = /\b(npm|pnpm|yarn|bun|npx|corepack)\s+(?:run\s+)?test\b|\bnode\s+--test\b|\bvitest\b|\bpytest\b|\bjest\b/;
/** A result line that reads as a failure point (deterministic keyword scan). */
const FAILURE_LINE_RE = /(assertionerror|#\s*fail(?:ed)?|not\s+ok|✗|✖|✘|\bFAIL(?:ED)?\b|tests?\s+failed|failed\s+tests?\b|\d+\s+failed|non-zero exit|exception|traceback|error:\s)/i;

/**
 * Normalize a command to a stable short signature tag (first two tokens,
 * spaces → underscores, ≤48 chars) used to pair a failure with its later
 * successful run. Returns null for empty commands.
 */
export function cmdTag(command) {
  const tokens = String(command ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (tokens.length === 0) return null;
  return `cmd:${tokens.join("_").slice(0, 48)}`;
}

/**
 * Failure→fix closure (zero LLM): when a command that previously failed (an
 * ACTIVE kind:error memory tagged with the same `cmd:` signature) now runs
 * successfully, produce a `procedure` memory plus the ids of the resolved
 * error rows. Deterministic; fires only on genuine same-command
 * success-after-failure.
 */
export function fixClosureEntry(name, command, result, previousErrors) {
  if (!["bash", "shell", "exec"].includes(name)) return null;
  if (result?.isError === true) return null; // not a success
  if (typeof command !== "string" || command.trim().length === 0) return null;
  const tag = cmdTag(command);
  if (tag === null) return null;
  const failing = (previousErrors ?? []).filter(
    (m) => m.kind === "error" && m.status === "active" && (m.tags ?? []).includes(tag),
  );
  if (failing.length === 0) return null;
  const head = command.trim().split(/\s+/).slice(0, 2).join(" ");
  const isTest = TEST_RUN_RE.test(command);
  const plural = failing.length > 1 ? "s" : "";
  return {
    entry: {
      kind: "procedure",
      text: `fixed: ${head} — ${failing.length} earlier failing run${plural} now succeed`,
      signal: FIX_CLOSURE_SIGNAL,
      tags: ["procedure", "auto-captured", "fix", tag, ...(isTest ? ["test"] : [])],
      filePath: null,
    },
    resolvedIds: failing.map((m) => m.id),
  };
}

/** Git operations that carry lasting meaning (milestones). */
const GIT_OPS = [
  // commit: only with an explicit -m subject — that's the semantic content.
  { kind: "commit", pattern: /\bgit\s+commit\b/, text: (_cmd) => gitSubject(_cmd) },
  { kind: "milestone", pattern: /\bgit\s+merge\b/, text: (cmd) => `git merge: ${headLine(cmd)}` },
  { kind: "milestone", pattern: /\bgit\s+rebase\b/, text: (cmd) => `git rebase: ${headLine(cmd)}` },
  { kind: "milestone", pattern: /\bgit\s+cherry-pick\b/, text: (cmd) => `git cherry-pick: ${headLine(cmd)}` },
  { kind: "milestone", pattern: /\bgit\s+tag\b/, text: (cmd) => `git tag: ${headLine(cmd)}` },
  { kind: "milestone", pattern: /\bgit\s+checkout\s+-b\s+(\S+)/, text: (_cmd, m) => `git branch created: ${m[1]}` },
];

/**
 * Extract the `-m "subject"` (or -m 'subject') from a commit command.
 * Returns null when there is no written commit message — a `git commit` run
 * via an editor, `--amend`, or an un-messaged commit is an operational echo,
 * not a memory. (The --amend/-a case for an already-reworded subject still
 * carries its own -m, so it keeps working; silent commits are dropped.)
 */
function gitSubject(cmd) {
  const m = cmd.match(/-m\s+["']([^"']{0,64})["']/i);
  if (m) return `git commit: ${m[1]}`;
  return null;
}

function headLine(cmd) {
  return String(cmd).replace(/\s*\n+\s*/g, " ").trim().slice(0, 64);
}

/** Paths where a write is significant enough to remember (mirrors symbolic-index). */
const SIGNIFICANT_PATH = [
  /(^|\/)(AGENTS|CLAUDE|README|CHANGELOG|CONTRIBUTING)\.md$/i,
  /(^|\/)package\.json$/i,
  /(^|\/)tsconfig.*\.json$/i,
  /(^|\/)biome\.json$/i,
  /(^|\/)Dockerfile$/i,
  /(^|\/)\.esr/i,
  /(^|\/)\.engram/i,
  /(^|\/)\.symbolic-index/i,
  /docs\/.*\.(md|rst)$/i,
];

const EDIT_TOOLS = new Set(["write", "str_replace_editor", "edit"]);
const READ_TOOLS = new Set(["read"]);
/** Never capture our own noise or the explicit memory tools. */
const OWN_TOOLS = new Set(["engram_store", "engram_recall", "engram_detail", "esr_task", "esr_close", "esr_link"]);

/**
 * Build the tools/result listener. `store` is the opened engram domain handle;
 * `config.autoCapture*` control rate. Returns a handler (exec, result) => void
 * (fire-and-forget — never blocks the tool pipeline, never throws).
 * `stats` (optional) is a mutable {total, git, file, error} counter the GUI
 * overview reads for capture observability.
 */
export function makeCaptureHandler(store, config, log, stats) {
  const recent = new Set();
  const perSession = new Map(); // sessionId -> count, to bound captures
  let captures = 0;

  return (exec, result) => {
    try {
      const name = String(exec?.name ?? "").toLowerCase();
      if (name.length === 0 || OWN_TOOLS.has(name)) return;
      const agent = exec?.agent;
      if (agent === void 0) return;
      const cwd = agent.session?.header?.cwd;
      const sessionId = agent.session?.id;
      if (cwd === void 0 || cwd.length === 0 || sessionId === void 0) return;

      // per-session rate limit
      const used = perSession.get(sessionId) ?? 0;
      if (used >= config.autoCapturePerSession) return;
      perSession.set(sessionId, used + 1);

      if (captures >= (config.autoCaptureGlobalCap ?? 500)) return;
      captures += 1;

      const args = (exec.arguments ?? {});
      const git = extractGit(name, args.command);
      let entry = null;

      if (git !== null) {
        entry = { kind: "decision", text: git.text, signal: git.signal, tags: git.tags };
      } else if (result?.isError === true) {
        // Errors take precedence over tool-name classification: a failed edit
        // tool is a FAILURE of that file, not an "Edited" event (filePath anchor).
        const errPath = String(args.path ?? args.file_path ?? args.filePath ?? "");
        const cmd = cmdTag(args.command); // pairs this failure with a later success
        // A failing test run is the highest-value coding signal: name it
        // explicitly and surface the concrete failure point.
        const testFail = extractTestFailure(name, args.command, result);
        if (testFail !== null) {
          entry = { kind: "error", text: testFail, signal: TEST_FAILURE_SIGNAL, tags: ["error", "test", "auto-captured", cmd].filter(Boolean), filePath: null };
        } else {
          const msg = errorHead(result);
          if (msg !== null) {
            entry = { kind: "error", text: `${name} failed: ${msg}`, signal: 0.25, tags: ["error", "auto-captured", cmd].filter(Boolean), filePath: errPath || null };
          }
        }
      } else if (isCommandRun(name) && typeof args.command === "string" && store.listMemories !== void 0) {
        // Failure→fix closure: the same command that once failed now succeeds —
        // sediment a `procedure` and resolve the earlier error rows.
        const fix = fixClosureEntry(
          name,
          args.command,
          result,
          store.listMemories(workspaceKeyOf(cwd), 200),
        );
        if (fix !== null) {
          entry = fix.entry;
          entry._resolvedIds = fix.resolvedIds;
        }
      } else if (EDIT_TOOLS.has(name)) {
        const path = String(args.path ?? args.file_path ?? args.filePath ?? "");
        if (path.length > 0 && SIGNIFICANT_PATH.some((re) => re.test(path))) {
          entry = { kind: "fact", text: `Edited ${path}`, signal: 0.3, tags: ["file", "edit", "auto-captured", `dir:${dirOf(path)}`], filePath: path };
        }
      } else if (READ_TOOLS.has(name)) {
        const path = String(args.path ?? args.file_path ?? args.filePath ?? "");
        if (path.length > 0 && /(^|\/)(AGENTS|CLAUDE)\.md$/i.test(path)) {
          entry = { kind: "fact", text: `Read ${path}`, signal: 0.3, tags: ["file", "read", "config", "auto-captured"], filePath: path };
        }
      }

      if (entry === null) return;
      if (stats) {
        stats.total += 1;
        if (entry.kind === "decision") stats.git += 1;
        else if (entry.kind === "error") stats.error += 1;
        else stats.file += 1;
      }

      // exact-duplicate guard across the recent window (store re-dedups by hash anyway)
      const key = `${entry.kind}|${entry.text}`;
      if (recent.has(key)) return;
      recent.add(key);
      if (recent.size > 500) {
        const first = recent.values().next().value;
        recent.delete(first);
      }

      const resolvedIds = entry._resolvedIds ?? [];
      void store
        .storeMemory(
          {
            workspace: workspaceKeyOf(cwd),
            kind: entry.kind,
            text: entry.text,
            tags: entry.tags,
            signal: entry.signal,
            filePath: entry.filePath ?? null,
            sessionId,
            seq: agent.session.events?.length ?? 0,
          },
          config,
        )
        .then(() => {
          // Failure→fix closure: mark the earlier error rows resolved (tag
          // append only — never re-ranks them, per store.tagMemory's contract).
          for (const id of resolvedIds) {
            void store.tagMemory?.(workspaceKeyOf(cwd), id, "resolved")?.catch?.(() => null);
          }
        })
        .catch((error) => log?.warn?.(`engram auto-capture failed: ${String(error)}`));
    } catch (error) {
      // fully contained — a capture bug must never disturb the tool pipeline
      log?.warn?.(`engram auto-capture threw: ${String(error)}`);
    }
  };
}

function extractGit(name, command) {
  if (name !== "bash") return null;
  if (typeof command !== "string" || command.length === 0) return null;
  for (const op of GIT_OPS) {
    const m = command.match(op.pattern);
    if (m) {
      try {
        const text = op.text(command, m);
        if (text === null) return null; // git commit without an -m subject: drop
        return {
          text,
          signal: op.kind === "commit" ? GIT_COMMIT_SIGNAL : GIT_MILESTONE_SIGNAL,
          tags: ["git", "auto-captured", op.kind],
        };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Shell-run tool names whose failures/successes carry a command signature. */
function isCommandRun(name) {
  return name === "bash" || name === "shell" || name === "exec";
}

function errorHead(result) {
  // canonical value or rendered content
  const value = result?.value;
  if (typeof value === "string" && value.length > 0) return value.slice(0, 80);
  if (value !== null && typeof value === "object") {
    const first = value.error ?? value.stderr ?? value.message ?? value.stdout;
    if (typeof first === "string" && first.length > 0) return first.slice(0, 80);
  }
  const content = result?.content;
  if (Array.isArray(content) && content.length > 0) {
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string" && block.text.length > 0) {
        return block.text.slice(0, 80);
      }
    }
  }
  return null;
}

/**
 * When a bash/shell run of a test command exits non-zero, produce a
 * deterministic failure memory: `tests failed (<cmd>): <failure line>`.
 * Returns null for non-test commands, successful runs, or when no failure
 * line can be pinned down (generic error extraction then applies).
 */
function extractTestFailure(name, command, result) {
  if (name !== "bash" && name !== "shell" && name !== "exec") return null;
  if (typeof command !== "string" || !TEST_RUN_RE.test(command)) return null;
  if (result?.isError !== true) return null;
  const line = failureLine(result);
  if (line === null) return null;
  const head = command.trim().split(/\s+/).slice(0, 2).join(" ");
  return `tests failed (${head}): ${line}`;
}

/** First failure-flavoured line of a result (≤120 chars), else its head. */
function failureLine(result) {
  const blocks = [];
  const value = result?.value;
  if (typeof value === "string" && value.length > 0) blocks.push(value);
  if (value !== null && typeof value === "object") {
    for (const k of ["error", "stderr", "message", "stdout"]) {
      if (typeof value[k] === "string" && value[k].length > 0) blocks.push(value[k]);
    }
  }
  const content = result?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string") blocks.push(block.text);
    }
  }
  for (const block of blocks) {
    const lines = block.split("\n");
    for (const line of lines) {
      const trimmed = line.trim().replace(/\s+/g, " ").slice(0, 120);
      if (FAILURE_LINE_RE.test(trimmed)) return trimmed;
    }
  }
  const first = blocks[0];
  return typeof first === "string" && first.length > 0 ? first.split("\n")[0].trim().slice(0, 120) : null;
}

function dirOf(path) {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : ".";
}
