#!/usr/bin/env node
/**
 * Compile one G6 round from a secret.
 *
 * Why this exists (round 7, §14.5): the corpus used to be hand-written and
 * committed, so the conventions were PUBLISHED — and a control arm that went to
 * the network cloned this repo and read them out. Fencing the network is one
 * answer; making publication harmless is the better one. Here the conventions
 * are drawn from a secret that never enters git: the generator is public, the
 * round is not, and an arm that reads this file learns how a round is BUILT, not
 * what this round says.
 *
 * What it writes into `--out` (gitignored):
 *   key.json            the drawn conventions — the audit trail, never shipped
 *   seed-memory.json    the same conventions, as memory text the arm may read
 *   tasks.json          id + prompt + check, `--dir` pointing at this round
 *   oracle/<id>.test.mjs  assertions with THIS round's constants baked in
 *   ref/<id>.js, naive/<id>.js  the two sides of the self-check, kept for review
 *
 * It then PROVES the round measures something, per task: the reference
 * implementation must pass and the natural memory-free guess must fail. A task
 * whose guess already agrees with the drawn convention is re-drawn — a round
 * never ships a task that a guess can already answer.
 *
 *   node eval/g6/make-round.mjs --secret <file|string> --name r8
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CHECK = path.join(ROOT, "eval/g6/check.mjs");
const FIXTURE = path.join(ROOT, "eval/fixtures/ledger-kata-blind");

/** Deterministic stream of picks: same secret + round ⇒ same round, always. */
function draw(secret, name, task, attempt) {
  let counter = 0;
  return (options) => {
    const digest = crypto.createHash("sha256").update(`${secret}\u0000${name}\u0000${task}\u0000${attempt}\u0000${counter++}`).digest();
    return options[digest.readUInt32BE(0) % options.length];
  };
}

/**
 * One entry per task. `params` draws the convention, and the other three fields
 * are source generators: the reference implementation, the private oracle, and
 * the guess an arm without the memory would write. Anyone reading this file can
 * write a corpus; only whoever holds the secret knows this round's.
 */
const TASKS = [
  {
    id: "codec",
    file: "codec.js",
    fn: "encodeCheck",
    prompt: "实现 src/codec.js 里的 encodeCheck(input)，按团队约定补上校验字符。改完自己验证一下。",
    params: (pick) => ({
      alphabet: pick(["0123456789abcdefghijklmnopqrstuvwxyz", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghjkmnpqrstuvwxyz23456789"]),
      mul: pick([3, 7, 11]),
      add: pick([5, 7, 13]),
    }),
    describe: (p) =>
      `把输入按位拆成数字 d，每一位算出 \`d × ${p.mul} + ${p.add}\`，所有位的结果相加得到 S，` +
      `取字符集「${p.alphabet}」里下标为 S mod ${p.alphabet.length} 的字符 c（0 起算），返回 \`输入 + "-" + c\`；` +
      `输入里出现数字以外的字符时抛 TypeError。`,
    ref: (p) => `
const ALPHABET = ${JSON.stringify(p.alphabet)};
const MUL = ${p.mul};
const ADD = ${p.add};
export function encodeCheck(input) {
  const s = String(input);
  let sum = 0;
  for (const ch of s) {
    if (ch < "0" || ch > "9") throw new TypeError("encodeCheck: digits only");
    sum += Number(ch) * MUL + ADD;
  }
  return \`\${s}-\${ALPHABET[sum % ALPHABET.length]}\`;
}`,
    naive: `
export function encodeCheck(input) {
  const s = String(input);
  let sum = 0;
  for (const ch of s) sum += Number(ch) * 3 + 7;
  return \`\${s}-\${"0123456789abcdefghijklmnopqrstuvwxyz"[sum % 36]}\`;
}`,
    oracle: (p) => {
      const expect = (input) => {
        let sum = 0;
        for (const ch of input) sum += Number(ch) * p.mul + p.add;
        return `${input}-${p.alphabet[sum % p.alphabet.length]}`;
      };
      return [
        ["encodeCheck", ["1234"], expect("1234")],
        ["encodeCheck", ["9081726354"], expect("9081726354")],
        ["encodeCheck", ["000"], expect("000")],
      ];
    },
    throws: [["encodeCheck", ["12a4"], "TypeError"]],
  },
  {
    id: "errcode",
    file: "errcode.js",
    fn: "fail",
    prompt: "实现 src/errcode.js 里的 fail(code, message, details)，按团队约定抛错。改完自己验证一下。",
    params: (pick) => ({
      prefix: pick(["E_", "ERR_", "APP_"]),
      sep: pick([": ", " — ", " | "]),
      codeCase: pick(["upper", "upper_prefixed"]),
      defaults: pick([true, false]),
    }),
    describe: (p) =>
      `抛出的 Error 的 message 是 \`${p.prefix}<code>${p.sep}<message>\`，错误对象上带 \`.code\`（${p.codeCase === "upper" ? "原样大写下划线码" : "带 " + p.prefix + " 前缀的大写下划线码"}）` +
      (p.defaults ? "，`.details` 缺省为 `{}`。" : "，`.details` 缺省为 `undefined`。") +
      ` code 不是大写下划线格式时抛 TypeError。`,
    ref: (p) => `
const PREFIX = ${JSON.stringify(p.prefix)};
const SEP = ${JSON.stringify(p.sep)};
const CODE_CASE = ${JSON.stringify(p.codeCase)};
const DEFAULTS = ${p.defaults};
export function fail(code, message, details) {
  if (!/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(code)) throw new TypeError("fail: code must be UPPER_SNAKE");
  const err = new Error(PREFIX + code + SEP + message);
  err.code = CODE_CASE === "upper" ? code : PREFIX + code;
  err.details = details === undefined ? (DEFAULTS ? {} : undefined) : details;
  return err;
}`,
    naive: `
export function fail(code, message, details) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}`,
    oracle: (p) => {
      const code = "LEDGER_FROZEN";
      const stored = p.codeCase === "upper" ? code : p.prefix + code;
      const details = p.defaults ? {} : undefined;
      // `fail` returns the Error rather than throwing it; the oracle compares the
      // fields the convention actually constrains.
      return [
        ["fail", [code, "账本已冻结"], { message: `${p.prefix}${code}${p.sep}账本已冻结`, code: stored, details }],
        ["fail", [code, "x", { account: "a1" }], { message: `${p.prefix}${code}${p.sep}x`, code: stored, details: { account: "a1" } }],
      ];
    },
    throws: [["fail", ["ledger-frozen", "x"], "TypeError"]],
    fields: ["message", "code", "details"],
  },
  {
    id: "money",
    file: "money.js",
    fn: "toCents",
    prompt: "实现 src/money.js 里的 toCents(amount) 和 sumAmounts(list)，按团队约定处理分。改完自己验证一下。",
    params: (pick) => ({ rounding: pick(["half-even", "half-away"]), accumulate: pick(["cents", "float"]) }),
    describe: (p) =>
      `金额一律落到整数分：\`toCents\` 用${p.rounding === "half-even" ? "银行家舍入（.5 入到偶数）" : "四舍五入（.5 远离零）"}，` +
      `\`sumAmounts(list)\` ${p.accumulate === "cents" ? "先各自转成分再整数相加，最后 /100" : "直接浮点相加"}。`,
    ref: (p) => `
const ROUNDING = ${JSON.stringify(p.rounding)};
function roundHalfEven(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(x);
}
export function toCents(amount) {
  if (!Number.isFinite(amount)) throw new TypeError("toCents: finite number");
  const scaled = amount * 100;
  return ROUNDING === "half-even" ? roundHalfEven(scaled) : Math.sign(scaled) * Math.round(Math.abs(scaled) + 1e-9);
}
export function sumAmounts(list) {
  ${p.accumulate === "cents" ? "return list.reduce((sum, amount) => sum + toCents(amount), 0) / 100;" : "return list.reduce((sum, amount) => sum + amount, 0);"}
}`,
    naive: `
export function toCents(amount) {
  return Math.round(amount * 100);
}
export function sumAmounts(list) {
  return list.reduce((sum, amount) => sum + amount, 0);
}`,
    oracle: (p) => {
      const even = p.rounding === "half-even";
      const cents = (amount) => (even ? (Math.abs(amount * 100 - Math.floor(amount * 100) - 0.5) < 1e-6 ? (Math.floor(amount * 100) % 2 === 0 ? Math.floor(amount * 100) : Math.ceil(amount * 100)) : Math.round(amount * 100)) : Math.round(amount * 100));
      const total = p.accumulate === "cents" ? (list) => list.reduce((s, a) => s + cents(a), 0) / 100 : (list) => list.reduce((s, a) => s + a, 0);
      const list = [0.1, 0.2, 0.3];
      return [
        ["toCents", [0.125], cents(0.125)],
        ["toCents", [0.135], cents(0.135)],
        ["sumAmounts", [list], total(list)],
        ["toCents", [12.5], 1250],
      ];
    },
  },
  {
    id: "ranking",
    file: "ranking.js",
    fn: "rank",
    prompt: "实现 src/ranking.js 里的 rank(rows)，按团队约定的排序规则返回。改完自己验证一下。",
    params: (pick) => ({ order: pick(["desc", "asc"]), tie: pick(["longer", "shorter"]), then: pick(["reverse", "keep"]) }),
    describe: (p) =>
      `按 score ${p.order === "desc" ? "从高到低" : "从低到高"}；同分时 id ${p.tie === "longer" ? "长的在前" : "短的在前"}；` +
      `同分且 id 等长时，${p.then === "reverse" ? "输入顺序靠后的排前面" : "保持输入顺序"}。返回重排后的记录数组（同一批对象）。`,
    ref: (p) => `
const ORDER = ${JSON.stringify(p.order)};
const TIE = ${JSON.stringify(p.tie)};
const THEN = ${JSON.stringify(p.then)};
export function rank(rows) {
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    const score = ORDER === "desc" ? b.row.score - a.row.score : a.row.score - b.row.score;
    if (score !== 0) return score;
    const len = a.row.id.length - b.row.id.length;
    if (len !== 0) return TIE === "longer" ? -len : len;
    return THEN === "reverse" ? b.index - a.index : a.index - b.index;
  });
  return indexed.map((entry) => entry.row);
}`,
    naive: `
export function rank(rows) {
  return [...rows].sort((a, b) => a.score - b.score);
}`,
    oracle: (p) => {
      const rows = [
        { id: "aa", score: 2 },
        { id: "b", score: 2 },
        { id: "cccc", score: 1 },
        { id: "zz", score: 2 },
        { id: "yy", score: 2 },
      ];
      const order = [...rows].map((row, index) => ({ row, index }));
      order.sort((x, y) => {
        const s = p.order === "desc" ? y.row.score - x.row.score : x.row.score - y.row.score;
        if (s !== 0) return s;
        const len = x.row.id.length - y.row.id.length;
        if (len !== 0) return p.tie === "longer" ? -len : len;
        return p.then === "reverse" ? y.index - x.index : x.index - y.index;
      });
      return [["rank", [rows], order.map((entry) => entry.row)]];
    },
  },
  {
    id: "pad",
    file: "pad.js",
    fn: "formatId",
    prompt: "实现 src/pad.js 里的 formatId(n)，按团队约定格式化编号。改完自己验证一下。",
    params: (pick) => ({ prefix: pick(["L-", "AC-", "TX-"]), width: pick([5, 6, 7]), suffix: pick(["C", "R", "X"]) }),
    describe: (p) =>
      `编号格式：\`${p.prefix}\` + 绝对值的十进制左补零到 ${p.width} 位；负数在后面补 \`${p.suffix}\`；超过 ${p.width} 位不截断。` +
      `n 不是整数时抛 TypeError。`,
    ref: (p) => `
const PREFIX = ${JSON.stringify(p.prefix)};
const WIDTH = ${p.width};
const SUFFIX = ${JSON.stringify(p.suffix)};
export function formatId(n) {
  if (!Number.isInteger(n)) throw new TypeError("formatId: integer");
  return PREFIX + String(Math.abs(n)).padStart(WIDTH, "0") + (n < 0 ? SUFFIX : "");
}`,
    naive: `
export function formatId(n) {
  return "L-" + String(n).padStart(5, "0");
}`,
    oracle: (p) => {
      const fmt = (n) => p.prefix + String(Math.abs(n)).padStart(p.width, "0") + (n < 0 ? p.suffix : "");
      return [
        ["formatId", [42], fmt(42)],
        ["formatId", [0], fmt(0)],
        ["formatId", [-42], fmt(-42)],
        ["formatId", [1234567890], fmt(1234567890)],
      ];
    },
    throws: [["formatId", [1.5], "TypeError"]],
  },
  {
    id: "window",
    file: "window.js",
    fn: "billingDate",
    prompt: "实现 src/window.js 里的 billingDate(iso)，按团队约定的账期切分算归属日。改完自己验证一下。",
    params: (pick) => ({ offset: pick([8, 9, 7]), cutover: pick([4, 5, 6]) }),
    describe: (p) =>
      `账期按本地时区 UTC+${p.offset} 算，且每天 ${String(Math.trunc(p.cutover)).padStart(2, "0")}:00 才切换：` +
      `把瞬时换算到本地后减去 ${p.cutover} 小时，取那一天的 YYYY-MM-DD 字符串；ISO 解析不出来时抛 TypeError。`,
    ref: (p) => `
const OFFSET_MS = ${p.offset} * 3600 * 1000;
const CUTOVER_MS = ${p.cutover} * 3600 * 1000;
export function billingDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new TypeError("billingDate: bad ISO");
  return new Date(t + OFFSET_MS - CUTOVER_MS).toISOString().slice(0, 10);
}`,
    naive: `
export function billingDate(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}`,
    oracle: (p) => {
      const calc = (iso) => new Date(Date.parse(iso) + p.offset * 3600000 - p.cutover * 3600000).toISOString().slice(0, 10);
      return [
        ["billingDate", ["2026-02-28T19:59:00Z"], calc("2026-02-28T19:59:00Z")],
        ["billingDate", ["2026-02-28T20:00:00Z"], calc("2026-02-28T20:00:00Z")],
        ["billingDate", ["2026-12-31T23:30:00Z"], calc("2026-12-31T23:30:00Z")],
      ];
    },
    throws: [["billingDate", ["not-a-date"], "TypeError"]],
  },
  {
    id: "dedupe",
    file: "dedupe.js",
    fn: "dedupe",
    prompt: "实现 src/dedupe.js 里的 dedupe(rows)，按团队约定去重。改完自己验证一下。",
    params: (pick) => ({ keep: pick(["last", "first"]), position: pick(["first", "last"]) }),
    describe: (p) =>
      `按 id 去重，保留${p.keep === "last" ? "最后" : "最先"}出现的那条记录（内容也用它），` +
      `记录在结果里的位置取它${p.position === "first" ? "第一次出现的位置" : "最后一次出现的位置"}。`,
    ref: (p) => `
const KEEP = ${JSON.stringify(p.keep)};
const POSITION = ${JSON.stringify(p.position)};
export function dedupe(rows) {
  const chosen = new Map();
  rows.forEach((row, index) => {
    const seen = chosen.get(row.id);
    if (!seen) chosen.set(row.id, { row, first: index, last: index });
    else {
      seen.last = index;
      if (KEEP === "last") seen.row = row;
    }
  });
  const out = [...chosen.values()].sort((a, b) => (POSITION === "first" ? a.first - b.first : a.last - b.last));
  return out.map((entry) => entry.row);
}`,
    naive: `
export function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
}`,
    oracle: (p) => {
      const rows = [
        { id: "a", v: 1 },
        { id: "b", v: 2 },
        { id: "a", v: 3 },
        { id: "c", v: 4 },
        { id: "b", v: 5 },
      ];
      const chosen = new Map();
      rows.forEach((row, index) => {
        const seen = chosen.get(row.id);
        if (!seen) chosen.set(row.id, { row, first: index, last: index });
        else {
          seen.last = index;
          if (p.keep === "last") seen.row = row;
        }
      });
      const expected = [...chosen.values()].sort((a, b) => (p.position === "first" ? a.first - b.first : a.last - b.last)).map((entry) => entry.row);
      return [["dedupe", [rows], expected]];
    },
  },
  {
    id: "quote",
    file: "quote.js",
    fn: "formatAmount",
    prompt: "实现 src/quote.js 里的 formatAmount(cents)，按团队约定的报价写法返回字符串。改完自己验证一下。",
    params: (pick) => ({ sep: pick(["'", "_", " "]), negative: pick(["parens", "trailing"]) }),
    describe: (p) =>
      `金额以「分」为单位传入，输出两位小数；千分位用 \`${p.sep === " " ? "空格" : p.sep}\`；` +
      `负数写成${p.negative === "parens" ? "括号包起来" : "末尾加减号"}；传入的不是整数分时抛 TypeError。`,
    ref: (p) => `
const SEP = ${JSON.stringify(p.sep)};
const NEG = ${JSON.stringify(p.negative)};
export function formatAmount(cents) {
  if (!Number.isInteger(cents)) throw new TypeError("formatAmount: integer cents");
  const abs = Math.abs(cents);
  const whole = String(Math.trunc(abs / 100)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, SEP);
  const body = whole + "." + String(abs % 100).padStart(2, "0");
  if (cents < 0) return NEG === "parens" ? "(" + body + ")" : body + "-";
  return body;
}`,
    naive: `
export function formatAmount(cents) {
  return (cents / 100).toFixed(2);
}`,
    oracle: (p) => {
      const fmt = (cents) => {
        const abs = Math.abs(cents);
        const body = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, p.sep) + "." + String(abs % 100).padStart(2, "0");
        if (cents < 0) return p.negative === "parens" ? `(${body})` : `${body}-`;
        return body;
      };
      return [
        ["formatAmount", [123456], fmt(123456)],
        ["formatAmount", [-123456], fmt(-123456)],
        ["formatAmount", [0], fmt(0)],
        ["formatAmount", [5], fmt(5)],
      ];
    },
    throws: [["formatAmount", [1.5], "TypeError"]],
  },
  {
    id: "retry",
    file: "retry.js",
    fn: "shouldRetry",
    prompt: "实现 src/retry.js 里的 shouldRetry(attempt, error)，按团队约定的重试口径返回布尔。改完自己验证一下。",
    params: (pick) => ({ statuses: pick([[429], [429, 408], [429, 503]]), code: pick(["E_LEDGER_LOCKED", "E_LOCKED", "E_TRY_LATER"]), max: pick([3, 4, 5]), nonRetry: pick(["E_VALIDATION", "E_BAD_INPUT"]) }),
    describe: (p) =>
      `attempt 是已尝试次数（从 1 开始）。可重试：HTTP ${p.statuses.join(" / ")}，或错误码 \`${p.code}\`；` +
      `不可重试：\`${p.nonRetry}\`（即使 HTTP 状态可重试也不重试）。当 attempt 已经达到 ${p.max} 时不再重试（最多试 ${p.max} 次）；` +
      `其他情况（没有 status、没有 code、其他 status/code）一律不重试。返回 true/false；attempt 小于 1 或不是整数时抛 TypeError。`,
    ref: (p) => `
const STATUSES = ${JSON.stringify(p.statuses)};
const CODE = ${JSON.stringify(p.code)};
const NON = ${JSON.stringify(p.nonRetry)};
const MAX = ${p.max};
export function shouldRetry(attempt, error) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new TypeError("shouldRetry: attempt >= 1");
  if (attempt >= MAX) return false;
  const status = error && typeof error === "object" ? error.status : undefined;
  const code = error && typeof error === "object" ? error.code : undefined;
  if (code === NON) return false;
  if (code === CODE) return true;
  if (typeof status === "number") return STATUSES.includes(status);
  return false;
}`,
    naive: `
export function shouldRetry(attempt, error) {
  const status = error && error.status;
  return attempt < 3 && typeof status === "number" && status >= 500;
}`,
    oracle: (p) => {
      const at = (args, expected) => ["shouldRetry", args, expected];
      const cases = [];
      for (const status of p.statuses) cases.push(at([1, { status }], true));
      cases.push(at([1, { status: 400 }], false));
      cases.push(at([1, { code: p.code }], true));
      cases.push(at([1, { code: p.nonRetry }], false));
      cases.push(at([1, { code: p.nonRetry, status: p.statuses[0] }], false));
      cases.push(at([p.max, { status: p.statuses[0] }], false));
      cases.push(at([p.max - 1, { status: p.statuses[0] }], true));
      cases.push(at([1, { message: "boom" }], false));
      return cases;
    },
    throws: [["shouldRetry", [0, { status: 429 }], "TypeError"]],
  },
];

/**
 * The memory an arm may read: the same conventions, in prose, no code.
 *
 * Shape matters — the seeder walks this array, so a `{memories: […]}` wrapper
 * (the obvious first guess) seeds nothing and the treatment runs blind while the
 * harness believes it is dressed. `signal` is a numeric confidence, not a tag.
 */
function memoriesFor(key) {
  return key.tasks.map((task) => ({
    kind: "fact",
    signal: 0.9,
    tags: ["seeded", "ledger-kata", task.id],
    text: `${task.id} 约定：${task.describe}`,
  }));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[name] = true;
    else {
      args[name] = next;
      i += 1;
    }
  }
  return args;
}

function secretFrom(value) {
  if (!value) throw new Error("--secret <file|string> is required: a round's conventions come from it");
  const asFile = path.resolve(value);
  if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) return fs.readFileSync(asFile, "utf8").trim();
  if (value.length < 16) throw new Error("--secret as a literal must be ≥16 chars (it is the only thing keeping this round private)");
  return value;
}

/** Grade one candidate implementation: 0 = all assertions pass. */
function grade(taskId, implSource, oracleDir, work) {
  const ws = path.join(work.ws, taskId);
  fs.rmSync(ws, { recursive: true, force: true });
  fs.cpSync(FIXTURE, ws, { recursive: true });
  const file = path.join(ws, "src", TASKS.find((task) => task.id === taskId).file);
  fs.writeFileSync(file, implSource);
  const res = spawnSync(process.execPath, [CHECK, taskId, "--dir", oracleDir], { cwd: ws, encoding: "utf8", timeout: 120000 });
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const args = parseArgs(process.argv.slice(2));
const secret = secretFrom(args.secret);
const name = args.name ?? `round-${crypto.createHash("sha256").update(secret).digest("hex").slice(0, 6)}`;
const out = path.resolve(args.out ?? path.join(ROOT, "eval/g6/local", name));
const oracleDir = path.join(out, "oracle");
const work = { ws: fs.mkdtempSync(path.join(os.tmpdir(), "g6-make-")) };

fs.mkdirSync(oracleDir, { recursive: true });
fs.mkdirSync(path.join(out, "ref"), { recursive: true });
fs.mkdirSync(path.join(out, "naive"), { recursive: true });

const key = { name, createdAt: new Date().toISOString(), tasks: [] };
const tasks = [];
const rows = [];
let ok = true;

for (const task of TASKS) {
  // Draw, then prove the draw is discriminative — re-draw if a guess already
  // agrees with it. Without this, a round can contain a task where both arms
  // score the same for the most boring reason possible: the convention happened
  // to be the obvious one.
  let chosen = null;
  let broken = null;
  for (let attempt = 0; attempt < 24 && chosen === null; attempt += 1) {
    const pick = draw(secret, name, task.id, attempt);
    const params = task.params(pick);
    const refSource = task.ref(params);
    const oracleSource = buildOracle(task, params);
    fs.writeFileSync(path.join(oracleDir, `${task.id}.test.mjs`), oracleSource);
    // Written before grading so a failing draw can be inspected afterwards.
    fs.writeFileSync(path.join(out, "ref", task.file), refSource);
    fs.writeFileSync(path.join(out, "naive", task.file), task.naive);
    const ref = grade(task.id, refSource, oracleDir, work);
    if (ref.status !== 0) {
      // Not a corpus problem but a generator one: the reference and the oracle
      // are supposed to be one statement written twice. Stop, loudly — retrying
      // would hide the disagreement behind a draw that happens to work.
      const detail = ref.out.split("\n").find((line) => /not ok|AssertionError|SyntaxError/.test(line)) ?? "see log";
      broken = `${task.id}: reference implementation does not satisfy its own oracle: ${detail.trim()}`;
      break;
    }
    const naive = grade(task.id, task.naive, oracleDir, work);
    if (naive.status === 0) continue; // the guess already passes: this draw measures nothing
    chosen = { params, refSource, oracleSource, attempt };
  }
  if (broken !== null) {
    rows.push(broken);
    ok = false;
    continue;
  }
  if (chosen === null) {
    rows.push(`${task.id}: every draw was already answered by the natural guess — widen the menu`);
    ok = false;
    continue;
  }
  fs.writeFileSync(path.join(out, "ref", task.file), chosen.refSource);
  fs.writeFileSync(path.join(out, "naive", task.file), task.naive);
  const describe = task.describe(chosen.params);
  // First smoke of the first keyed round caught this: the oracle required a
  // TypeError the memory never mentioned, so the TREATMENT arm failed a task it
  // had the knowledge for. Every rejection the oracle asserts has to be stated.
  if ((task.throws ?? []).length > 0 && !describe.includes("TypeError")) {
    rows.push(`${task.id}: oracle asserts a rejection the memory never states (add it to describe())`);
    ok = false;
    continue;
  }
  key.tasks.push({ id: task.id, attempt: chosen.attempt, params: chosen.params, describe });
  tasks.push({
    id: task.id,
    prompt: task.prompt,
    check: `node \${REPO}/eval/g6/check.mjs ${task.id} --dir ${path.relative(path.join(ROOT, "eval/g6"), oracleDir).split(path.sep).join("/")}`,
    timeoutMs: 900000,
  });
  rows.push(`${task.id}: ok (draw #${chosen.attempt + 1}, guess fails)`);
}

fs.writeFileSync(path.join(out, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
fs.writeFileSync(path.join(out, "seed-memory.json"), `${JSON.stringify(memoriesFor(key), null, 2)}\n`);
fs.writeFileSync(path.join(out, "tasks.json"), `${JSON.stringify({ tasks }, null, 2)}\n`);
fs.rmSync(work.ws, { recursive: true, force: true });

for (const row of rows) console.log(row);
console.log(`\n${name} → ${out}`);
console.log(`${tasks.length}/${TASKS.length} tasks usable · key.json is the answer key: keep it out of git`);
process.exit(ok && tasks.length === TASKS.length ? 0 : 1);

/**
 * `[[args, expected]]` pairs become assertions; `throws` become rejection cases.
 * Every expected value is computed here, from the drawn convention, with the same
 * formula the memory text describes — the two statements are generated from one
 * parameter set, so they cannot drift apart.
 */
function buildOracle(task, params) {
  const cases = task.oracle(params);
  const throws = task.throws ?? [];
  const lines = [
    `import { test } from "node:test";`,
    `import assert from "node:assert/strict";`,
    `import * as mod from "../src/${task.file}";`,
    ``,
  ];
  for (const [fn, args, expected] of cases) {
    const call = `mod.${fn}(...${JSON.stringify(args)})`;
    lines.push(`test(${JSON.stringify(`${task.id}: ${fn}(${JSON.stringify(args)})`)}, () => {`);
    if (task.fields) {
      // A field list means the function returns an Error (or similar): a plain
      // deepEqual would compare prototypes and fail on a correct answer.
      lines.push(`  const got = ${call};`);
      for (const field of task.fields) {
        lines.push(`  assert.deepEqual(got.${field}, ${JSON.stringify(expected[field])});`);
      }
    } else {
      lines.push(`  assert.deepEqual(${call}, ${JSON.stringify(expected)});`);
    }
    lines.push(`});`, ``);
  }
  for (const [fn, args, errorName] of throws) {
    lines.push(
      `test(${JSON.stringify(`${task.id}: ${fn} rejects ${JSON.stringify(args)}`)}, () => {`,
      `  assert.throws(() => mod.${fn}(...${JSON.stringify(args)}), ${errorName});`,
      `});`,
      ``,
    );
  }
  return lines.join("\n");
}
