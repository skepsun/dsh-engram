/**
 * v0.8-C (advisory): subagent handoff capsules.
 *
 * The proposal wants the parent agent to receive a ≤500-token capsule instead of
 * a child's full report ("conclusion / evidence / open questions / next step").
 * That substitution needs a seam the host does not expose today: `tools/result`
 * is emitted through `ctx.events.dispatch("emit", …)` and the emitter's own
 * comment says it notifies "observers without exposing a mutation or error
 * channel into the outcome" — a listener cannot rewrite what the parent reads.
 *
 * So this module ships the half that IS reachable, and is honest about the
 * difference:
 *
 *   - it distills a child's report into a deterministic capsule and stores it as
 *     a `handoff` memory, so the conclusion survives the child session and can be
 *     recalled after a compaction (the full text stays re-fetchable in the child's
 *     session log);
 *   - it records the source/capsule sizes in the memory itself, so the
 *     "how much would substitution have saved" question is measurable instead of
 *     asserted.
 *
 * Zero LLM: the capsule is extracted by structure (headings, bullets, question
 * marks), never summarized by a model.
 */

export const CAPSULE_TAG = "subagent-capsule";

/** Tool names whose result is a subagent's final report. */
export function isSubagentTool(name) {
  return typeof name === "string" && (name === "subagent" || name === "subagent_fork" || name === "agent");
}

const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*)$/;
const BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const EVIDENCE_RE = /(test|pass|fail|bench|artifact|eval|commit|✔|✓|✗|→|path|\/[\w.-]+\.(?:js|mjs|ts|md|json|yml|yaml|py|go|rs)\b|#\d|sha|https?:)/i;
const OPEN_RE = /(\?|todo|open question|unresolved|blocked|未决|待定|风险|risk)/i;
const NEXT_RE = /(next step|next:|下一步|建议|recommend|should (?:then|now)|follow-?up|remaining)/i;

function cleanLine(line) {
  return String(line ?? "")
    .replace(/^[-*+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic capsule of a long report.
 *
 * Sections are best-effort structural extraction; the footer always states what
 * was compressed and where the original lives, so a reader can tell a capsule
 * from a report.
 */
export function buildCapsule(text, { maxChars = 1800, source = "subagent report" } = {}) {
  const full = String(text ?? "").trim();
  if (full.length === 0) return { capsule: "", sourceChars: 0, capsuleChars: 0 };
  // Keep raw lines: bullet/heading detection needs their prefixes, rendering does not.
  const raw = full.split("\n").filter((l) => l.trim().length > 0);
  const isHeading = (l) => /^\s{0,3}#{1,6}\s+/.test(l);
  const bulletOf = (l) => /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l)?.[1] ?? null;

  // Conclusion: the opening prose before the first heading/bullet, bounded so a
  // wall of text cannot become the "conclusion".
  const conclusionLines = [];
  for (const line of raw) {
    if (isHeading(line) || bulletOf(line) !== null) {
      if (conclusionLines.length > 0) break;
      continue;
    }
    conclusionLines.push(cleanLine(line));
    if (conclusionLines.join(" ").length > 300) break;
  }
  const conclusion = conclusionLines.join(" ").slice(0, 300);

  const bullets = raw.map(bulletOf).filter((b) => b !== null).map(cleanLine);
  const evidence = bullets.filter((b) => EVIDENCE_RE.test(b)).slice(0, 5);
  const open = bullets.filter((b) => OPEN_RE.test(b)).slice(0, 3);
  const next = bullets.filter((b) => NEXT_RE.test(b) && !open.includes(b)).slice(0, 3);

  const parts = [];
  const structured = evidence.length > 0 || open.length > 0 || next.length > 0;
  if (structured) {
    if (conclusion.length > 0) parts.push(`**结论**：${conclusion}`);
    if (evidence.length > 0) parts.push(`**证据**：\n${evidence.map((e) => `- ${e}`).join("\n")}`);
    if (open.length > 0) parts.push(`**未决**：\n${open.map((e) => `- ${e}`).join("\n")}`);
    if (next.length > 0) parts.push(`**下一步**：\n${next.map((e) => `- ${e}`).join("\n")}`);
  } else {
    // Unstructured prose: keep both ends and mark the elision instead of
    // pretending a summary happened.
    const head = raw.slice(0, 2).map(cleanLine).join("\n");
    const tail = raw.slice(-2).map(cleanLine).join("\n");
    parts.push(`**无结构可提炼（保留首尾）**：\n${head}\n…\n${tail}`);
  }

  const footer = (chars) =>
    `\n\n---\n胶囊：${source} ${full.length} → ${chars} 字符；全文在子代理会话日志里（可用 session 搜索回取）。`;
  const room = Math.max(200, maxChars - 120);
  let body = parts.join("\n\n");
  if (body.length > room) body = `${body.slice(0, room).trimEnd()}…`;

  let capsule = `${body}${footer(body.length)}`;
  // A "compression" that is not smaller is a bug, not a summary: fall back to a
  // straight head/tail cut that is guaranteed to fit.
  if (capsule.length >= full.length) {
    const cut = Math.max(120, Math.floor((full.length - 200) * 0.7));
    const head = full.slice(0, cut).trimEnd();
    const tail = full.slice(-Math.min(80, Math.max(0, full.length - cut - 1))).trim();
    body = `**无结构可提炼（保留首尾）**：\n${head}…\n…${tail}`;
    capsule = `${body}${footer(body.length)}`;
    if (capsule.length >= full.length) capsule = full.slice(0, Math.max(80, full.length - 1));
  }
  return { capsule, sourceChars: full.length, capsuleChars: capsule.length };
}

/** Read the text out of a tool result (string, content blocks, or value fields). */
export function resultText(result) {
  const value = result?.value;
  if (typeof value === "string" && value.length > 0) return value;
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value.content)) {
      const joined = value.content
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n");
      if (joined.length > 0) return joined;
    }
    if (typeof value.text === "string" && value.text.length > 0) return value.text;
  }
  const content = result?.content;
  if (Array.isArray(content)) {
    const joined = content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
    if (joined.length > 0) return joined;
  }
  return null;
}
