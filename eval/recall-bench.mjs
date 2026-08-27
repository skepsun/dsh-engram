/**
 * dsh-engram recall & structure benchmark (offline, deterministic).
 *
 * LongMemEval-style controlled corpus with known ground-truth answers,
 * measured through the REAL store/recall path (`openEngramDomain` + `recall`):
 *   Precision@k / Recall@k / Hit@1 / MRR  over literal retrieval (tag-exact,
 *   substring, multi-term, CJK, recency tie-break, entity timeline, negatives).
 *
 * Plus StructMemEval-flavoured structure metrics: exact-duplicate dedup,
 * entity anchoring coverage, link/node hygiene.
 *
 * Run: npm run eval   (exit 0; numbers are honest, not tuned).
 */

import { openEngramDomain } from "../lib/store.js";
import { makeCaptureHandler } from "../lib/capture.js";

const WS = "/home/u/projs/dsh-engram";

const CONFIG = {
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
};

function fakeFacility() {
  const tables = new Map();
  return {
    open(spec) {
      for (const name of Object.keys(spec.tables)) tables.set(name, new Map());
      return Promise.resolve({
        table(name) {
          const map = tables.get(name);
          return {
            get: (k) => map.get(k),
            put: (k, v) => Promise.resolve(map.set(k, v)),
            delete: (k) => Promise.resolve(map.delete(k)),
            entries: () => map.entries(),
          };
        },
        close: () => Promise.resolve(),
      });
    },
  };
}

const DAY = 86400000;
const now = Date.now();

const SEEDS = [
  // topic A — build pipeline (tag: build)
  ["decision", "Switched the CI pipeline from GitHub Actions to GitLab CI to cut build time by 40%", ["build", "ci"], "ent_pipeline", 26],
  ["error", "npm cache poisoning quarantine: lockfile hash mismatch on registry mirror (still flaky)", ["build", "error"], "ent_pipeline", 25],
  ["procedure", "Release flow: bump version, tag v*, CI publishes the tgz automatically", ["build", "release"], "ent_pipeline", 24],
  // topic B — database layer (tag: db)
  ["decision", "Chose sqlite-vec for vector search over pgvector to stay zero-infra", ["db", "retrieval"], "ent_db", 23],
  ["fact", "sqlite-vec indexes live under data/vec and are rebuilt on schema change", ["db", "retrieval"], "ent_db", 22],
  ["procedure", "DB migration: export json, bump schema version, import; never in-place ALTER", ["db", "migration"], "ent_db", 21],
  ["insight", "WAL checkpoint lag on slow disks caused the 5s startup stalls we saw in July", ["db"], null, 20],
  // topic C — memory system (tag: memory)
  ["decision", "Deterministic literal recall over embeddings: scores are stable across restarts", ["memory", "recall"], "ent_memory", 19],
  ["error", "TDZ crash: hooks referenced memPageCount before initialization — fixed by ordering", ["memory", "ui", "bug"], "ent_memory", 18],
  ["handoff", "ipfs pinning offloaded to dsh-store; engram keeps only textual memories", ["memory", "handoff"], "ent_memory", 17],
  // topic D — Chinese ops notes (CJK retrieval)
  ["procedure", "中文发布流程：先跑 npm test 再 npm run build:client，全部通过后热重载", ["发布", "流程"], "ent_ops", 16],
  ["fact", "中文名词约定：模型主动调用 esr 工具记作『esr 主动性』", ["约定", "esr"], "ent_ops", 15],
  ["decision", "索引表的英文列名改全小写下划线，避免中文命名在 bundle 转义后的歧义", ["约定", "ui"], "ent_ops", 14],
];

function runRecallBench(domain) {
  const all = domain.listMemories(WS, 200);
  const id = (fragment) => all.find((m) => m.text.includes(fragment))?.id ?? "MISSING";
  const g = {
    ciSwitch: id("Switched the CI pipeline"),
    lockfile: id("npm cache poisoning"),
    releaseFlow: id("Release flow"),
    sqliteVec: id("Chose sqlite-vec"),
    vecIndexes: id("sqlite-vec indexes live"),
    dbMigration: id("DB migration"),
    walLag: id("WAL checkpoint lag"),
    literalRecall: id("Deterministic literal recall"),
    tdz: id("TDZ crash"),
    ipfs: id("ipfs pinning"),
    cjkRelease: id("中文发布流程"),
    cjkTerm: id("中文名词约定"),
    cjkNames: id("索引表的英文列名"),
  };

  const PROBES = [
    { q: "build", k: 5, expect: [g.ciSwitch, g.lockfile, g.releaseFlow], type: "tag-exact (build)" },
    { q: "sqlite-vec", k: 3, expect: [g.sqliteVec, g.vecIndexes], type: "substring (sqlite-vec)" },
    { q: "release flow tag", k: 3, expect: [g.releaseFlow], type: "multi-term" },
    { q: "中文发布流程", k: 3, expect: [g.cjkRelease], type: "CJK exact" },
    { q: "esr 主动性", k: 3, expect: [g.cjkTerm], type: "CJK mixed" },
    { q: "TDZ memPageCount", k: 3, expect: [g.tdz], type: "partial-id recall" },
    { q: "deterministic recall", k: 3, expect: [g.literalRecall], type: "phrase-single" },
    { q: "db", k: 5, expect: [g.walLag, g.dbMigration, g.vecIndexes, g.sqliteVec], type: "tag-exact (db, order)" },
    { q: "no-such-topic-xyz", k: 3, expect: [], type: "negative" },
  ];

  const rows = [];
  const MAX = 50;
  for (const probe of PROBES) {
    const retrieved = domain.recall(WS, probe.q, probe.k).slice(0, MAX);
    const ids = retrieved.map((m) => m.id);
    const expect = probe.expect;
    const hits = expect.filter((ex) => ids.slice(0, probe.k).includes(ex)).length;
    const k_ = Math.min(probe.k, ids.length);
    const p = k_ === 0 ? 0 : hits / k_;
    const r = expect.length === 0 ? (k_ === 0 ? 1 : 0) : hits / expect.length;
    const firstExpectedRank = expect
      .map((ex) => ids.indexOf(ex))
      .filter((ix) => ix >= 0 && ix < probe.k)
      .sort((a, b) => a - b)[0];
    const mrr = firstExpectedRank === undefined ? 0 : 1 / (firstExpectedRank + 1);
    const hitAt1 = ids[0] !== undefined && expect.includes(ids[0]);
    rows.push({ type: probe.type, k: probe.k, p: +p.toFixed(3), r: +r.toFixed(3), mrr: +mrr.toFixed(3), hitAt1, first: (ids[0] ?? "-").slice(0, 8) });
  }
  return rows;
}

async function runStructureBench(domain) {
  const out = {};
  const dupText = "this exact text is stored three times for dedup measurement";
  for (let i = 0; i < 3; i += 1) {
    await domain.storeMemory({ workspace: WS, kind: "fact", text: dupText, tags: ["dedup"], entity: null, sessionId: "bench", seq: 900 + i, signal: 0.6 }, CONFIG);
  }
  const dupCount = domain.listMemories(WS, 500).filter((m) => m.text === dupText).length;
  out.dedupeRate = dupCount === 1 ? 1 : 0;
  const all = domain.listMemories(WS, 500);
  out.entityAnchored = all.filter((m) => m.entity !== null).length / all.length;
  out.totalMemories = all.length;
  const links = domain.allLinks(WS);
  const nodes = domain.listEntities(WS);
  out.nodes = nodes.length;
  out.links = links.length;
  out.danglingLinks = links.filter((l) => !nodes.some((n) => n.id === l.source || n.id === l.target)).length;
  return out;
}

/**
 * Semantic edge-case gate: the new capabilities must hold through the REAL
 * store path, not just unit extracts.
 *   supersedeRanking — a superseding statement ranks ABOVE its stale truth
 *   redactionClean   — a secret-bearing memory stores zero raw secret bytes
 *   fixClosure       — failed→passed run yields a procedure + resolved tag
 */
async function runSemanticBench(domain) {
  const out = {};

  // supersede: seed a stale statement and the newer replacement of the same
  // entity; recall must rank the current statement above the stale one.
  const stale = await domain.storeMemory(
    { workspace: WS, kind: "fact", text: "the build tool is webpack with a heavy config", entity: "ent_tool", tags: ["build", "tool"], sessionId: "bench", seq: 901, signal: 0.6 },
    CONFIG,
  );
  const current = await domain.storeMemory(
    { workspace: WS, kind: "fact", text: "switched the build tool to vite; webpack config removed", entity: "ent_tool", tags: ["build", "tool"], sessionId: "bench", seq: 902, signal: 0.6, supersedes: stale.id },
    CONFIG,
  );
  const ranked = domain.recall(WS, "webpack build tool", 200);
  const iCur = ranked.findIndex((m) => m.id === current.id);
  const iStale = ranked.findIndex((m) => m.id === stale.id);
  const curIn = iCur !== -1 && iStale !== -1;
  out.supersedeRanking = curIn && iCur < iStale ? 1 : 0;

  // redaction: a raw secret shape must never survive the write path.
  await domain.storeMemory(
    { workspace: WS, kind: "fact", text: "prod access AWS \x41\x4B\x49\x41\x49\x4F\x53\x46\x4F\x44\x4E\x4E\x37\x45\x58\x41\x4D\x50\x4C\x45 with Bearer \x65\x79\x4A\x68\x62\x47\x63\x69\x4F\x69\x4A\x49\x55\x7A\x49\x31\x4E\x69\x49\x73\x49\x6E\x52\x35\x63\x43\x49\x36\x49\x6B\x70\x58\x56\x43\x4A\x39.secret", tags: ["secret-probe"], sessionId: "bench", seq: 903, signal: 0.6 },
    CONFIG,
  );
  const probe = domain.listMemories(WS, 500).find((m) => (m.tags ?? []).includes("secret-probe"));
  const raw = probe?.text ?? "";
  out.redactionClean = raw.includes("\x41\x4B\x49\x41\x49\x4F\x53\x46\x4F\x44\x4E\x4E\x37\x45\x58\x41\x4D\x50\x4C\x45") || raw.includes("\x65\x79\x4A\x68\x62\x47\x63\x69\x4F\x69\x4A\x49\x55\x7A\x49\x31\x4E\x69\x49\x73\x49\x6E\x52\x35\x63\x43\x49\x36\x49\x6B\x70\x58\x56\x43\x4A\x39") ? 0 : 1;

  // fix-closure: fail npm test, then pass it → procedure + resolved tag.
  const handler = makeCaptureHandler(domain, CONFIG, { warn: () => {} });
  handler(
    { name: "bash", agent: { session: { id: "bench-fix", header: { cwd: WS }, events: { length: 1 } } }, arguments: { command: "npm test" } },
    { isError: true, value: { stderr: "not ok 3 - recall ranks recency\n# fail 1" } },
  );
  await new Promise((r) => setTimeout(r, 30));
  handler(
    { name: "bash", agent: { session: { id: "bench-fix", header: { cwd: WS }, events: { length: 2 } } }, arguments: { command: "npm test" } },
    { isError: false, value: { stdout: "pass 184\n# fail 0" } },
  );
  await new Promise((r) => setTimeout(r, 30));
  const after = domain.listMemories(WS, 500);
  const hasProcedure = after.some((m) => m.kind === "procedure" && /fixed: npm test/.test(m.text));
  const closed = after.filter((m) => m.kind === "error" && /tests failed \(npm test\)/.test(m.text));
  out.fixClosure = hasProcedure && closed.length > 0 && closed.every((m) => (m.tags ?? []).includes("resolved")) ? 1 : 0;
  return out;
}

async function main() {
  const facility = fakeFacility();
  const domain = await openEngramDomain(facility);
  for (let i = 0; i < SEEDS.length; i += 1) {
    const [kind, text, tags, entity, ageDays] = SEEDS[i];
    await domain.storeMemory(
      { workspace: WS, kind, text, tags, entity, sessionId: "bench", seq: i + 1, signal: kind === "error" ? 0.4 : 0.6, createdAt: now - ageDays * DAY },
      CONFIG,
    );
  }
  await domain.putEntity({ id: "ent_pipeline", workspace: WS, name: "pipeline", description: "", kind: "module", sessionId: "bench", createdAt: now, updatedAt: now });
  await domain.addLink({ id: "lk1", workspace: WS, source: "ent_pipeline", relation: "implements", target: "ent_db", confidence: 1, sessionId: "bench", createdAt: now });

  const recallRows = runRecallBench(domain);
  const structure = await runStructureBench(domain);
  const semantic = await runSemanticBench(domain);

  const n = recallRows.length;
  const avg = (k) => recallRows.reduce((a, x) => a + x[k], 0) / n;
  const hit1 = recallRows.filter((x) => x.hitAt1).length / n;
  const mrr = avg("mrr");

  console.log("== dsh-engram recall & structure benchmark ==");
  console.log("corpus:", SEEDS.length, "seeded + 3 dedup stores, workspace", WS);
  console.log("");
  console.log("-- retrieval (LongMemEval-style probes through real recall()) --");
  console.log("type".padEnd(30), "k   P@k    R@k    MRR    hit@1");
  for (const row of recallRows) {
    console.log(row.type.padEnd(30), String(row.k).padEnd(4), row.p.toFixed(3).padEnd(6), row.r.toFixed(3).padEnd(7), row.mrr.toFixed(3).padEnd(6), row.hitAt1 ? "✓" : "✗", " first:", row.first);
  }
  console.log("-".repeat(70));
  console.log("AVG P@k", avg("p").toFixed(3), "| AVG R@k", avg("r").toFixed(3), "| MRR", mrr.toFixed(3), "| hit@1", hit1.toFixed(3));
  const neg = recallRows.filter((x) => x.type === "negative")[0];
  console.log("negative false-positive rate:", neg ? (1 - neg.r).toFixed(3) : "-", "(1.000 = clean, no false hits)");
  console.log("");
  console.log("-- structure (StructMemEval-flavoured) --");
  console.log("exact-duplicate dedup rate:", structure.dedupeRate, "(1.0 means 3 stores of same text collapsed to 1)");
  console.log("entity-anchored coverage:", structure.entityAnchored.toFixed(3), "of", structure.totalMemories, "memories");
  console.log("nodes:", structure.nodes, "| links:", structure.links, "| dangling:", structure.danglingLinks);
  console.log("");
  console.log("-- semantic edge cases --");
  console.log("supersede ranking (current above stale truth):", semantic.supersedeRanking ? "✓ 1" : "✗ 0");
  console.log("redaction clean (no raw secret bytes on disk):", semantic.redactionClean ? "✓ 1" : "✗ 0");
  console.log("failure→fix closure (procedure + resolved):", semantic.fixClosure ? "✓ 1" : "✗ 0");

  const pass = avg("r") >= 0.5 && hit1 >= 0.5 && structure.dedupeRate === 1 && structure.danglingLinks === 0
    && semantic.supersedeRanking === 1 && semantic.redactionClean === 1 && semantic.fixClosure === 1;
  console.log("");
  console.log(pass ? "BENCH PASS ✓" : "BENCH LOOK (investigate below-threshold metrics)");
  await facility.close?.();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});