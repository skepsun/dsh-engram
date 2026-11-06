/**
 * dsh-engram: client translation primitives.
 *
 * Message keys are the SOURCE-LANGUAGE text itself (gettext-style msgid), not
 * invented semantic keys. That keeps the catalog easy to review, makes the
 * Chinese UI the implicit default (a missing entry renders the key), and lets
 * new upstream copy land untranslated instead of as a `missing.key` placeholder.
 *
 * Catalogs register through the DSH locale service:
 *   ctx.locale.register("dsh-engram", { zh, en, ru })
 *   installTranslator(ctx.locale.bind("dsh-engram"))
 * Lookup follows the active locale's fallback chain and ends at the key itself.
 *
 * This module is deliberately framework-free (no React, no DOM): the shared
 * `esrModel` compiles into a plain node ESM module for the test runner, where no
 * translator is installed and `tr()` must be an identity function.
 */

/** Flat message catalog: msgid -> localized text. */
export type Messages = Record<string, string>;

/** Placeholder values: numbers, strings, or anything the caller renders. */
export type MessageParams = Record<string, unknown>;

/** Translator signature: a message key plus optional `{0}`-style placeholders. */
export type Translator = (key: string, params?: Record<string, string>) => string;

/** Default locale tag used for `Intl`/`toLocaleDateString` when no translator is installed.
 * Pinned to en-US so headless tests are identical on every machine. */
const DEFAULT_LOCALE = "en-US";

let translate: Translator = (key) => key;
let localeTag = DEFAULT_LOCALE;

/** Install the active translator (and the locale tag used by date formatting). */
export function installTranslator(fn: Translator, locale?: string): void {
  translate = fn;
  if (locale !== undefined && locale !== "") localeTag = locale;
}

/** Locale id used for locale-aware formatting, e.g. `ru`, `zh`, `en-US`. */
export function activeLocale(): string {
  return localeTag;
}

/** Fill `{0}`, `{name}` placeholders; unknown placeholders stay untouched. */
function format(text: string, params: MessageParams): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

function stringParams(params: MessageParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) out[name] = String(value);
  return out;
}

/** Localize one message. Unknown keys render themselves (the Chinese source). */
export function tr(key: string, params?: MessageParams): string {
  const text = params === undefined ? translate(key) : translate(key, stringParams(params));
  // The identity fallback (no translator installed, or a locale without the
  // msgid) still needs placeholder substitution — templates are catalog keys
  // like "已沉淀 {0} 项", not ready-made strings.
  return params === undefined ? text : format(text, params);
}
