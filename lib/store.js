/**
 * dsh-loom: storage layer over DSH's own `ctx.storageDomain`.
 *
 * One domain `dsh_loom` (JSON unit `~/.dsh/storages/dsh_loom.json`) with three
 * tables:
 *   - `memories` — the memory pool (kinds: decision/error/procedure/fact/
 *     insight/handoff/task), with provenance, signal strength, hit counts,
 *     optional entity anchor, and soft-expiry.
 *   - `tasks`    — ESR-lite entities with a draft→active→stable lifecycle and
 *     an evidence set (artifact / evaluation / memoryRefs) required for stable.
 *   - `links`    — typed entity relations (mini graph, ESR relation flavor).
 *
 * No external server, no self-built SQLite, no model calls.
 */

import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { hashText, byRecency, uuid, now, tokenize as tokenizeLocal, scoreRecord as scoreRecordLocal } from "./util.js";

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

const GlobalSchema = z.object({
  initialized: z.boolean(),
});

/** Identity validation (mirrors shipped defineDomain; fails loud at load). */
export const loomDomainSpec = defineDomain({
  name: "dsh_loom",
  version: DOMAIN_VERSION,
  global: { schema: GlobalSchema, initial: { initialized: true } },
  tables: {
    memories: domainTable(MemorySchema),
    tasks: domainTable(TaskSchema),
    links: domainTable(LinkSchema),
  },
});

export class LoomError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "LoomError";
  }
}

/** True when `error` carries a harness-style machine code equal to `code`. */
export function hasCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Open the loom domain over a storage-domain facility. Returns a typed handle
 * with synchronous reads and async writes (both are durable on the backend).
 */
export async function openLoomDomain(facility) {
  const opened = await facility.open(loomDomainSpec);
  const memories = opened.table("memories");
  const tasks = opened.table("tasks");
  const links = opened.table("links");

  const allMemories = (workspace) =>
    [...memories.entries()]
      .map(([, m]) => m)
      .filter((m) => m.workspace === workspace && m.status === "active");

  const activeTasks = (workspace) =>
    [...tasks.entries()]
      .map(([, t]) => t)
      .filter((t) => t.workspace === workspace && t.state !== "stable");

  /** Skip (but do not mutate during sync reads) memories past their TTL. */
  const notExpiredNow = (m) => m.expiresAt === null || m.expiresAt > now();

  return {
    workspaceEntries(workspace) {
      return { memories: allMemories(workspace).length, tasks: activeTasks(workspace).length, links: [...links.entries()].filter(([, l]) => l.workspace === workspace).length };
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
     * Store one memory. Exact-duplicate text in the same workspace refreshes
     * `updatedAt` (and returns the existing id) instead of piling up.
     */
    async storeMemory(entry, config) {
      const text = String(entry.text).trim();
      if (text.length === 0) throw new LoomError("LOOM_INVALID_ARGS", "memory text must not be empty");
      if ([...text].length > config.maxMemoryChars) {
        throw new LoomError("LOOM_CAP_EXCEEDED", `memory text is ${[...text].length} characters, over the cap of ${config.maxMemoryChars}`);
      }
      const dup = allMemories(entry.workspace).find((m) => hashText(m.text) === hashText(text) && m.kind === (entry.kind ?? "fact"));
      if (dup !== void 0) {
        const next = { ...dup, updatedAt: now() };
        await memories.put(dup.id, next);
        return { stored: next, duplicated: true, id: dup.id };
      }
      if (allMemories(entry.workspace).length >= config.maxMemoriesPerWorkspace) {
        throw new LoomError("LOOM_CAP_EXCEEDED", `workspace already holds ${config.maxMemoriesPerWorkspace} active memories (the cap)`);
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
        .filter((t) => t.workspace === workspace && (includeStable || t.state !== "stable"))
        .sort(byRecency);
    },
    async putTask(task) {
      if ([...task.name].length > 200) throw new LoomError("LOOM_CAP_EXCEEDED", "task name is over 200 characters");
      if (task.id !== task.id) throw new LoomError("LOOM_INVALID_ARGS", "task id mismatch");
      await tasks.put(task.id, task);
      return task;
    },
    /** Cap is enforced by the tools layer (needs config); expose the count here. */
    activeTaskCount(workspace) {
      return activeTasks(workspace).length;
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
    close() {
      return opened.close();
    },
  };
}
