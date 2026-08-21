/**
 * dsh-engram: model-facing tools.
 *
 * Eight small, tight-schema tools (deliberately fewer than the market's 8-12 —
 * tool schemas cost tokens in every request):
 *   engram_store / engram_recall / engram_detail    — the engram memory surface
 *   esr_task / esr_node / esr_close / esr_link — the ESR-lite evidence surface
 *   esr_gc                                    — pi-esr memory garbage collection
 *
 * Every call is recorded into the per-(workspace, day) usage rollup so the
 * GUI can report real ESR-proactivity and recall rates (see usage.js).
 *
 * All reads are deterministic local scans; `engram_recall` may additionally
 * fall back to `ctx.sessionQuery` FTS over past sessions when mounted.
 */

import { z } from "zod";
import { EngramError, hasCode } from "./store.js";
import { truncate, shortId, slugId, fmtDate, escapeLt, workspaceKey as wk, uuid } from "./util.js";
import { makeUsageTracker } from "./usage.js";

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
  if (agent === void 0) throw new EngramError("ENGRAM_MISSING_AGENT", "engram tools require an agent-bound caller");
  const cwd = agent.session?.header?.cwd;
  if (cwd === void 0 || cwd.length === 0) throw new EngramError("ENGRAM_UNAUTHORIZED", "this session has no workspace cwd; engram memory is workspace-scoped");
  return { agent, cwd: wk(cwd), sessionId: agent.session.id, seq: agent.session.events?.length ?? 0 };
}

function parse(zodSchema, raw, tool) {
  const result = zodSchema.safeParse(raw);
  if (!result.success) throw new EngramError("ENGRAM_INVALID_ARGS", `${tool}: ${describeZodError(result.error)}`);
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
    if (error instanceof EngramError) throw error;
    throw new EngramError("ENGRAM_UNAVAILABLE", `engram domain could not be opened: ${String(error)} — memory offline`, { cause: error });
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
    const usage = makeUsageTracker();
    // Wrap registration so every model-facing tool call is recorded into the
    // per-(workspace, day) usage rollup (real ESR-proactivity / recall stats).
    const registerTool = (tool) => {
      const execute = tool.execute;
      return ctx.tools.register({
        ...tool,
        execute: async (raw, exec) => {
          try {
            const out = await execute(raw, exec);
            void usage
              .record(service, exec, tool.name, {
                ok: true,
                recallOutput: tool.name === "engram_recall" ? out : void 0,
              })
              .catch(() => {});
            return out;
          } catch (error) {
            void usage.record(service, exec, tool.name, { ok: false }).catch(() => {});
            throw error;
          }
        },
      });
    };
    const disposers = [
      // ── engram_store ────────────────────────────────────────────────────
      registerTool({
        name: "engram_store",
        description: "Explicitly store one memory in this workspace's long-term memory. Kinds: decision/error/procedure/fact/insight/handoff/task (D/E/P/F/I/H/T prefixes in the [ENGRAM] index). Pass an entity to anchor it (pi-esr entity_id convention). Auto-capture already records git/file/error events — use this for anything it misses. Exact-duplicate text refreshes the existing entry instead of adding.",
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
          const args = parse(z.object({ text: z.string().min(1).max(2000), kind: z.enum(KINDS).optional(), tags: z.array(z.string()).optional(), entity: z.string().optional() }), raw, "engram_store");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          await domain.expireSweep(caller.cwd);
          const { stored, duplicated, revived } = await domain.storeMemory(
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
          const dupNote = duplicated ? (revived === true ? "(repeat failure — previous entry revived) " : "(duplicate refreshed) ") : "";
          return `stored ${dupNote}memory ${stored.id} [${stored.kind}] — cited to session ${stored.sessionId}#${stored.seq}`;
        },
      }),

      // ── engram_recall ───────────────────────────────────────────────────
      registerTool({
        name: "engram_recall",
        description: "Deterministic recall over this workspace's engram memories: exact tag match ranks first, case-insensitive text substring next, recency breaks ties. Literal, not semantic — query in the language the memory is likely written in. Pass query to filter, entity to restrict to an entity's memories (timeline), search_sessions:true to also full-text search PAST sessions of this workspace via the harness session index. Hit counts promote low-signal auto-captures into the [ENGRAM] index.",
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
          const args = parse(z.object({ query: z.string().optional(), entity: z.string().optional(), limit: z.number().int().min(1).max(50).optional(), search_sessions: z.boolean().optional() }), raw, "engram_recall");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          let lines = [];
          let items = [];
          // When a query/entity returns nothing locally, the FTS fallback below
          // reuses DSH's own cross-session index (ctx.sessionQuery) instead of
          // a self-built index — this keeps proactive coverage without new infra.
          let zeroHits = false;
          if (args.entity !== void 0 && args.entity.trim().length > 0) {
            items = domain.timeline(caller.cwd, args.entity, args.limit ?? 30);
            if (items.length === 0) zeroHits = true;
            lines.push(zeroHits ? `no memories for entity "${args.entity}" in this workspace` : `# timeline: ${args.entity}`);
            lines.push(...items.map((m) => memoryLine(m)));
            await Promise.all(items.map((m) => domain.touchMemory(caller.cwd, m.id).catch(() => null)));
          } else if (args.query !== void 0) {
            items = domain.recall(caller.cwd, args.query, args.limit ?? 12);
            if (items.length === 0) zeroHits = true;
            lines.push(zeroHits ? `no active memories match ${JSON.stringify(args.query)} in this workspace` : `# recall: ${JSON.stringify(args.query)} (${items.length})`);
            lines.push(...items.map((m) => memoryLine(m)));
            await Promise.all(items.map((m) => domain.touchMemory(caller.cwd, m.id).catch(() => null)));
          } else {
            items = domain.listMemories(caller.cwd, args.limit ?? 12);
            if (items.length === 0) return "no active memories in this workspace yet";
            lines.push(`# newest memories (${items.length})`);
            lines.push(...items.map((m) => memoryLine(m)));
          }
          // Entity neighborhood: items anchored to entities get a compact
          // graph-retrieval pass over the existing ESR relation table (the
          // lightweight knowledge-graph end of the spectrum — no graph DB).
          const neighbors = collectNeighborhood(domain, caller.cwd, items);
          if (neighbors.length > 0) lines.push("", "# entity neighborhood", ...neighbors);
          const wantSessions = args.search_sessions === true || (zeroHits && service.config.sessionSearch !== false);
          if (wantSessions) {
            const extra = await searchSessions(service, caller, args.query ?? args.entity ?? "", exec.signal);
            if (extra.length > 0) lines.push("", "# past sessions (FTS fallback)", ...extra);
            else if (zeroHits && lines.length === 1) lines[0] += " (no past-session hits either)";
          }
          return lines.join("\n");
        },
      }),

      // ── engram_detail ───────────────────────────────────────────────────
      registerTool({
        name: "engram_detail",
        description: "Full record of one memory id from the [ENGRAM] index (run engram_recall to find ids): text, tags, entity, signal, hits, provenance session#seq.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Memory id (e.g. the #xxxxx marker in the [ENGRAM] index is the first 8 chars)" },
          },
          required: ["id"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ id: z.string().min(1) }), raw, "engram_detail");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const id = resolveId(domain, caller.cwd, args.id);
          const m = domain.getMemory(caller.cwd, id);
          if (m === void 0) throw new EngramError("ENGRAM_NOT_FOUND", `no active memory "${args.id}" in this workspace`);
          await domain.touchMemory(caller.cwd, m.id).catch(() => null);
          return memoryLine(m, "full");
        },
      }),

      // ── esr_task ──────────────────────────────────────────────────────
      registerTool({
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
          if (args.id !== void 0 && existing === void 0) throw new EngramError("ENGRAM_NOT_FOUND", `no task "${args.id}" in this workspace`);
          if (existing === void 0 && domain.activeTaskCount(caller.cwd) >= service.config.maxTasksPerWorkspace) {
            throw new EngramError("ENGRAM_CAP_EXCEEDED", `workspace already holds ${service.config.maxTasksPerWorkspace} active tasks; close some with esr_close first`);
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
          const hint = esrModelingHint(domain, caller.cwd);
          return `task ${task.id} [${task.state}] — ${task.name}${hint ? `
${hint}` : ""}`;
        },
      }),

      // ── esr_close ─────────────────────────────────────────────────────
      registerTool({
        name: "esr_close",
        description: "Close a task via the ESR evidence protocol. 'stable' requires ALL THREE gates: artifact (path/url of the produced artifact), evaluation (how it was verified — test run, review, benchmark score), and memory_ref (list of engram memory ids capturing decisions made). Missing gates are reported as gaps and the task stays active. A non-URL artifact must exist on disk relative to the workspace (config verifyArtifact), otherwise the task stays active with the reason; if the artifact is legitimately out-of-band pass force:true to skip the disk check (gates are still required). On success a 'task closed' memory is auto-stored with the evidence.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task id from [ESR] or esr_task" },
            artifact: { type: "string", description: "Produced artifact (path/url). Paths are resolved against the workspace and must exist on disk unless force:true" },
            evaluation: { type: "string", description: "Verification evidence (test/review/benchmark)" },
            memory_refs: { type: "array", items: { type: "string" }, description: "Memory ids that record the decisions made" },
            force: { type: "boolean", description: "Skip the on-disk artifact existence check (gates are still required)" },
          },
          required: ["task_id"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ task_id: z.string().min(1), artifact: z.string().optional(), evaluation: z.string().optional(), memory_refs: z.array(z.string()).optional(), force: z.boolean().optional() }), raw, "esr_close");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const task = domain.getTask(caller.cwd, resolveTaskId(domain, caller.cwd, args.task_id));
          if (task === void 0) throw new EngramError("ENGRAM_NOT_FOUND", `no task "${args.task_id}" in this workspace`);
          const next = {
            ...task,
            artifact: args.artifact ?? task.artifact ?? null,
            evaluation: args.evaluation ?? task.evaluation ?? null,
            memoryRefs: args.memory_refs ?? task.memoryRefs,
            updatedAt: Date.now(),
          };
          // force only skips the on-disk existence check — the three gates
          // (artifact/evaluation/memory_ref) are always required.
          const gateCfg = args.force === true ? { ...service.config, verifyArtifact: false } : service.config;
          const gate = domain.evidenceGate(caller.cwd, next, gateCfg);
          const gaps = gate.gaps;
          if (gaps.length > 0) {
            await domain.putTask(next);
            const reason = gate.artifactReason !== void 0 ? ` (${gate.artifactReason})` : "";
            return `task ${task.id} still ACTIVE — evidence gaps: ${gaps.join(", ")}${reason}. Provide them (and ensure the artifact path exists on disk unless force:true) and call esr_close again (the [ESR] block shows current gaps).`;
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
          const hint = esrModelingHint(domain, caller.cwd);
          return `task ${task.id} → STABLE ✓ (artifact, evaluation, ${next.memoryRefs.length} memory ref(s))\nclosure memory: ${mem.id}${hint ? `
${hint}` : ""}`;
        },
      }),

      // ── esr_link ──────────────────────────────────────────────────────
      registerTool({
        name: "esr_link",
        description: "Add a typed relation between two entities (mini graph, pi-esr flavor), e.g. depends_on / implements / refines / contradicts. Relations surface in engram_timeline-style queries via entity and in the workspace's link count.",
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

      // ── esr_node ──────────────────────────────────────────────────────
      registerTool({
        name: "esr_node",
        description: "Create or update an entity node — a stable symbol for a thing this workspace keeps referring to (a package, service, document, repository, person, bug, concept). Nodes anchor esr_link relations and the `entity` field of memories. The id is derived from the name (`ent_<slug>`), so calling esr_node with the same name updates the same node and esr_link can target it without a prior id lookup. Be proactive: create a node when a domain object recurs across your work, and link related nodes/tasks with esr_link.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Node name — e.g. \"dsh-engram\" gives id ent_dsh-engram" },
            description: { type: "string", description: "What this node is / why it matters (optional)" },
            kind: { type: "string", description: "Kind tag: package / service / doc / repo / person / bug / module ... (optional)" },
          },
          required: ["name"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ name: z.string().min(1).max(120), description: z.string().optional(), kind: z.string().optional() }), raw, "esr_node");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const id = `ent_${slugId(args.name)}`;
          const existing = domain.getEntity(caller.cwd, id);
          const now = Date.now();
          const node = {
            id,
            workspace: caller.cwd,
            name: args.name.trim().slice(0, 120),
            description: (args.description ?? existing?.description ?? "").trim().slice(0, 2000),
            kind: (args.kind ?? existing?.kind ?? "").trim().slice(0, 40),
            sessionId: caller.sessionId,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          await domain.putEntity(node);
          const hint = esrModelingHint(domain, caller.cwd);
          const base = existing
            ? `node ${id} updated — ${node.name}${node.kind ? ` (${node.kind})` : ""}`
            : `node ${id} created — ${node.name}${node.kind ? ` (${node.kind})` : ""}`;
          return `${base}${hint ? `
${hint}` : ""}`;
        },
      }),

      // ── esr_gc ────────────────────────────────────────────────────────
      registerTool({
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

/**
 * Compact graph-retrieval pass for engram_recall: entities the returned
 * memories are anchored to, and the ESR relation lines touching them
 * (`node --rel--> node · conf%`). This is the lightweight end of the
 * graph-memory spectrum — it reuses the existing `links`/`entities` tables,
 * no graph database. Deterministic, capped (≤ 8 lines), deduped by link id.
 */
/**
 * Model-facing nudge for the near-empty entity graph: after a task/node
 * change, tell the model how the workspace's entity/relation graph looks so
 * esr_node / esr_link stay in its decision space. Returns "" when the domain
 * is unavailable so callers can skip the extra line silently.
 */
export function esrModelingHint(domain, workspace) {
  try {
    const entities = domain.listEntities(workspace);
    const links = domain.allLinks(workspace);
    if (entities.length === 0) {
      return "modeling: no entity graph in this workspace yet — create esr_node entries for recurring domain objects, then esr_link to connect them (graph: GUI Settings → Engram).";
    }
    const names = entities.slice(0, 3).map((e) => e.name).join(", ");
    return `modeling: entities ${names}${entities.length > 3 ? ` +${entities.length - 3}` : ""} / links ${links.length} — esr_link can wire new tasks & nodes into this graph.`;
  } catch {
    return "";
  }
}

function collectNeighborhood(domain, workspace, items) {
  const involved = new Set();
  for (const m of items ?? []) {
    if (m?.entity !== null && m?.entity !== void 0 && m.entity !== "") involved.add(m.entity);
  }
  if (involved.size === 0) return [];
  const label = (id) => {
    const e = domain.getEntity(workspace, id);
    return e !== void 0 ? e.name || id : id;
  };
  const seen = new Set();
  const lines = [];
  for (const ent of involved) {
    for (const l of domain.linksFor(workspace, ent)) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      lines.push(`- ${label(l.source)} --${l.relation}--> ${label(l.target)} (${Math.round((l.confidence ?? 1) * 100)}%)`);
      if (lines.length >= 8) return lines;
    }
  }
  return lines;
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
    service.log?.warn?.(`engram_recall session search failed: ${String(error)}`);
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
  lines.push("pointers: archived entries keep their ids — re-fetch via engram_detail / GUI archived filter; nothing was hard-deleted");
  return lines.join("\n");
}
