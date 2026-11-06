/**
 * dsh-engram: unit tests for the client i18n layer.
 *
 * The client catalog is keyed by the Chinese source text (msgid), so the
 * default translator is identity and unknown messages render themselves.
 * Template messages carry `{0}`-style placeholders; `tr()` fills them both for
 * the identity fallback and for an installed catalog translator.
 *
 * Strategy: compile the actual TS modules with the harness-resolved esbuild
 * (the repo intentionally ships no client toolchain as a dependency) and import
 * them from a temp directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { esbuildPkg } from "../client/harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const esbuildDir = esbuildPkg();
if (esbuildDir === null) {
  test("i18n: esbuild unavailable — skipping (install the client toolchain to run)", { skip: true }, () => {});
} else {
  const require = createRequire(join(esbuildDir, "package.json"));
  const esbuild = require("esbuild");

  /** Compile the i18n modules to ESM in a temp dir and import them. */
  async function loadI18n() {
    const tmp = mkdtempSync(join(tmpdir(), "engram-i18n-test-"));
    try {
      await esbuild.build({
        entryPoints: [join(ROOT, "client", "src", "i18n", "index.ts"), join(ROOT, "client", "src", "i18n", "ru.ts")],
        outdir: tmp,
        bundle: true,
        format: "esm",
        platform: "neutral",
        target: "es2022",
        write: true,
        logLevel: "warning",
      });
      writeFileSync(join(tmp, "package.json"), '{"type":"module"}');
      const index = await import(`file://${join(tmp, "index.js")}`);
      const catalog = await import(`file://${join(tmp, "ru.js")}`);
      return { ...index, ru: catalog.ru, tmp };
    } catch (error) {
      rmSync(tmp, { recursive: true, force: true });
      throw error;
    }
  }

  test("i18n: identity fallback renders the msgid and fills placeholders", async () => {
    const { tr, tmp } = await loadI18n();
    try {
      assert.equal(tr("未翻译的消息"), "未翻译的消息");
      assert.equal(tr("已沉淀 {0} 项", { 0: 3 }), "已沉淀 3 项");
      assert.equal(tr("{0}/{1}", { 0: "a", 1: 2 }), "a/2");
      assert.equal(tr("保持 {name}", { name: "как есть" }), "保持 как есть");
      assert.equal(tr("нет плейсхолдеров"), "нет плейсхолдеров");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("i18n: installed catalog translator wins and formats its own placeholders", async () => {
    const { tr, installTranslator, activeLocale, ru, tmp } = await loadI18n();
    try {
      assert.ok(Object.keys(ru).length > 100, "the Russian catalog is populated");
      installTranslator((key, params) => {
        const text = ru[key] ?? key;
        if (params === undefined) return text;
        return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
      }, "ru");
      assert.equal(tr("创建"), "Создать");
      assert.equal(tr("已沉淀 {0} 项", { 0: 3 }), "Перенесено: 3");
      assert.equal(tr("неизвестный ключ"), "неизвестный ключ");
      assert.equal(activeLocale(), "ru");
    } finally {
      installTranslator((key) => key);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("ru catalog: every entry is translated and every translated template keeps its placeholders", async () => {
    const { ru, tmp } = await loadI18n();
    try {
      const empty = Object.entries(ru).filter(([, value]) => value.trim() === "");
      assert.deepEqual(empty, [], "no empty entries in ru.ts");
      for (const [key, value] of Object.entries(ru)) {
        const expected = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        if (expected.length === 0) continue;
        const actual = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        assert.deepEqual(actual, expected, `placeholders differ for ${JSON.stringify(key)}`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}
