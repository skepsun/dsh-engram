/**
 * dsh-engram JIT push (PROPOSAL-evolution §4 v0.6-C).
 *
 * The measured failure mode: pull-only recall is dormant — the model rarely
 * calls `engram_recall` on its own (24 calls / 8 details across 112 real
 * sessions). JIT flips the direction: when a deterministic, high-precision
 * event makes a known memory immediately relevant, append ONE short line to
 * the prompt at that moment:
 *
 *   - error recurrence — the same `cmd:` signature fails a second time, and a
 *     prior error/procedure memory already exists for it;
 *   - file focus — the same file is edited twice in a row, and a memory is
 *     anchored to that file (preference > fact/decision);
 *   - goal completion — a goal completes/blocks while active ESR tasks remain.
 *
 * Invariants:
 *   - append-only per session: a pushed line is never edited or withdrawn, so
 *     the prefix changes at most once per push (the ledger prices the rewrite);
 *   - no hit, no line (silence beats noise);
 *   - hard budget: `maxLines` per session, `maxLineChars` per line;
 *   - pure rules, zero LLM, fail-contained.
 *
 * The resume brief (§v0.7) is deliberately not here yet.
 */

import { cmdTag } from "./capture.js";
import { shortId, workspaceKey as wk } from "./util.js";

const EDIT_TOOLS = new Set(["write", "str_replace_editor", "edit"]);
const RUN_TOOLS = new Set(["bash", "shell", "exec"]);

function clip(text, max) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function basename(p) {
  const parts = String(p ?? "").split("/");
  return parts[parts.length - 1] || String(p ?? "");
}

function dirname(p) {
  const parts = String(p ?? "").split("/");
  parts.pop();
  return parts.join("/");
}

function isMemory(row) {
  return row !== null && typeof row === "object" && typeof row.id === "string";
}

/**
 * @param {object} [opts]
 * @param {number} [opts.maxLines] hard cap per session (default 3)
 * @param {number} [opts.maxLineChars] hard cap per line (default 220)
 * @param {(push: {sessionId: string, workspace: string, session: object, line: string, chars: number, kind: string}) => void} [opts.onPush]
 * @param {object} [opts.log]
 */
export function createJit({ maxLines = 3, maxLineChars = 220, onPush = null, log = void 0 } = {}) {
  const lineCap = Number.isFinite(maxLines) && maxLines >= 0 ? Math.trunc(maxLines) : 3;
  const charCap = Number.isFinite(maxLineChars) && maxLineChars > 0 ? Math.trunc(maxLineChars) : 220;
  const states = new Map();
  const totals = { pushes: 0, byKind: { error: 0, focus: 0, goal: 0 } };

  function stateFor(sessionId, workspace) {
    let state = states.get(sessionId);
    if (state === void 0) {
      state = {
        sessionId,
        workspace: typeof workspace === "string" ? workspace : "",
        lines: [],
        seen: new Set(),
        failures: new Map(),
        lastFile: "",
        sameFile: 0,
        focusSent: new Set(),
        goalSent: false,
      };
      states.set(sessionId, state);
    } else if (typeof workspace === "string" && workspace.length > 0) {
      state.workspace = workspace;
    }
    return state;
  }

  function push(state, session, kind, line) {
    if (lineCap === 0 || state.lines.length >= lineCap) return false;
    const text = clip(line, charCap);
    if (text.length === 0 || state.seen.has(text)) return false;
    state.lines.push(text);
    state.seen.add(text);
    totals.pushes += 1;
    totals.byKind[kind] = (totals.byKind[kind] ?? 0) + 1;
    try {
      onPush?.({
        sessionId: state.sessionId,
        workspace: state.workspace,
        session,
        kind,
        line: text,
        chars: text.length,
      });
    } catch (error) {
      log?.warn?.(`engram jit onPush failed: ${String(error)}`);
    }
    return true;
  }

  function failLine(state, session, domain, tag) {
    const rows = domain?.searchMemories?.({ workspace: state.workspace, tag, status: "active", limit: 8 }) ?? [];
    const memory = rows.find((row) => isMemory(row) && row.kind === "procedure" && /^fixed:/.test(row.text ?? ""))
      ?? rows.find((row) => isMemory(row) && row.kind === "error");
    if (memory === void 0) return false;
    return push(
      state,
      session,
      "error",
      `[JIT] ${clip(tag, 40)} failed again ×2 — ${memory.kind} #${shortId(memory.id)}: ${clip(memory.text, 92)} · engram_detail ${memory.id}`,
    );
  }

  function focusLine(state, session, domain, path) {
    if (state.focusSent.has(path)) return false;
    state.focusSent.add(path);
    const rows = domain?.listMemories?.(state.workspace, 300) ?? [];
    const dirTag = `dir:${dirname(path)}`;
    const anchored = rows.filter(
      (row) => isMemory(row)
        && row.status === "active"
        && (row.filePath === path || (Array.isArray(row.tags) && row.tags.includes(dirTag))),
    );
    const memory = anchored.find((row) => row.kind === "preference")
      ?? anchored.find((row) => ["fact", "decision", "procedure"].includes(row.kind));
    if (memory === void 0) return false;
    return push(
      state,
      session,
      "focus",
      `[JIT] focus ${clip(basename(path), 36)} ×2 — ${memory.kind} #${shortId(memory.id)}: ${clip(memory.text, 92)} · engram_detail ${memory.id}`,
    );
  }

  return {
    /** Observe a tool result; may push an error-recurrence or file-focus line. */
    observeToolResult(exec, result, domain) {
      try {
        const session = exec?.agent?.session;
        const sessionId = session?.id;
        const cwd = session?.header?.cwd;
        if (typeof sessionId !== "string" || sessionId.length === 0) return;
        if (typeof cwd !== "string" || cwd.length === 0) return;
        const state = stateFor(sessionId, wk(cwd));
        const name = String(exec?.name ?? "").toLowerCase();
        const args = exec?.arguments ?? {};

        if (RUN_TOOLS.has(name) && result?.isError === true && typeof args.command === "string") {
          const tag = cmdTag(args.command);
          if (tag === null) return;
          const count = (state.failures.get(tag) ?? 0) + 1;
          state.failures.set(tag, count);
          if (count === 2) failLine(state, session, domain, tag);
          return;
        }

        if (EDIT_TOOLS.has(name) && result?.isError !== true) {
          const path = String(args.path ?? args.file_path ?? args.filePath ?? "");
          if (path.length === 0) return;
          if (state.lastFile === path) state.sameFile += 1;
          else {
            state.lastFile = path;
            state.sameFile = 1;
          }
          if (state.sameFile === 2) focusLine(state, session, domain, path);
        }
      } catch (error) {
        log?.warn?.(`engram jit tool observe threw: ${String(error)}`);
      }
    },

    /** Observe a session event; may push a goal-completion line. */
    observeEvent(session, event, domain) {
      try {
        if (event?.type !== "goal/change") return;
        const data = event?.data;
        if (data === null || typeof data !== "object") return;
        if (data.operation !== "complete" && data.operation !== "block") return;
        const goal = data.goal;
        if (goal === null || typeof goal !== "object") return;
        const sessionId = session?.id;
        const cwd = session?.header?.cwd;
        if (typeof sessionId !== "string" || sessionId.length === 0) return;
        if (typeof cwd !== "string" || cwd.length === 0) return;
        const state = stateFor(sessionId, wk(cwd));
        if (state.goalSent) return;
        const tasks = domain?.listTasks?.(state.workspace) ?? [];
        const active = tasks.filter((task) => task?.state === "active");
        if (active.length === 0) return;
        const shown = active.slice(0, 2).map((task) => `${task.id} ${clip(task.name, 48)}`).join("; ");
        const more = active.length > 2 ? ` +${active.length - 2}` : "";
        state.goalSent = true;
        push(state, session, "goal", `[JIT] goal ${data.operation} — open: ${shown}${more} · esr_status`);
      } catch (error) {
        log?.warn?.(`engram jit event observe threw: ${String(error)}`);
      }
    },

    /** The frozen JIT block for this session ("" when nothing was pushed). */
    textFor(session) {
      const sessionId = session?.id;
      if (typeof sessionId !== "string") return "";
      return states.get(sessionId)?.lines.join("\n") ?? "";
    },

    /** Drop per-session state at teardown. */
    dispose(sessionId) {
      states.delete(sessionId);
    },

    /** Push counters for /stats + diagnostics. */
    stats() {
      return { ...totals, byKind: { ...totals.byKind }, sessions: states.size };
    },
  };
}
