/**
 * dsh-engram session episode (PROPOSAL-evolution §4 v0.7-A).
 *
 * At the session's teardown edge we distill the event log into ONE compact
 * `episode` memory: what was touched, what ran, what failed (and whether it
 * later succeeded), the written commit subjects, and what is still open.
 *
 * Design constraints:
 *   - zero LLM, pure function over `session.events` (survives restarts);
 *   - never enters the [ENGRAM] index (long background context, not a symbol);
 *   - bounded by construction (≤4 files / ≤4 commands / ≤2 decisions / ≤3 open);
 *   - stored only when there is substance (a bare `ls` session produces none);
 *   - retention is capped per workspace by the sink in index.js, not by TTL.
 *
 * This is the raw material for the resume brief and, later, entity pages.
 */

import { cmdTag } from "./capture.js";
import { pendingTodosFromSession } from "./todo-sink.js";

const EDIT_TOOLS = new Set(["write", "edit", "str_replace_editor"]);
const RUN_TOOLS = new Set(["bash", "shell", "exec"]);

function parseArgs(raw) {
  if (raw !== null && typeof raw === "object") return raw;
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function clip(text, max) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function stamp(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Repo-relative display path when the file lives under the session cwd. */
function displayPath(path, cwd) {
  const p = String(path ?? "");
  if (typeof cwd === "string" && cwd.length > 0 && p.startsWith(`${cwd}/`)) return p.slice(cwd.length + 1);
  return p;
}

function commitSubject(command) {
  if (!/^\s*git\s+commit\b/.test(command)) return null;
  const m = command.match(/-m\s+["']([^"']{1,80})["']/);
  return m === null ? null : clip(m[1], 60);
}

/**
 * Build the episode record from a disposed session.
 *
 * @param {object} session session with `.events` + `.header.cwd`
 * @param {object} [opts]
 * @returns {{text: string, tags: string[], signal: number, summary: object}|null}
 */
export function buildEpisode(session, { now = Date.now() } = {}) {
  if (session === null || typeof session !== "object") return null;
  const events = Array.isArray(session.events) ? session.events : [];
  if (events.length === 0) return null;
  const cwd = session?.header?.cwd;

  const files = new Map(); // display path -> count
  const commands = new Map(); // cmd tag -> row
  const decisions = [];
  const callMeta = new Map(); // callId -> { tag, row }
  let failedRuns = 0;

  for (const event of events) {
    if (event === null || typeof event !== "object") continue;
    const type = event.type;
    if (type === "tool/call") {
      const data = event.data ?? {};
      const name = String(data.name ?? "").toLowerCase();
      const args = parseArgs(data.arguments);
      const callId = typeof data.callId === "string" ? data.callId : null;
      if (EDIT_TOOLS.has(name)) {
        const path = String(args.path ?? args.file_path ?? args.filePath ?? "");
        if (path.length > 0) {
          const shown = displayPath(path, cwd);
          files.set(shown, (files.get(shown) ?? 0) + 1);
        }
      }
      if (RUN_TOOLS.has(name) && typeof args.command === "string") {
        const tag = cmdTag(args.command);
        if (tag !== null) {
          const row = commands.get(tag) ?? { tag, count: 0, failed: false, fixed: false };
          row.count += 1;
          commands.set(tag, row);
          if (callId !== null) callMeta.set(callId, { tag, row });
        }
        const subject = commitSubject(args.command);
        if (subject !== null) decisions.push(subject);
      }
      continue;
    }
    if (type === "tool/result") {
      const content = event?.data?.message?.content;
      const block = Array.isArray(content) ? content.find((c) => c?.type === "tool-result") : null;
      const callId = block?.toolCallId ?? event?.data?.message?.source?.callId;
      const meta = typeof callId === "string" ? callMeta.get(callId) : void 0;
      if (meta === void 0) continue;
      const isError = block?.isError === true || event?.data?.error !== void 0;
      if (isError) {
        if (!meta.row.failed) failedRuns += 1;
        meta.row.failed = true;
      } else if (meta.row.failed) {
        meta.row.fixed = true;
      }
    }
  }

  const open = pendingTodosFromSession(session).slice(0, 3);
  const hasSubstance = files.size > 0 || decisions.length > 0 || failedRuns > 0 || open.length > 0;
  if (!hasSubstance) return null;

  const parts = [];
  if (files.size > 0) {
    const shown = [...files.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([path]) => clip(path, 48));
    parts.push(`files ${shown.join(", ")}`);
  }
  if (commands.size > 0) {
    const rows = [...commands.values()]
      .sort((a, b) => Number(b.failed) - Number(a.failed) || b.count - a.count)
      .slice(0, 4)
      .map((row) => {
        const head = row.tag.replace(/^cmd:/, "").replace(/_/g, " ");
        const mark = row.failed ? (row.fixed ? "→fixed" : "→failed") : "";
        return `${clip(head, 32)}×${row.count}${mark}`;
      });
    parts.push(`cmds ${rows.join(", ")}`);
  }
  if (decisions.length > 0) {
    parts.push(`decisions ${decisions.slice(0, 2).map((d) => `"${clip(d, 40)}"`).join(", ")}`);
  }
  if (open.length > 0) parts.push(`open ${open.map((t) => clip(t, 40)).join("; ")}`);

  const text = clip(`session episode ${stamp(now)}: ${parts.join(" · ")}`, 900);
  return {
    text,
    signal: 0.25,
    tags: ["episode", "auto-captured", ...(failedRuns > 0 ? ["fix"] : [])],
    summary: {
      files: [...files.keys()],
      commands: [...commands.values()],
      decisions,
      open,
      failedRuns,
    },
  };
}
