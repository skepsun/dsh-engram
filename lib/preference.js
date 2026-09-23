/**
 * dsh-engram: user-correction / preference learning — zero-LLM.
 *
 * Trend-driven (correx / PAHF(Meta, arXiv 2602.16173) / Mem0 preference
 * extraction): when the user corrects or states a preference to the agent,
 * that lesson should persist — "the AI makes a mistake and gets corrected,
 * the lesson survives". The pull-only model left this entirely to manual
 * engram_store calls; this module closes the gap by watching `user/message`
 * session events and turning deterministic correction/preference cues into
 * `preference` memories — no model call, no embeddings, pure pattern rules.
 *
 * Signal design (avoid false positives):
 *   - Only strong, explicit cues are treated as preference statements
 *     (negation "不要用X/别再用X/avoid/never use", substitution "改用X/换成X/
 *     instead of", affirmation "prefer/please use/always use/应该用/统一用").
 *   - A one-shot operation instruction ("运行 npm test") carries no
 *     preference cue and is never captured.
 *   - Interrogatives are skipped — asking "是不是用X?" is not a statement.
 *   - The extracted clause is bounded (4..120 chars); empty/pointless clauses
 *     fall back to no capture.
 *   - A per-session cap and a recent-window dedup mirror the auto-capture
 *     discipline of lib/capture.js (the store layer re-dedups by hash too).
 *   - Captured text is <direction marker> + the extracted clause, so recall
 *     lines read as standing rules ("prefer", "avoid", "switch-to").
 *
 * All functions are pure and deterministic; `now`/weights are injectable for
 * node:test (matching lib/capture.js and lib/rerank.js).
 */

import { workspaceKey as wk } from "./util.js";

/** Direction of the preference statement, used in the captured text. */
export const PREFERENCE_DIRECTION = {
  prefer: "prefer", // affirmative: use / prefer / always use
  avoid: "avoid", // negative: don't use / never / stop
  switch: "switch-to", // substitution: use X instead of Y / 改用 X
};

const PREFERENCE_SIGNAL = 0.55;
/** Cap the per-session count of auto-captured preference memories. */
export const DEFAULT_PREFERENCE_PER_SESSION = 8;

/** Strip leading punctuation/whitespace before a clause. */
function trimLead(s) {
  return s.replace(/^[\s,，。;；:：、!！?？'"“”‘’()（）]+/, "").trim();
}

/** Trim a captured clause to a bounded, single-line window. */
function boundClause(s) {
  let t = String(s ?? "").replace(/\s*\n+\s*/g, " ").replace(/[。；;！!？?]+$/, "").trim();
  t = trimLead(t);
  // trailing sentence particles / connective fillers that are noise in a rule clause
  t = t.replace(/(?:的|了|吧|啊|呢|呀|哦)$/, "").trim();
  if (t.length > 120) t = `${t.slice(0, 120)}…`;
  return t;
}

/** Is this user message an interrogative (asking, not stating)? */
function isInterrogative(text) {
  if (/[?？]\s*$/.test(text)) return true;
  return /(是不是|可不可以|能不能|是否|有没有|好不好|行不行|该不该|要不要)/.test(text);
}

/** Skip meta-talk about our own memory tools (not a real preference). */
function isToolMeta(text) {
  return /(engram_|esr_|\[ENGRAM\]|\[ESR\]|\[RECALL\])/.test(text) && /(记|存|调|删|用|store|recall|remember|delete|remove)/.test(text);
}

/** A single extractor: cue regex + how to derive the clause + direction. */
const EXTRACTORS = [
  // ── Chinese: negation (avoidance) ────────────────────────────────────────
  // 不要用X / 别用X / 别再用X / 不要再X / 请勿使用X / 避免用X / 不要选X…
  {
    re: /(?:不要|别再?|请勿|切勿|避免|禁止|严禁|尽量别)(?:再|去|要)?\s*(?:用|使用|采用|选|选择|用?到){0,2}\s*([^，。;；!！?？\n]{2,80})/,
    kind: PREFERENCE_DIRECTION.avoid,
  },
  // 不要再这样 / 别这么干 (clause after a bare negation)
  {
    re: /(?:不要再|别这样|别这么|不要这样|不要这么)([^，。;；!！?？\n]{0,60})/,
    kind: PREFERENCE_DIRECTION.avoid,
  },
  // 别/不要 bare + trailing object ("别 X" where X is a 2+ char target)
  {
    re: /(?:^|[\s，,;；])(?:别|不要)\s+([^，。;；!！?？\n]{2,80})/,
    kind: PREFERENCE_DIRECTION.avoid,
  },
  // ── Chinese: substitution (switch-to) ─────────────────────────────────────
  // 改用X / 换成X / 用X而不是Y / 应该用X / 统一用X / 优先用X / 尽量用X
  {
    re: /(?:改用|换成|换用|切到|迁移到|改用为|建议用|优先用|统一用|尽量用|应该用|应当用|就得用|最好用|记得用|请用|就用|用用看)\s*([^，。;；!！?？\n]{2,80})/,
    kind: PREFERENCE_DIRECTION.switch,
  },
  {
    re: /(?:应该|建议|可以|记得|统一|优先|最好|尽量)\s*都?\s*(?:用|选|采用?|使?用?到)\s*([^，。;；!！?？\n]{2,80})/,
    kind: PREFERENCE_DIRECTION.switch,
  },
  {
    re: /(?:用|选|采用?)\s*([^，。;；!！?？\n]{2,80})\s*(?:而|而不是|而非|别|不要)\s*(?:用|选|采用?)?\s*([^，。;；!！?？\n]{1,40})/,
    kind: PREFERENCE_DIRECTION.switch,
  },
  // ── Chinese: affirmation (prefer) ────────────────────────────────────────
  // 喜欢用X / 习惯用X / 更倾向X / 偏好X
  {
    re: /(?:偏好|更倾向(?:于)?|喜欢用|习惯用|爱用|常用)\s*([^，。;；!！?？\n]{2,80})/,
    kind: PREFERENCE_DIRECTION.prefer,
  },
  {
    re: /(?:以后|从现在起|之后|接下来|后面|下次)\s*(?:都|一律|统一)?\s*(?:用|选|采用?)\s*([^，。;；!！?？\n]{2,80})/,
    kind: PREFERENCE_DIRECTION.switch,
  },

  // ── English: negation (avoidance) ─────────────────────────────────────────
  // don't use X / do not use X / never use X / avoid X / stop using X.
  // The clause runs to the next sentence/beginning-of-comma boundary so a
  // short target like "var" in "never use var, always use let" survives.
  {
    re: /\b(?:don'?t|do not|never|stop|avoid|please don'?t|do not ever)\s+(?:use|using|pick|choose|select|go with|use?ing)?\s*([A-Za-z0-9_./@-]+(?:\s+[A-Za-z0-9_./'()@-]{1,60}){0,5})/i,
    kind: PREFERENCE_DIRECTION.avoid,
  },
  // X is not allowed / no more X
  {
    re: /\b(?:no more|not allowed|clear|drop)\s+([A-Za-z0-9_./@-]+(?:\s+[A-Za-z0-9_./'()@-]{1,60}){0,5})/i,
    kind: PREFERENCE_DIRECTION.avoid,
  },
  // ── English: substitution (switch-to) ─────────────────────────────────────
  // use X instead (of Y) / switch to X / go with X / move to X
  {
    re: /\b(?:use|using|switch to|switch over to|go with|move to|migrate to|default to|prefer to use)\s+([A-Za-z0-9_./@-]+(?:\s+[A-Za-z0-9_./'()@-]{1,60}){0,5})\s*(?:instead|rather|over|from now on)?/i,
    kind: PREFERENCE_DIRECTION.switch,
  },
  // instead of / rather than (primary target elsewhere)
  {
    re: /\b(?:instead of|rather than|as opposed to)\s+([A-Za-z0-9_./@-]+(?:\s+[A-Za-z0-9_./'()@-]{1,60}){0,5})/i,
    kind: PREFERENCE_DIRECTION.avoid,
  },
  // ── English: affirmation (prefer) ─────────────────────────────────────────
  {
    re: /\b(?:i prefer|prefer|i like|like using|usually use|always use|we use|please use)\s+([A-Za-z0-9_./@-]+(?:\s+[A-Za-z0-9_./'()@-]{1,60}){0,5})/i,
    kind: PREFERENCE_DIRECTION.prefer,
  },
];

/**
 * Extract a preference statement from user message text, or null when the
 * message carries no explicit correction/preference cue. Pure + deterministic.
 *
 * @param {string} text user message text
 * @returns {{ clause: string, direction: string, text: string, tags: string[] } | null}
 */
export function extractPreference(text) {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  const src = text.trim();
  if (src.length < 6 || src.length > 2000) return null;
  if (isInterrogative(src)) return null;
  if (isToolMeta(src)) return null;

  for (const ex of EXTRACTORS) {
    const m = src.match(ex.re);
    if (!m) continue;
    // A clause may be a short but meaningful target ("var"); 2 chars minimum.
    let clause = boundClause(m[1] ?? "");
    if (clause.length < 2 || clause.length > 120) continue;
    const direction = ex.kind;
    const marker = direction === PREFERENCE_DIRECTION.avoid ? "avoid" : direction === PREFERENCE_DIRECTION.switch ? "switch-to" : "prefer";
    const lang = /[\u4e00-\u9fff]/.test(clause) ? "zh" : "en";
    return {
      clause,
      direction,
      text: `user ${marker}: ${clause}`,
      tags: ["preference", "user", marker, lang, "auto-captured"],
    };
  }
  return null;
}

/**
 * Install the `session/event` listener that captures user corrections and
 * preferences as `preference` memories. Mirrors installGoalCapture's
 * containment + lazy adapter pattern: `storeAdapter` is any
 * { storeMemory(entry) -> Promise } face, resolved per event, with a
 * per-session capture cap and a recent-window dedup. Returns the disposer.
 *
 * @param {object} ctx cordis scoped context (ctx.on available)
 * @param {object} storeAdapter { storeMemory({workspace,kind,text,tags,signal,filePath,sessionId,seq}) -> Promise }
 * @param {object} config { autoCapturePreferences, preferenceCapturePerSession }
 * @param {object} [log]
 * @param {object} [stats] optional mutable {total, preference} counters
 */
export function installPreferenceCapture(ctx, storeAdapter, config, log, stats) {
  if (config?.autoCapturePreferences === false) {
    // still install a no-op listener? No — return a no-op disposer so callers
    // can always dispose without branching on config.
    return () => {};
  }
  const cap = Number.isInteger(config?.preferenceCapturePerSession)
    ? config.preferenceCapturePerSession
    : DEFAULT_PREFERENCE_PER_SESSION;
  const perSession = new Map(); // sessionId -> count
  const recent = new Set(); // `${workspace}|${text}` recent-window dedup

  const onEvent = (session, event) => {
    try {
      if (event?.type !== "user/message") return;
      // Only learn from the human user's own messages. The harness also emits
      // user/message events for injected context (runtime-context, skill-catalog
      // snapshots, etc.) — those are instructions to the model, not corrections
      // the user is teaching us, and must never become preference memories.
      if (event.data?.source?.kind !== "user") return;
      const cwd = session?.header?.cwd;
      const sessionId = session?.id;
      if (typeof cwd !== "string" || cwd.length === 0) return;
      if (typeof sessionId !== "string" || sessionId.length === 0) return;

      const text = messageText(event.data);
      if (text.length === 0) return;

      const extracted = extractPreference(text);
      if (extracted === null) return;

      const used = perSession.get(sessionId) ?? 0;
      if (used >= cap) return;
      perSession.set(sessionId, used + 1);

      const key = `${wk(cwd)}|${extracted.text}`;
      if (recent.has(key)) return;
      recent.add(key);
      if (recent.size > 500) {
        const first = recent.values().next().value;
        recent.delete(first);
      }

      if (stats) {
        stats.total = (stats.total ?? 0) + 1;
        stats.preference = (stats.preference ?? 0) + 1;
      }

      storeAdapter
        .storeMemory(
          {
            workspace: wk(cwd),
            kind: "preference",
            text: extracted.text,
            tags: extracted.tags,
            signal: PREFERENCE_SIGNAL,
            filePath: null,
            sessionId,
            seq: Array.isArray(session.events) ? session.events.length : 0,
          },
          config,
        )
        .then(() => {})
        .catch((error) => log?.warn?.(`engram preference capture failed: ${String(error)}`));
    } catch (error) {
      // fully contained — a capture bug must never disturb the session pipeline
      log?.warn?.(`engram preference capture threw: ${String(error)}`);
    }
  };
  return ctx.on("session/event", onEvent);
}

/**
 * Extract plain text from a `user/message` event data payload. Mirrors the
 * shape understood by index-block.firstUserMessageText: `content` is an
 * array of blocks each with `.text`, or a single `.text` field. Pure.
 */
export function messageText(data) {
  if (data === null || typeof data !== "object") return "";
  const blocks = Array.isArray(data.content) ? data.content : [];
  if (blocks.length > 0) {
    return blocks
      .map((b) => (b !== null && typeof b === "object" && typeof b.text === "string" ? b.text : ""))
      .join(" ")
      .trim();
  }
  return typeof data.text === "string" ? data.text.trim() : "";
}
