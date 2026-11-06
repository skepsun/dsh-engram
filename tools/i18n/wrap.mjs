/**
 * dsh-engram RU fork: wrap Chinese client copy in `tr(...)` and maintain the
 * Russian catalog.
 *
 * WHY a codemod instead of hand-editing ~400 strings: upstream copy changes on
 * every release. Re-running this tool after `git rebase` wraps the new strings,
 * keeps existing translations by msgid, and prints what still needs translating.
 *
 * KEYS are the source-language text (gettext-style msgid). Template literals are
 * converted to placeholders: `已沉淀 ${n} 项` -> tr("已沉淀 {0} 项", { "0": n }).
 * A missing catalog entry renders the key itself, so the Chinese UI is the
 * implicit default and new upstream copy never renders "missing.key".
 *
 * Usage:
 *   node tools/i18n/wrap.mjs            # rewrite sources + refresh ru.ts skeleton
 *   node tools/i18n/wrap.mjs --check    # verify only; non-zero when unwrapped copy or empty translations remain
 *
 * The codemod needs the TypeScript 5 compiler API. TypeScript 7 (what the repo's
 * typecheck installs) no longer ships a JS AST API, so a local-only toolchain
 * lives in tools/.toolchain (gitignored):
 *   cd tools/.toolchain && npm install
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SRC = join(ROOT, "client", "src");
const I18N_DIR = join(SRC, "i18n");
const CATALOG = join(I18N_DIR, "ru.ts");
const TOOLCHAIN_TS = join(ROOT, "tools", ".toolchain", "node_modules", "typescript");

const require = createRequire(import.meta.url);
if (!existsSync(join(TOOLCHAIN_TS, "package.json"))) {
  console.error(
    "[i18n:wrap] TypeScript 5 compiler API not found in tools/.toolchain.\n" +
      "  cd tools/.toolchain && npm install\n" +
      "  (TypeScript 7, used by the repo typecheck, dropped the JS AST API.)",
  );
  process.exit(2);
}
const ts = require(TOOLCHAIN_TS);

const CHECK_ONLY = process.argv.includes("--check");
const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;
/** True for strings that contain a *letter/ideograph*, not just CJK punctuation. */
const CJK_TEXT = /[\u3400-\u9fff\uf900-\ufaff]/;

/** Files that must never be rewritten (the catalogs themselves). */
function isCatalogFile(file) {
  return file.startsWith(I18N_DIR + "/");
}

function listSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out.sort();
}

function rel(file) {
  return file.slice(ROOT.length + 1);
}

/** Module path for the `tr` import (all components live directly in client/src). */
function importSpecifier(file) {
  return "./i18n";
}

/** Decoded text of a string-ish node, or undefined. */
function stringValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** Ancestor chain helpers. */
function ancestor(node, predicate) {
  let p = node.parent;
  while (p !== undefined) {
    if (predicate(p)) return p;
    p = p.parent;
  }
  return undefined;
}

function isPropertyName(node) {
  const p = node.parent;
  if (p === undefined) return false;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isPropertyDeclaration(p) && p.name === node) return true;
  if (ts.isPropertySignature(p) && p.name === node) return true;
  if (ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) return p.name === node;
  if (ts.isMethodDeclaration(p) && p.name === node) return true;
  if (ts.isEnumMember(p) && p.name === node) return true;
  return false;
}

function isModuleSpecifier(node) {
  const p = node.parent;
  if (p === undefined) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return p.moduleSpecifier === node;
  if (ts.isExternalModuleReference(p)) return p.expression === node;
  if (ts.isImportTypeNode(p) && p.argument !== undefined) {
    return ts.isLiteralTypeNode(p.argument) && p.argument.literal === node;
  }
  return false;
}

/** Already `tr("...")`, `tr("...", {...})` argument? */
function isWrappedInTr(node) {
  let p = node.parent;
  while (p !== undefined && ts.isParenthesizedExpression(p)) p = p.parent;
  if (p === undefined) return false;
  if (!ts.isCallExpression(p)) return false;
  if (!ts.isIdentifier(p.expression) || p.expression.text !== "tr") return false;
  return p.arguments.includes(node);
}

/** `const zh = {...}` / `const en = {...}` locale dictionaries in entry.tsx. */
function inLocaleDictionary(node) {
  const decl = ancestor(node, (p) => ts.isVariableDeclaration(p));
  if (decl === undefined) return false;
  const name = ts.isIdentifier(decl.name) ? decl.name.text : undefined;
  return name === "zh" || name === "en";
}

/**
 * JSX text normalization, matching the compiler's rendering: lines are
 * trimmed of indentation, blank lines dropped, remaining lines joined with one
 * space. Inline leading/trailing spaces on the same line are preserved.
 */
function normalizeJsxText(raw) {
  if (raw.trim() === "") return raw.includes("\n") ? "" : raw;
  const parts = raw.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < parts.length; i++) {
    let s = parts[i];
    if (i > 0) s = s.replace(/^[ \t]+/, "");
    if (i < parts.length - 1) s = s.replace(/[ \t]+$/, "");
    if (s.trim() === "") continue;
    lines.push(s);
  }
  return lines.join(" ");
}

/** Escape a template segment for use inside a double-quoted catalog string. */
function quote(s) {
  return JSON.stringify(s);
}

// ---------------------------------------------------------------------------
// Catalog (client/src/i18n/ru.ts)
// ---------------------------------------------------------------------------

function readCatalog() {
  const order = [];
  const values = new Map();
  if (!existsSync(CATALOG)) return { order, values, text: undefined };
  const text = readFileSync(CATALOG, "utf8");
  const sf = ts.createSourceFile(CATALOG, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "ru" && node.initializer !== undefined) {
      const init = unwrap(node.initializer);
      if (init !== undefined && ts.isObjectLiteralExpression(init)) {
        for (const prop of init.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = ts.isStringLiteral(prop.name) || ts.isIdentifier(prop.name) ? prop.name.text : undefined;
          const value = stringValue(prop.initializer);
          if (key === undefined || value === undefined) continue;
          order.push(key);
          values.set(key, value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { order, values, text };
}

function unwrap(node) {
  let n = node;
  while (n !== undefined && (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n))) n = n.expression;
  return n;
}

function writeCatalog(order, values) {
  const lines = [
    "/**",
    " * Russian catalog for the dsh-engram client.",
    " *",
    " * Keys are the Chinese source text (msgid); values are Russian. A key that is",
    " * absent (or empty) renders the Chinese source, so translations can land",
    " * incrementally. Generated/refreshed by `node tools/i18n/wrap.mjs`; edit the",
    " * values here, re-run `--check` to verify coverage.",
    " */",
    'import type { Messages } from "./index";',
    "",
    "export const ru: Messages = {",
  ];
  for (const key of order) lines.push(`  ${quote(key)}: ${quote(values.get(key) ?? "")},`);
  lines.push("};", "");
  writeFileSync(CATALOG, lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Per-file transform
// ---------------------------------------------------------------------------

function transformFile(file) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const candidates = [];
  const keys = [];
  const skipped = [];

  const addCandidate = (node, kind) => {
    candidates.push({ node, kind, start: node.getStart(sf), end: node.getEnd() });
  };

  /** True when an expression contains JSX of its own (can't become a string param). */
  const hasJsxInside = (node) => {
    let found = false;
    const scan = (n) => {
      if (found) return;
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
        found = true;
        return;
      }
      ts.forEachChild(n, scan);
    };
    scan(node);
    return found;
  };

  /**
   * Merge runs of adjacent JSX text + `{expression}` children into one message
   * so the catalog gets whole sentences with placeholders, not fragments like
   * "高级设置（" + " 项）". Runs stop at element children (an element cannot be a
   * `tr()` param) and at expressions wrapping their own JSX.
   */
  const runs = [];
  const collectRuns = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        const first = children[i];
        if (!ts.isJsxText(first) || !CJK_TEXT.test(first.text)) continue;
        const pieces = [];
        let j = i;
        while (j < children.length) {
          const child = children[j];
          if (ts.isJsxText(child)) pieces.push(child);
          else if (
            ts.isJsxExpression(child) &&
            child.expression !== undefined &&
            !hasJsxInside(child.expression)
          ) {
            pieces.push(child);
          } else break;
          j++;
        }
        const hasExpr = pieces.some((p) => ts.isJsxExpression(p));
        if (hasExpr && pieces.length > 1) {
          runs.push({ pieces, start: pieces[0].getStart(sf), end: pieces[pieces.length - 1].getEnd() });
        }
        i = j - 1;
      }
    }
    ts.forEachChild(node, collectRuns);
  };
  collectRuns(sf);
  const inRun = (node) => {
    const start = node.getStart(sf);
    return runs.some((run) => start >= run.start && start < run.end);
  };

  const runKey = (pieces) => {
    let key = "";
    let index = 0;
    for (const piece of pieces) {
      if (ts.isJsxText(piece)) key += normalizeJsxText(piece.text);
      else key += `{${index++}}`;
    }
    return key;
  };
  for (const run of runs) keys.push(runKey(run.pieces));

  const visitString = (node) => {
    const value = stringValue(node);
    if (value === undefined || !CJK_TEXT.test(value)) return;
    if (isCatalogFile(file) || isModuleSpecifier(node) || inLocaleDictionary(node)) return;
    if (isWrappedInTr(node)) return;
    if (isPropertyName(node)) {
      skipped.push({ file, line: lineOf(node), reason: "property-name", value });
      return;
    }
    keys.push(value);
    addCandidate(node, "string");
  };

  const visitTemplate = (node) => {
    const hasCjk =
      CJK_TEXT.test(node.head.text) || node.templateSpans.some((span) => CJK_TEXT.test(span.literal.text));
    if (!hasCjk) return;
    if (isWrappedInTr(node)) return;
    // Only templates whose quasis contribute text; a pure `${x}` template is not UI copy.
    keys.push(templateKey(node));
    addCandidate(node, "template");
  };

  const visitJsxText = (node) => {
    const raw = node.text;
    if (!CJK_TEXT.test(raw) || inRun(node)) return;
    const text = normalizeJsxText(raw);
    if (text === "") return;
    keys.push(text);
    addCandidate(node, "jsxtext");
  };

  /** Keys already protected by an existing `tr(...)` call (idempotent re-runs). */
  const collectTrCall = (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== "tr") return;
    const arg = node.arguments[0];
    if (arg === undefined) return;
    const value = stringValue(arg);
    if (value !== undefined && CJK_TEXT.test(value)) keys.push(value);
  };

  const walk = (node) => {
    collectTrCall(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) visitString(node);
    else if (ts.isTemplateExpression(node)) visitTemplate(node);
    else if (ts.isJsxText(node)) visitJsxText(node);
    ts.forEachChild(node, walk);
  };
  walk(sf);

  if (candidates.length === 0) return { file, source, next: source, keys, skipped };

  // Build replacement texts (templates/runs recurse into their expressions).
  const reps = [
    ...candidates,
    ...runs.map((run) => ({ kind: "run", start: run.start, end: run.end, pieces: run.pieces })),
  ]
    .map((rep) => ({ ...rep, text: undefined }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const renderRange = (from, to) => {
    let out = "";
    let cursor = from;
    for (const rep of reps) {
      if (rep.start < cursor) continue;
      if (rep.start >= to) break;
      if (rep.end > to) continue;
      out += source.slice(cursor, rep.start);
      out += rep.text ?? buildReplacement(rep);
      cursor = rep.end;
    }
    return out + source.slice(cursor, to);
  };

  const buildReplacement = (rep) => {
    const node = rep.node;
    if (rep.kind === "run") {
      let key = "";
      const args = [];
      for (const piece of rep.pieces) {
        if (ts.isJsxText(piece)) {
          key += normalizeJsxText(piece.text);
        } else {
          key += `{${args.length}}`;
          args.push(renderRange(piece.expression.getStart(sf), piece.expression.getEnd()));
        }
      }
      const params = args.length
        ? `, { ${args.map((a, i) => `${quote(String(i))}: ${a}`).join(", ")} }`
        : "";
      rep.text = `{tr(${quote(key)}${params})}`;
      return rep.text;
    }
    if (rep.kind === "jsxtext") {
      const text = normalizeJsxText(node.text);
      rep.text = `{tr(${quote(text)})}`;
      return rep.text;
    }
    if (rep.kind === "string") {
      const attr = node.parent !== undefined && ts.isJsxAttribute(node.parent) ? node.parent : undefined;
      const arg = source.slice(node.getStart(sf), node.getEnd()); // keep original quotes/escapes
      rep.text = attr !== undefined ? `{tr(${arg})}` : `tr(${arg})`;
      return rep.text;
    }
    // template
    const parts = [node.head.text];
    const args = [];
    for (const span of node.templateSpans) {
      parts.push(span.literal.text);
      args.push(renderRange(span.expression.getStart(sf), span.expression.getEnd()));
    }
    const key = parts.reduce((acc, part, i) => acc + part + (i < args.length ? `{${i}}` : ""), "");
    const params = args.length
      ? `, { ${args.map((a, i) => `${quote(String(i))}: ${a}`).join(", ")} }`
      : "";
    rep.text = `tr(${quote(key)}${params})`;
    return rep.text;
  };

  let next = renderRange(0, source.length);

  // Add the import when the file gained call sites and does not import `tr` yet.
  const importedTr = /import\s*\{[^}]*\btr\b[^}]*\}\s*from\s*["']\.\/i18n["']/.test(next);
  if (!importedTr) {
    const spec = importSpecifier(file);
    const insertion = findImportInsertion(sf, source);
    next = next.slice(0, insertion) + `import { tr } from ${JSON.stringify(spec)};\n` + next.slice(insertion);
  }

  return { file, source, next, keys, skipped };
}

/** Offset after the last top-level import declaration (or before first statement). */
function findImportInsertion(sf, source) {
  let offset = 0;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      offset = stmt.getEnd();
      // include the trailing newline after the import
      while (offset < source.length && (source[offset] === "\n" || source[offset] === "\r")) offset++;
      offset = source.slice(0, offset).length;
    } else break;
  }
  if (offset === 0) {
    // no imports — insert before the first token (after a leading block comment)
    const first = sf.statements[0];
    offset = first === undefined ? 0 : first.getStart(sf);
  }
  return offset;
}

function templateKey(node) {
  const parts = [node.head.text];
  for (const span of node.templateSpans) parts.push(span.literal.text);
  return parts.reduce((acc, part, i) => acc + part + (i < parts.length - 1 ? `{${i}}` : ""), "");
}

function lineOf(node) {
  const sf = node.getSourceFile();
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const files = listSources(SRC).filter((f) => !isCatalogFile(f));
const catalog = readCatalog();
const allKeys = new Set();
const results = [];
const skippedAll = [];

for (const file of files) {
  const result = transformFile(file);
  results.push(result);
  for (const key of result.keys) allKeys.add(key);
  skippedAll.push(...result.skipped);
}

// Merge catalog: existing keys still referenced by the source keep their slot
// (and translation); keys removed upstream are dropped; new msgids append.
const BASE_KEYS = ["nav", "refresh", "error"];
const order = catalog.order.filter((key) => allKeys.has(key) || BASE_KEYS.includes(key));
const values = new Map(catalog.values);
for (const key of allKeys) {
  if (!values.has(key)) {
    order.push(key);
    values.set(key, "");
  }
}

const empty = order.filter((key) => (values.get(key) ?? "").trim() === "");
const wrappedFiles = results.filter((r) => r.next !== r.source);

if (CHECK_ONLY) {
  const problems = [];
  for (const key of empty) problems.push(`missing translation: ${JSON.stringify(key)}`);
  for (const skip of skippedAll) problems.push(`unwrapped ${skip.reason} ${rel(skip.file)}:${skip.line} ${JSON.stringify(skip.value)}`);
  if (problems.length > 0) {
    console.error(`[i18n:check] ${problems.length} problem(s):`);
    for (const p of problems.slice(0, 80)) console.error(`  - ${p}`);
    if (problems.length > 80) console.error(`  … and ${problems.length - 80} more`);
    process.exit(1);
  }
  console.log(`[i18n:check] ok — ${order.length} messages, ${files.length} source files`);
  process.exit(0);
}

for (const result of results) {
  if (result.next !== result.source) writeFileSync(result.file, result.next);
}
writeCatalog(order, values);

console.log(`[i18n:wrap] ${wrappedFiles.length}/${files.length} source files updated`);
if (wrappedFiles.length > 0) for (const r of wrappedFiles) console.log(`  - ${rel(r.file)}`);
console.log(`[i18n:wrap] catalog: ${order.length} messages, ${empty.length} untranslated`);
if (empty.length > 0) {
  console.log("[i18n:wrap] new/empty msgids to translate in client/src/i18n/ru.ts:");
  for (const key of empty.slice(0, 60)) console.log(`  - ${JSON.stringify(key)}`);
  if (empty.length > 60) console.log(`  … and ${empty.length - 60} more`);
}
for (const skip of skippedAll) console.log(`[i18n:wrap] skipped ${skip.reason}: ${rel(skip.file)}:${skip.line} ${JSON.stringify(skip.value)}`);
