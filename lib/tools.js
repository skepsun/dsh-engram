/**
 * dsh-loom: model-facing tools.
 *
 * Seven small, tight-schema tools (deliberately fewer than the market's 8-12 —
 * tool schemas cost tokens in every request):
 *   loom_store / loom_recall / loom_detail   — the loom memory surface
 *   esr_task / esr_close / esr_link          — the ESR-lite evidence surface
 *   esr_gc                                   — pi-esr memory garbage collection
 *
 * All reads are deterministic local scans; `loom_recall` may additionally
 * fall back to `ctx.sessionQuery` FTS over past sessions when mounted.
 */

import { z } from "zod";
import { LoomError, hasCode } from "./store.js";
import { truncate, shortId, fmtDate, escapeLt, workspaceKey as wk, uuid } from "./util.js";

const KINDS = [
  "decision",
  "error",
  "procedure",
  "fact",
  "insight",
  "handoff",
  "task",
];

/** Standard string output projection (mirrors native tool conventions). */
const TEXT_OUTPUT = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: String(value) }],
};

const p = {
  kind: { type: "string", enum: KINDS, description: "Memory kind (default fact)" },
  tags: { type: "array", items: { type: "string" }, description: "Routing tags" },
  entity: { type: "string", description: "Opaque entity anchor (pi-esr entity_id convention)" },
};

function callerOf(exec) {
  const agent = exec?.agent;
  if (agent === void 0) throw new LoomError("LOOM_MISSING_AGENT", "loom tools require an agent-bound caller");
  const cwd = agent.session?.header?.cwd;
  if (cwd === void 0 || cwd.length === 0) throw new LoomError("LOOM_UNAUTHORIZED", "this session has no workspace cwd; loom memory is workspace-scoped");
  return { agent, cwd: wk(cwd), sessionId: agent.session.id, seq: agent.session.events?.length ?? 0 };
}

function parse(zodSchema, raw, tool) {
  const result = zodSchema.safeParse(raw);
  if (!result.success) throw new LoomError("LOOM_INVALID_ARGS", `${tool}: ${describeZodError(result.error)}`);
  return result.data;
}

function describeZodError(error) {
  try {
    return z.prettifyError(error);
  } catch {
    return String(error);
  }
}

async function requireDomain(service) {
  try {
    return await service.getDomain();
  } catch (error) {
    if (error instanceof LoomError) throw error;
    throw new LoomError("LOOM_UNAVAILABLE", `loom domain could not be opened: ${String(error)} — memory offline`, { cause: error });
  }
}

function memoryLine(m, verbosity = "short") {
  const tags = m.entity !== null ? ` · entity:${m.entity}` : "";
  if (verbosity === "full") {
    return [`# ${m.id} [${m.kind}]`, escapeLt(m.text), `tags: ${(m.tags ?? []).join(", ")}${tags}`, `signal ${m.signal} · hits ${m.hits ?? 0} · ${fmtDate(m.createdAt)} · session ${m.sessionId}#${m.seq}`, ""].join("\n");
  }
  const date = fmtDate(m.createdAt ?? m.updatedAt);
  return `- ${m.id.slice(0, 8)} [${m.kind}] ${date} ${escapeLt(truncate(m.text, 200))}${tags}${m.hits > 0 ? ` · ×${m.hits}` : ""}`;
}

export function registerTools(ctx, service) {
  return ctx.effect(() => {
    const disposers = [
      // ── loom_store ────────────────────────────────────────────────────
      ctx.tools.register({
        name: "loom_store",
        description: "Explicitly store one memory in this workspace's long-term memory. Kinds: decision/error/procedure/fact/insight/handoff/task (D/E/P/F/I/H/T prefixes in the [LOOM] index). Pass an entity to anchor it (pi-esr entity_id convention). Auto-capture already records git/file/error events — use this for anything it misses. Exact-duplicate text refreshes the existing entry instead of adding.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Compact, information-dense memory text (required)" },
            ...p,
          },
          required: ["text"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ text: z.string().min(1).max(2000), kind: z.enum(KINDS).optional(), tags: z.array(z.string()).optional(), entity: z.string().optional() }), raw, "loom_store");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          await domain.expireSweep(caller.cwd);
          const { stored, duplicated } = await domain.storeMemory(
            {
              workspace: caller.cwd,
              kind: args.kind ?? "fact",
              text: args.text,
              tags: args.tags ?? [],
              entity: args.entity ?? null,
              sessionId: caller.sessionId,
              seq: caller.seq,
              signal: 0.6,
            },
            service.config,
          );
          return `stored ${duplicated ? "(duplicate refreshed) " : ""}memory ${stored.id} [${stored.kind}] — cited to session ${stored.sessionId}#${stored.seq}`;
        },
      }),

      // ── loom_recall ───────────────────────────────────────────────────
      ctx.tools.register({
        name: "loom_recall",
        description: "Deterministic recall over this workspace's loom memories: exact tag match ranks first, case-insensitive text substring next, recency breaks ties. Literal, not semantic — query in the language the memory is likely written in. Pass query to filter, entity to restrict to an entity's memories (timeline), search_sessions:true to also full-text search PAST sessions of this workspace via the harness session index. Hit counts promote low-signal auto-captures into the [LOOM] index.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Words to match against memory text and tags" },
            entity: { type: "string", description: "Return that entity's memories chronologically" },
            limit: { type: "integer", minimum: 1, maximum: 50, description: "Max memories (default 12)" },
            search_sessions: { type: "boolean", description: "Also FTS search past sessions (requires the session-query index)" },
          },
        },
        output: TEXT_OUTPUT,
        timeoutMs: 30000,
        execute: async (raw, exec) => {
          const args = parse(z.object({ query: z.string().optional(), entity: z.string().optional(), limit: z.number().int().min(1).max(50).optional(), search_sessions: z.boolean().optional() }), raw, "loom_recall");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          let lines = [];
          if (args.entity !== void 0 && args.entity.trim().length > 0) {
            const items = domain.timeline(caller.cwd, args.entity, args.limit ?? 30);
            if (items.length === 0) return `no memories for entity "${args.entity}" in this workspace`;
            lines.push(`# timeline: ${args.entity}`);
            lines.push(...items.map((m) => memoryLine(m)));
            await Promise.all(items.map((m) => domain.touchMemory(caller.cwd, m.id).catch(() => null)));
          } else if (args.query !== void 0) {
            const items = domain.recall(caller.cwd, args.query, args.limit ?? 12);
            if (items.length === 0) return `no active memories match ${JSON.stringify(args.query)} in this workspace`;
            lines.push(`# recall: ${JSON.stringify(args.query)} (${items.length})`);
            lines.push(...items.map((m) => memoryLine(m)));
            await Promise.all(items.map((m) => domain.touchMemory(caller.cwd, m.id).catch(() => null)));
          } else {
            const items = domain.listMemories(caller.cwd, args.limit ?? 12);
            if (items.length === 0) return "no active memories in this workspace yet";
            lines.push(`# newest memories (${items.length})`);
            lines.push(...items.map((m) => memoryLine(m)));
          }
          if (args.search_sessions === true) {
            const extra = await searchSessions(service, caller, args.query ?? args.entity ?? "", exec.signal);
            if (extra.length > 0) lines.push("", "# past sessions (FTS)", ...extra);
          }
          return lines.join("\n");
        },
      }),

      // ── loom_detail ───────────────────────────────────────────────────
      ctx.tools.register({
        name: "loom_detail",
        description: "Full record of one memory id from the [LOOM] index (run loom_recall to find ids): text, tags, entity, signal, hits, provenance session#seq.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Memory id (e.g. the #xxxxx marker in the [LOOM] index is the first 8 chars)" },
          },
          required: ["id"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ id: z.string().min(1) }), raw, "loom_detail");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const id = resolveId(domain, caller.cwd, args.id);
          const m = domain.getMemory(caller.cwd, id);
          if (m === void 0) throw new LoomError("LOOM_NOT_FOUND", `no active memory "${args.id}" in this workspace`);
          await domain.touchMemory(caller.cwd, m.id).catch(() => null);
          return memoryLine(m, "full");
        },
      }),

      // ── esr_task ──────────────────────────────────────────────────────
      ctx.tools.register({
        name: "esr_task",
        description: "Create or update an engineering task entity (draft→active). ESR: a task is only 'done' when it has real evidence — close it with esr_close (artifact + evaluation + memory_ref). Set id to update an existing task.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Task name (required on create)" },
            description: { type: "string", description: "What must be produced / satisfied" },
            id: { type: "string", description: "Existing task id to update" },
          },
          required: ["name"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ name: z.string().min(1).max(200), description: z.string().optional(), id: z.string().optional() }), raw, "esr_task");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const existing = args.id === void 0 ? void 0 : domain.getTask(caller.cwd, args.id);
          if (args.id !== void 0 && existing === void 0) throw new LoomError("LOOM_NOT_FOUND", `no task "${args.id}" in this workspace`);
          if (existing === void 0 && domain.activeTaskCount(caller.cwd) >= service.config.maxTasksPerWorkspace) {
            throw new LoomError("LOOM_CAP_EXCEEDED", `workspace already holds ${service.config.maxTasksPerWorkspace} active tasks; close some with esr_close first`);
          }
          const now = Date.now();
          const task = {
            id: existing?.id ?? `tsk_${shortId(uuid())}`,
            workspace: caller.cwd,
            name: args.name,
            description: args.description ?? existing?.description ?? "",
            state: existing?.state ?? "active",
            artifact: existing?.artifact ?? null,
            evaluation: existing?.evaluation ?? null,
            memoryRefs: existing?.memoryRefs ?? [],
            sessionId: caller.sessionId,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            stateChangedAt: existing?.stateChangedAt ?? 0,
          };
          await domain.putTask(task);
          return `task ${task.id} [${task.state}] — ${task.name}`;
        },
      }),

      // ── esr_close ─────────────────────────────────────────────────────
      ctx.tools.register({
        name: "esr_close",
        description: "Close a task via the ESR evidence protocol. 'stable' requires ALL THREE gates: artifact (path/url of the produced artifact), evaluation (how it was verified — test run, review, benchmark score), and memory_ref (list of loom memory ids capturing decisions made). Missing gates are reported as gaps and the task stays active. On success a 'task closed' memory is auto-stored with the evidence.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task id from [ESR] or esr_task" },
            artifact: { type: "string", description: "Produced artifact (path/url)" },
            evaluation: { type: "string", description: "Verification evidence (test/review/benchmark)" },
            memory_refs: { type: "array", items: { type: "string" }, description: "Memory ids that record the decisions made" },
          },
          required: ["task_id"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ task_id: z.string().min(1), artifact: z.string().optional(), evaluation: z.string().optional(), memory_refs: z.array(z.string()).optional() }), raw, "esr_close");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const task = domain.getTask(caller.cwd, resolveTaskId(domain, caller.cwd, args.task_id));
          if (task === void 0) throw new LoomError("LOOM_NOT_FOUND", `no task "${args.task_id}" in this workspace`);
          const next = {
            ...task,
            artifact: args.artifact ?? task.artifact ?? null,
            evaluation: args.evaluation ?? task.evaluation ?? null,
            memoryRefs: args.memory_refs ?? task.memoryRefs,
            updatedAt: Date.now(),
          };
          const gaps = [];
          if (next.artifact === null || next.artifact === "") gaps.push("artifact");
          if (next.evaluation === null || next.evaluation === "") gaps.push("evaluation");
          if (next.memoryRefs.length === 0) gaps.push("memory_ref");
          if (gaps.length > 0) {
            await domain.putTask(next);
            return `task ${task.id} still ACTIVE — evidence gaps: ${gaps.join(", ")}. Provide them and call esr_close again (the [ESR] block shows current gaps).`;
          }
          const closed = { ...next, state: "stable", stateChangedAt: Date.now() };
          await domain.putTask(closed);
          const mem = await domain.storeMemory(
            {
              workspace: caller.cwd,
              kind: "task",
              text: `Task closed (${task.name}): artifact=${next.artifact} eval=${next.evaluation} refs=${next.memoryRefs.length}`,
              tags: ["esr-closure", "task"],
              entity: task.id,
              sessionId: caller.sessionId,
              seq: caller.seq,
              signal: 0.8,
            },
            service.config,
          );
          return `task ${task.id} → STABLE ✓ (artifact, evaluation, ${next.memoryRefs.length} memory ref(s))\nclosure memory: ${mem.id}`;
        },
      }),

      // ── esr_link ──────────────────────────────────────────────────────
      ctx.tools.register({
        name: "esr_link",
        description: "Add a typed relation between two entities (mini graph, pi-esr flavor), e.g. depends_on / implements / refines / contradicts. Relations surface in loom_timeline-style queries via entity and in the workspace's link count.",
        parameters: {
          type: "object",
          properties: {
            source: { type: "string", description: "Source entity id/label (required)" },
            relation: { type: "string", description: "Relation type, e.g. depends_on (required)" },
            target: { type: "string", description: "Target entity id/label (required)" },
            confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence 0..1 (default 1)" },
          },
          required: ["source", "relation", "target"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ source: z.string().min(1), relation: z.string().min(1), target: z.string().min(1), confidence: z.number().min(0).max(1).optional() }), raw, "esr_link");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const id = uuid();
          await domain.addLink({
            id,
            workspace: caller.cwd,
            source: args.source,
            relation: args.relation,
            target: args.target,
            confidence: args.confidence ?? 1,
            sessionId: caller.sessionId,
            createdAt: Date.now(),
          });
          return `link ${id} — ${args.source} --${args.relation}--> ${args.target}`;
        },
      }),

      // ── esr_gc ────────────────────────────────────────────────────────
      ctx.tools.register({
        name: "esr_gc",
        description: "Run the pi-esr-style memory GC for this workspace. Archives TTL-expired memories, evicts over-cap low-value memories, archives stable tasks past their retention window, and removes dangling link edges. The WORKING SET is never touched (memories referenced by active tasks, task memories, already-indexed hits). Archive-only — nothing is hard-deleted, every entry stays re-fetchable by id. dry_run:true previews without writing.",
        parameters: {
          type: "object",
          properties: {
            workspace: { type: "string", description: "Override the workspace key (default: current session cwd)" },
            dry_run: { type: "boolean", description: "Preview the sweep without mutating (default false)" },
          },
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ workspace: z.string().optional(), dry_run: z.boolean().optional() }), raw, "esr_gc");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const report = await domain.gc(args.workspace ?? caller.cwd, service.config, { dryRun: args.dry_run === true });
          return gcReportText(report);
        },
      }),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  });
}

/** FTS over past sessions via ctx.sessionQuery (mounted by the web profile). */
async function searchSessions(service, caller, query, signal) {
  const sq = service.sessionQuery;
  if (sq === void 0 || query.trim().length === 0) return [];
  try {
    const { items = [] } = await sq.searchSessions(
      {
        query: query.trim(),
        sessionFilters: [{ kind: "cwd", values: [caller.cwd] }],
        limit: 5,
      },
      signal !== void 0 ? { signal } : undefined,
    );
    return items
      .filter((hit) => hit.header?.id !== caller.sessionId)
      .slice(0, 3)
      .map((hit, i) => `${i + 1}. session ${hit.header?.id ?? "?"} · ${truncate(hit.bestMatch?.snippet ?? "", 160)}`);
  } catch (error) {
    if (hasCode(error, "SESSION_QUERY_SEARCH_DISABLED")) return [];
    service.log?.warn?.(`loom_recall session search failed: ${String(error)}`);
    return [];
  }
}

/** Resolve a partial id (the #xxxx 8-char marker) to a full memory id. */
function resolveId(domain, workspace, input) {
  const candidates = domain.listMemories(workspace, 200).filter((m) => m.id.startsWith(input) || m.id.slice(0, 8) === input);
  if (candidates.length === 1) return candidates[0].id;
  return input; // pass through; getMemory will yield NOT_FOUND if no exact match
}

/** Resolve partial task ids the same way. */
function resolveTaskId(domain, workspace, input) {
  const candidates = domain.listTasks(workspace, { includeStable: true }).filter((t) => t.id === input || t.id.startsWith(input));
  if (candidates.length === 1) return candidates[0].id;
  return input;
}

/** Compact, pointer-honest report text for `esr_gc` (token-conscious). */
function gcReportText(report) {
  const prefix = report.dryRun ? "GC dry-run" : "GC done";
  const lines = [
    `${prefix}${report.workspaces.length === 1 ? ` workspace ${report.workspaces[0]}` : ` ${report.workspaces.length} workspaces`}: ` +
      `${report.archivedMemories.length} memories archived · ${report.archivedTasks.length} tasks archived · ` +
      `${report.removedLinks.length} dangling links removed · ${report.protectedMemories} protected (working set)`,
  ];
  for (const e of report.archivedMemories.slice(0, 8)) {
    lines.push(`- archive memory ${e.id.slice(0, 8)} [${e.kind}] (${e.reason}): ${truncate(e.text, 56)}`);
  }
  if (report.archivedMemories.length > 8) lines.push(`… +${report.archivedMemories.length - 8} more archived memories`);
  for (const t of report.archivedTasks.slice(0, 5)) {
    lines.push(`- archive task ${t.id.slice(0, 6)} (${t.reason}): ${truncate(t.name, 56)}`);
  }
  for (const l of report.removedLinks.slice(0, 5)) {
    lines.push(`- drop link ${l.source.slice(0, 8)} --${l.relation}--> ${l.target.slice(0, 8)} (dangling)`);
  }
  lines.push("pointers: archived entries keep their ids — re-fetch via loom_detail / GUI archived filter; nothing was hard-deleted");
  return lines.join("\n");
}
