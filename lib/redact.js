/**
 * dsh-engram: deterministic secret redaction for the memory write path.
 *
 * Auto-captured tool results, git commit subjects and error messages can
 * carry real credentials (API keys, tokens, private keys) into long-term
 * memory — and later straight back into a prompt via recall/[ENGRAM]. This
 * module strips them BEFORE persistence so nothing sensitive is ever stored.
 *
 * Rule-based and deterministic (same input ⇒ same output, zero deps, zero
 * LLM). Replacement markers are derived from the secret kind, so exact
 * duplicate detection and error-revival hashing keep behaving consistently
 * across runs. Applied once at the single store write choke point
 * (`storeMemory`), which covers engram_store, auto-capture and any future
 * write path.
 */

const RULES = [
  // Private key blocks (longest first so later rules cannot see them).
  [/-----BEGIN [A-Z0-9 ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]+PRIVATE KEY-----/g, "<REDACTED:private-key>"],
  // JWT (header.payload.signature).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<REDACTED:jwt>"],
  // Stripe live/test keys.
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, "<REDACTED:stripe>"],
  // OpenAI/Anthropic/OpenRouter style sk-… keys.
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/g, "<REDACTED:sk>"],
  // GitHub fine-grained / classic tokens.
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "<REDACTED:github>"],
  // AWS access key IDs.
  [/\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g, "<REDACTED:aws>"],
  // Slack workspace tokens.
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "<REDACTED:slack>"],
  // Basic auth user:pass inside URLs.
  [/\/\/[^:\/\s]+:[^@\s\/]+@/g, "//<REDACTED>@"],
  // Authorization: Bearer <long token>.
  [/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}\b/gi, "<REDACTED:bearer>"],
  // Generic key=value / key: value assignments for obvious secret keys.
  [/\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|passwd|password|persist[_-]?token|refresh[_-]?token|token)\b\s*[:=]\s*['"]?[A-Za-z0-9_\-.\/+=]{6,}['"]?/gi, "<REDACTED:key>"],
];

/**
 * Redact known secret shapes in `text`. Deterministic: identical input yields
 * identical output. Non-secret prose is untouched.
 */
export function redactText(text) {
  let out = String(text ?? "");
  for (const [re, repl] of RULES) out = out.replace(re, repl);
  return out;
}
