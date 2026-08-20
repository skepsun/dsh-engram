/**
 * dsh-engram: storage layer over DSH's own `ctx.storageDomain`.
 *
 * One domain `dsh_engram` (JSON unit `~/.dsh/storages/dsh_engram.json`) with three
 * tables:
 *   - `memories` — the memory pool (kinds: decision/error/procedure/fact/
 *     insight/handoff/task), with provenance, signal strength, hit counts,
 *     optional entity anchor, and soft-expiry.
 *   - `tasks`    — ESR-lite entities with a draft→active→stable lifecycle and
 *     an evidence set (artifact / evaluation / memoryRefs) required for stable.
 *   - `links`    — typed entity relations (mini graph, ESR relation flavor).
 *   - `entities` — named graph nodes (esr_node): stable symbols for the things
 *     a workspace keeps referring to; links and memory entity-anchors point at
 *     these ids.
 *
 * No external server, no self-built SQLite, no model calls.
 */

import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { hashText, byRecency, uuid, now, tokenize as tokenizeLocal, scoreRecord as scoreRecordLocal, truncate as truncateText } from "./util.js";

export const DOMAIN_VERSION = 1;

/** Memory kinds, mapping to index prefixes. */
const MEMORY_KINDS = [
  "decision",
  "error",
  "procedure",
  "fact",
  "insight",
  "handoff",
  "task",
];

const MemorySchema = z.object({
  /** Stable id (table key). */
  id: z.string().min(1),
  /** Normalized workspace key (exact-cwd authorization). */
  workspace: z.string().min(1),
  kind: z.enum(MEMORY_KINDS),
  /** Compact, information-dense text. */
  text: z.string().min(1),
  /** Free-form routing tags. */
  tags: z.array(z.string()).default([]),
  /** Optional opaque entity anchor (shared with pi-esr convention). */
  entity: z.string().nullable().default(null),
  /** Provenance: the session that (last) wrote it and the log seq observed. */
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** Recall hit count — used to promote low-signal auto-captures into the index. */
  hits: z.number().int().nonnegative().default(0),
  /** 0..1 static signal; index threshold is minIndexSignal. */
  signal: z.number().min(0).max(1).default(0.5),
  status: z.enum(["active", "archived"]).default("active"),
  /** Absolute TTL expiry (epoch ms), null = no expiry. */
  expiresAt: z.number().int().nullable().default(null),
});

const TaskSchema = z.object({
  id: z.string().min(1),
  workspace: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  state: z.enum(["draft", "active", "stable"]).default("draft"),
  /** ESR closure evidence — stable requires all three gates. */
  artifact: z.string().nullable().default(null),
  evaluation: z.string().nullable().default(null),
  /** memory_ref ids recorded at closure time. */
  memoryRefs: z.array(z.string()).default([]),
  sessionId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** When the state last transitioned (maintained by the tools layer). */
  stateChangedAt: z.number().int().nonnegative().default(0),
  /** Set by GC when a stable task passed its retention window. Archived tasks
   *  leave the [ESR] surface but stay retrievable (id + name kept). */
  archivedAt: z.number().int().nullable().default(null),
});

const LinkSchema = z.object({
  id: z.string().min(1),
  workspace: z.string().min(1),
  /** Opaque entity ids (pi-esr style). */
  source: z.string().min(1),
  relation: z.string().min(1),
  target: z.string().min(1),
  confidence: z.number().min(0).max(1).default(1),
  sessionId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});

const EntitySchema = z.object({
  /** Stable node id (table key); esr_node derives it from the name by default. */
  id: z.string().min(1),
  workspace: z.string().min(1),
  /** Display label (the thing's name). */
  name: z.string().min(1),
  /** Free-form description, e.g. what the node is / why it matters. */
  description: z.string().default(""),
  /** Free-form kind tag: package / service / doc / repo / person / bug ... */
  kind: z.string().default(""),
  sessionId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

/**
 * Per (workspace, day) rollup of agent behaviour: which engram_ and esr_
 * tools the model actually called, failures, and recall mechanics (queries
 * with hits, total hits returned, recall->detail drill-throughs). Feeds
 * the real-data observability panel (`/api/dsh-engram/stats`).
 */
const UsageSchema = z.object({
  id: z.string().min(1), // `${workspace}::${day}`
  workspace: z.string().min(1),
  day: z.string().min(1), // YYYY-MM-DD (local)
  counts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  failures: z.number().int().nonnegative().default(0),
  recall: z.record(z.string(), z.number().int().nonnegative()).default({}),
  updatedAt: z.number().int().nonnegative(),
});

const GlobalSchema = z.object({
  initialized: z.boolean(),
});

/** Identity validation (mirrors shipped defineDomain; fails loud at load). */
export const engramDomainSpec = defineDomain({
  name: "dsh_engram",
  version: DOMAIN_VERSION,
  global: { schema: GlobalSchema, initial: { initialized: true } },
  tables: {
    memories: domainTable(MemorySchema),
    tasks: domainTable(TaskSchema),
    links: domainTable(LinkSchema),
    entities: domainTable(EntitySchema),
    usage: domainTable(UsageSchema),
  },
});

export class EngramError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "EngramError";
  }
}

/** True when `error` carries a harness-style machine code equal to `code`. */
export function hasCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Open the engram domain over a storage-domain facility. Returns a typed handle
 * with synchronous reads and async writes (both are durable on the backend).
 */
export async function openEngramDomain(facility) {
  const opened = await facility.open(engramDomainSpec);
  const memories = opened.table("memories");
  const tasks = opened.table("tasks");
  const links = opened.table("links");
  const entities = opened.table("entities");
  const usage = opened.table("usage");

  const allMemories = (workspace) =>
    [...memories.entries()]
      .map(([, m]) => m)
      .filter((m) => m.workspace === workspace && m.status === "active");

  const allEntities = (workspace) =>
    [...entities.entries()]
      .map(([, e]) => e)
      .filter((e) => e.workspace === workspace);

  const activeTasks = (workspace) =>
    [...tasks.entries()]
      .map(([, t]) => t)
      .filter((t) => t.workspace === workspace && t.state !== "stable" && (t.archivedAt === null || t.archivedAt === void 0));

  const notArchivedTask = (t) => t.archivedAt === null || t.archivedAt === void 0;

  /** Skip (but do not mutate during sync reads) memories past their TTL. */
  const notExpiredNow = (m) => m.expiresAt === null || m.expiresAt > now();

  return {
    workspaceEntries(workspace) {
      return {
        memories: allMemories(workspace).length,
        tasks: activeTasks(workspace).length,
        links: [...links.entries()].filter(([, l]) => l.workspace === workspace).length,
        nodes: allEntities(workspace).length,
      };
    },
    // ── memories ──────────────────────────────────────────────────────
    getMemory(workspace, id) {
      const m = memories.get(id);
      if (m === void 0 || m.workspace !== workspace || m.status !== "active" || !notExpiredNow(m)) return void 0;
      return m;
    },
    listMemories(workspace, limit = 50) {
      return allMemories(workspace)
        .filter(notExpiredNow)
        .sort(byRecency)
        .slice(0, Math.max(1, Math.min(200, limit)));
    },
    /**
     * GUI-oriented memory search spanning one workspace or (when `workspace`
     * is falsy) every workspace. Optional kind/status filters; `q` reuses the
     * deterministic recall scorer.
     */
    searchMemories({ workspace, q, kind, status, limit = 100 } = {}) {
      const bounded = Math.max(1, Math.min(500, Math.trunc(limit) || 100));
      let pool = [...memories.entries()].map(([, m]) => m);
      if (workspace) pool = pool.filter((m) => m.workspace === workspace);
      // Explicitly browsing archived entries must see TTL-expired ones too
      // (GC archives expired memories; the archive view is their pointer).
      if (status !== "archived") pool = pool.filter(notExpiredNow);
      if (kind) pool = pool.filter((m) => m.kind === kind);
      if (status) pool = pool.filter((m) => m.status === status);
      if (q !== void 0 && String(q).trim().length > 0) {
        const trimmed = String(q).trim();
        const tokens = tokenizeLocal(trimmed);
        const phraseBoost = /\s/.test(trimmed);
        const folded = trimmed.toLowerCase();
        return pool
          .map((m) => ({ m, score: scoreRecordLocal(m, tokens, folded, phraseBoost) }))
          .filter((e) => e.score > 0)
          .sort((a, b) => b.score - a.score || byRecency(a.m, b.m))
          .slice(0, bounded)
          .map((e) => e.m);
      }
      return pool.sort(byRecency).slice(0, bounded);
    },
    /** Cross-workspace counts and kind histogram for the GUI overview. */
    summarize() {
      const workspaces = {};
      const kinds = {};
      let memoryCount = 0;
      let taskCount = 0;
      let linkCount = 0;
      let nodeCount = 0;
      const zeroCounts = () => ({ memories: 0, tasks: 0, links: 0, nodes: 0 });
      for (const [, m] of memories.entries()) {
        const ws = m.workspace;
        workspaces[ws] ??= zeroCounts();
        if (m.status === "active") {
          workspaces[ws].memories += 1;
          memoryCount += 1;
          kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
        }
      }
      for (const [, t] of tasks.entries()) {
        workspaces[t.workspace] ??= zeroCounts();
        if (t.state !== "stable" && notArchivedTask(t)) {
          workspaces[t.workspace].tasks += 1;
          taskCount += 1;
        }
      }
      for (const [, l] of links.entries()) {
        workspaces[l.workspace] ??= zeroCounts();
        workspaces[l.workspace].links += 1;
        linkCount += 1;
      }
      for (const [, e] of entities.entries()) {
        workspaces[e.workspace] ??= zeroCounts();
        workspaces[e.workspace].nodes += 1;
        nodeCount += 1;
      }
      return { workspaces, kinds, totals: { memories: memoryCount, tasks: taskCount, links: linkCount, nodes: nodeCount } };
    },
    /** Hard delete (GUI only; provenance stays in the session log). */
    async deleteMemory(workspace, id) {
      const m = memories.get(id);
      if (m === void 0 || m.workspace !== workspace) return false;
      await memories.delete(id);
      return true;
    },
    /**
     * Store one memory. Exact-duplicate text in the same workspace refreshes
     * `updatedAt` (and returns the existing id) instead of piling up.
     */
    async storeMemory(entry, config) {
      const text = String(entry.text).trim();
      if (text.length === 0) throw new EngramError("ENGRAM_INVALID_ARGS", "memory text must not be empty");
      if ([...text].length > config.maxMemoryChars) {
        throw new EngramError("ENGRAM_CAP_EXCEEDED", `memory text is ${[...text].length} characters, over the cap of ${config.maxMemoryChars}`);
      }
      const dup = allMemories(entry.workspace).find((m) => hashText(m.text) === hashText(text) && m.kind === (entry.kind ?? "fact"));
      if (dup !== void 0) {
        const next = { ...dup, updatedAt: now() };
        await memories.put(dup.id, next);
        return { stored: next, duplicated: true, id: dup.id };
      }
      if (allMemories(entry.workspace).length >= config.maxMemoriesPerWorkspace) {
        throw new EngramError("ENGRAM_CAP_EXCEEDED", `workspace already holds ${config.maxMemoriesPerWorkspace} active memories (the cap)`);
      }
      const expiresAt =
        entry.expiresAt !== void 0 && entry.expiresAt !== null
          ? entry.expiresAt
          : config.expireDays > 0
            ? now() + config.expireDays * 24 * 60 * 60 * 1000
            : null;
      const stored = {
        id: uuid(),
        workspace: entry.workspace,
        kind: entry.kind ?? "fact",
        text,
        tags: entry.tags ?? [],
        entity: entry.entity ?? null,
        sessionId: entry.sessionId,
        seq: entry.seq ?? 0,
        createdAt: now(),
        updatedAt: now(),
        hits: 0,
        signal: typeof entry.signal === "number" ? Math.max(0, Math.min(1, entry.signal)) : 0.5,
        status: "active",
        expiresAt,
      };
      await memories.put(stored.id, stored);
      return { stored, duplicated: false, id: stored.id };
    },
    async touchMemory(workspace, id) {
      const m = memories.get(id);
      if (m === void 0 || m.workspace !== workspace || !notExpiredNow(m)) return void 0;
      const next = { ...m, hits: (m.hits ?? 0) + 1, updatedAt: m.updatedAt };
      await memories.put(id, next);
      return next;
    },
    /** Deterministic recall: tag-exact > text-substring > fuzzy, recency ties. */
    recall(workspace, query, limit = 20) {
      const active = allMemories(workspace).filter(notExpiredNow);
      const bounded = Math.max(1, Math.min(50, Math.trunc(limit) || 20));
      if (query !== void 0 && String(query).trim().length > 0) {
        const trimmed = String(query).trim();
        const tokens = tokenizeLocal(trimmed);
        const phraseBoost = /\s/.test(trimmed);
        const folded = trimmed.toLowerCase();
        return active
          .map((m) => ({ m, score: scoreRecordLocal(m, tokens, folded, phraseBoost) }))
          .filter((e) => e.score > 0)
          .sort((a, b) => b.score - a.score || byRecency(a.m, b.m))
          .slice(0, bounded)
          .map((e) => e.m);
      }
      return active.sort(byRecency).slice(0, bounded);
    },
    timeline(workspace, entity, limit = 30) {
      const active = allMemories(workspace).filter(notExpiredNow);
      const bounded = Math.max(1, Math.min(100, Math.trunc(limit) || 30));
      if (entity === void 0 || String(entity).trim().length === 0) {
        return active.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)).slice(0, bounded);
      }
      const key = String(entity).trim();
      return active
        .filter((m) => m.entity !== null && (m.entity === key || String(m.entity).includes(key) || key.includes(String(m.entity))))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .slice(0, bounded);
    },
    async archiveMemory(workspace, id) {
      const m = memories.get(id);
      if (m === void 0 || m.workspace !== workspace || m.status === "archived") return false;
      await memories.put(id, { ...m, status: "archived", updatedAt: now() });
      return true;
    },
    /** Lazy TTL sweep (write path only; async). Returns archived count. */
    async expireSweep(workspace) {
      let n = 0;
      for (const [, m] of memories.entries()) {
        if (m.workspace === workspace && m.status === "active" && m.expiresAt !== null && m.expiresAt <= now()) {
          await memories.put(m.id, { ...m, status: "archived", updatedAt: now() });
          n += 1;
        }
      }
      return n;
    },
    // ── tasks ─────────────────────────────────────────────────────────
    getTask(workspace, id) {
      const t = tasks.get(id);
      return t === void 0 || t.workspace !== workspace ? void 0 : t;
    },
    listTasks(workspace, { includeStable = false } = {}) {
      return [...tasks.entries()]
        .map(([, t]) => t)
        .filter((t) => t.workspace === workspace && notArchivedTask(t) && (includeStable || t.state !== "stable"))
        .sort(byRecency);
    },
    async putTask(task) {
      if ([...task.name].length > 200) throw new EngramError("ENGRAM_CAP_EXCEEDED", "task name is over 200 characters");
      if (task.id !== task.id) throw new EngramError("ENGRAM_INVALID_ARGS", "task id mismatch");
      await tasks.put(task.id, task);
      return task;
    },
    /** Cap is enforced by the tools layer (needs config); expose the count here. */
    activeTaskCount(workspace) {
      return activeTasks(workspace).length;
    },
    async archiveTask(workspace, id) {
      const t = tasks.get(id);
      if (t === void 0 || t.workspace !== workspace || t.archivedAt !== null) return false;
      await tasks.put(id, { ...t, archivedAt: now() });
      return true;
    },
    /**
     * pi-esr GC, adapted to the memory store. Mechanical, deterministic,
     * working-set-protected, archive-only (never hard-deletes — everything
     * archived stays re-fetchable, honouring pointer-salience):
     *   - TTL-expired memories beyond their `expiresAt` are archived;
     *   - over-cap workspaces evict the lowest-value non-protected memories
     *     (hits asc, signal asc, age asc) until at the cap;
     *   - stable tasks past `config.gcStableRetentionDays` become `archived`;
     *   - links whose BOTH endpoints are gone (no active memory entity, no
     *     surviving task id) are removed (dangling graph edges).
     * The working set is never touched: memories referenced by an ACTIVE task
     * (`memoryRefs`), memories with kind `task`, task-anchored entities, and
     * already-indexed hits (`hits >= promoteHits`) are all protected.
     * @param workspace - workspace key, or falsy to sweep every open workspace.
     * @param config - effective plugin config (gcStableRetentionDays, promoteHits, maxMemoriesPerWorkspace).
     * @param opts - `dryRun: true` computes the full report without writing.
     * @returns a report of what would be / was archived and why.
     */
    async gc(workspace, config, { dryRun = false } = {}) {
      const conf = config ?? {};
      const retentionMs = (conf.gcStableRetentionDays ?? 120) * 24 * 60 * 60 * 1000;
      const cap = conf.maxMemoriesPerWorkspace ?? 2000;
      const promoteHits = conf.promoteHits ?? 3;
      const t0 = now();

      const workspaces = workspace
        ? [workspace]
        : [...new Set([...memories.entries(), ...tasks.entries(), ...links.entries()].map(([, v]) => v.workspace))];

      const report = {
        dryRun,
        workspaces,
        protectedMemories: 0,
        archivedMemories: [],
        archivedTasks: [],
        removedLinks: [],
      };

      for (const ws of workspaces) {
        const allMem = [...memories.entries()].map(([, m]) => m).filter((m) => m.workspace === ws);
        const activeMem = allMem.filter((m) => m.status === "active");
        const wsTasks = [...tasks.entries()].map(([, t]) => t).filter((t) => t.workspace === ws);
        const wsLinks = [...links.entries()].map(([, l]) => l).filter((l) => l.workspace === ws);

        // ── working set (pi-esr: working-set-protected) ─────────────────
        const activeTaskIds = new Set(wsTasks.filter((t) => t.state === "active" && notArchivedTask(t)).map((t) => t.id));
        const activeRefs = new Set(wsTasks.filter((t) => t.state === "active" && notArchivedTask(t)).flatMap((t) => t.memoryRefs ?? []));
        const isProtected = (m) =>
          m.kind === "task" ||
          (m.hits ?? 0) >= promoteHits ||
          activeRefs.has(m.id) ||
          (m.entity !== null && activeTaskIds.has(m.entity));

        // ── stale / over-cap memory archiving ───────────────────────────
        const expired = [];
        const candidates = [];
        for (const m of activeMem) {
          if (isProtected(m)) {
            report.protectedMemories += 1;
            continue;
          }
          if (m.expiresAt !== null && m.expiresAt <= t0) expired.push(m);
          else candidates.push(m);
        }
        for (const m of expired) {
          if (!dryRun) await memories.put(m.id, { ...m, status: "archived", updatedAt: t0 });
          report.archivedMemories.push({ id: m.id, kind: m.kind, text: truncateText(m.text, 60), reason: "expired", workspace: ws });
        }
        const survivable = activeMem.length - report.archivedMemories.filter((e) => e.workspace === ws).length;
        if (survivable > cap) {
          const over = survivable - cap;
          const evict = candidates
            .slice()
            .sort((a, b) => (a.hits ?? 0) - (b.hits ?? 0) || (a.signal ?? 0) - (b.signal ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0))
            .slice(0, over);
          for (const m of evict) {
            if (!dryRun) await memories.put(m.id, { ...m, status: "archived", updatedAt: t0 });
            report.archivedMemories.push({ id: m.id, kind: m.kind, text: truncateText(m.text, 60), reason: "cap", workspace: ws });
          }
        }

        // ── stable-task retention (stable-task-evictable, archive-only) ─
        const retentionCutoff = t0 - retentionMs;
        for (const t of wsTasks) {
          if (t.state === "stable" && notArchivedTask(t) && t.updatedAt <= retentionCutoff) {
            if (!dryRun) await tasks.put(t.id, { ...t, archivedAt: t0 });
            report.archivedTasks.push({ id: t.id, name: truncateText(t.name, 60), reason: "stable-retention", workspace: ws });
          }
        }

        // ── dangling links (both endpoints gone) ────────────────────────
        const liveEntities = new Set();
        for (const m of activeMem) if (m.entity !== null) liveEntities.add(m.entity);
        for (const t of wsTasks) if (notArchivedTask(t)) liveEntities.add(t.id);
        for (const e of allEntities(ws)) liveEntities.add(e.id);
        for (const l of wsLinks) {
          if (!liveEntities.has(l.source) && !liveEntities.has(l.target)) {
            if (!dryRun) await links.delete(l.id);
            report.removedLinks.push({ id: l.id, source: l.source, relation: l.relation, target: l.target, reason: "dangling", workspace: ws });
          }
        }
      }

      return report;
    },
    // ── links ─────────────────────────────────────────────────────────
    addLink(link) {
      return links.put(link.id, link);
    },
    linksFor(workspace, entity) {
      return [...links.entries()]
        .map(([, l]) => l)
        .filter((l) => l.workspace === workspace && (l.source === entity || l.target === entity))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    },
    allLinks(workspace) {
      return [...links.entries()].map(([, l]) => l).filter((l) => l.workspace === workspace);
    },
    // ── entities (esr_node) ───────────────────────────────────────────
    getEntity(workspace, id) {
      const e = entities.get(id);
      if (e === void 0 || e.workspace !== workspace) return void 0;
      return e;
    },
    listEntities(workspace) {
      return allEntities(workspace).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    },
    putEntity(entity) {
      return entities.put(entity.id, entity);
    },
    async removeEntity(workspace, id) {
      const e = entities.get(id);
      if (e === void 0 || e.workspace !== workspace) return false;
      await entities.delete(id);
      return true;
    },
    // ── usage / observability ────────────────────────────────────────
    /** Merge one tool-call event into the (workspace, day) rollup row. */
    async bumpUsage(workspace, day, { counts = {}, failures = 0, recall = {} }) {
      const id = `${workspace}::${day}`;
      const cur = usage.get(id);
      const row = cur ?? { id, workspace, day, counts: {}, failures: 0, recall: {}, updatedAt: 0 };
      for (const [k, v] of Object.entries(counts)) row.counts[k] = (row.counts[k] ?? 0) + v;
      row.failures += failures;
      for (const [k, v] of Object.entries(recall)) row.recall[k] = (row.recall[k] ?? 0) + v;
      row.updatedAt = Date.now();
      await usage.put(id, row);
      return row;
    },
    /** Usage rollup rows, oldest first (all workspaces when workspace is undefined). */
    usageRows(workspace) {
      const all = [...usage.entries()].map(([, r]) => r);
      return (workspace ? all.filter((r) => r.workspace === workspace) : all).sort((a, b) => a.day.localeCompare(b.day));
    },
    close() {
      return opened.close();
    },
  };
}
