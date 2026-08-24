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
    const access = m.lastAccessAt == null ? "never-accessed" : `lastAccess ${fmtDate(m.lastAccessAt)}`;
    const pathLine = m.filePath ? ` · path ${m.filePath}` : "";
    return [`# ${m.id} [${m.kind}]`, escapeLt(m.text), `tags: ${(m.tags ?? []).join(", ")}${tags}`, `signal ${m.signal} · hits ${m.hits ?? 0} · ${fmtDate(m.createdAt)} · session ${m.sessionId}#${m.seq} · ${access}${pathLine}`, ""].join("\n");
  }
  const date = fmtDate(m.createdAt ?? m.updatedAt);
  const path = m.filePath ? ` · ${truncate(m.filePath, 48)}` : "";
  return `- ${m.id.slice(0, 8)} [${m.kind}] ${date} ${escapeLt(truncate(m.text, 200))}${tags}${m.hits > 0 ? ` · ×${m.hits}` : ""}${path}`;
}

/** Stable kind display order for grouped recall output (matches MEMORY_KINDS). */
const MEMORY_KIND_ORDER = ["decision", "error", "procedure", "fact", "insight", "handoff", "task"];

/**
 * Render recall hits grouped by kind (MemoraX-style memory_type buckets):
 *   ## decision (2)
 *   - 08-21 …
 * Within a group the original (relevance) order is preserved; unknown kinds
 * (future-proof) trail the fixed order. Pure, deterministic.
 */
function groupKindLines(items) {
  const buckets = new Map();
  for (const m of items) {
    const kind = typeof m.kind === "string" && m.kind.length > 0 ? m.kind : "unknown";
    if (!buckets.has(kind)) buckets.set(kind, []);
    buckets.get(kind).push(m);
  }
  const lines = [];
  const emit = (kind, group) => {
    lines.push(`## ${kind} (${group.length})`);
    for (const m of group) lines.push(memoryLine(m));
  };
  for (const kind of MEMORY_KIND_ORDER) if (buckets.has(kind)) emit(kind, buckets.get(kind));
  for (const [kind, group] of buckets) if (!MEMORY_KIND_ORDER.includes(kind)) emit(kind, group);
  return lines;
}

export function registerTools(ctx, service) {
  return ctx.effect(() => {
    // Assessment P3: no per-call usage writes — agent-behaviour observability
    // is computed on demand from the session log stream (lib/usage.js), so
    // tools register plain, without a recording wrapper.
    const registerTool = (tool) => ctx.tools.register(tool);
    const disposers = [
      // ── engram_store ────────────────────────────────────────────────────
      registerTool({
        name: "engram_store",
        description: "Store one memory: kind=(decision|error|procedure|fact|insight|handoff|task), text, optional entity anchor. Exact-duplicate text refreshes instead of adding; auto-capture already handles git/file/error events — use this for anything it misses.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Compact, information-dense memory text (required)" },
            ...p,
            file_path: { type: "string", description: "Optional absolute path this memory anchors to (e.g. the failing file)" },
          },
          required: ["text"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ text: z.string().min(1).max(2000), kind: z.enum(KINDS).optional(), tags: z.array(z.string()).optional(), entity: z.string().optional(), file_path: z.string().optional() }), raw, "engram_store");
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
              filePath: args.file_path ?? null,
              sessionId: caller.sessionId,
              seq: caller.seq,
              signal: 0.6,
            },
            service.config,
          );
          const dupNote = duplicated ? (revived === true ? "(repeat failure — previous entry revived) " : "(duplicate refreshed) ") : "";
          await domain.markModelDirty?.(caller.cwd).catch?.(() => null);
          return `stored ${dupNote}memory ${stored.id} [${stored.kind}] — cited to session ${stored.sessionId}#${stored.seq}`;
        },
      }),

      // ── engram_recall ───────────────────────────────────────────────────
      registerTool({
        name: "engram_recall",
        description: "Deterministic recall of this workspace's memories (BM25: exact tag first, recency ties). Literal, not semantic — query in the memory's likely language. query=filter, entity=timeline, search_sessions=true adds past-session FTS. limit/max_per_session/group_by_kind tune output.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Words to match against memory text and tags" },
            entity: { type: "string", description: "Return that entity's memories chronologically" },
            limit: { type: "integer", minimum: 1, maximum: 50, description: "Max memories (default 12)" },
            max_per_session: { type: "integer", minimum: 1, maximum: 10, description: "Session-diversified cap: max memories kept per sessionId (default config.maxRecallPerSession=3; >1 sessions get to share the list)" },
            group_by_kind: { type: "boolean", description: "Group recall hits by kind into sections (default true); false = one flat list" },
            search_sessions: { type: "boolean", description: "Also FTS search past sessions (requires the session-query index)" },
          },
        },
        output: TEXT_OUTPUT,
        timeoutMs: 30000,
        execute: async (raw, exec) => {
          const args = parse(z.object({ query: z.string().optional(), entity: z.string().optional(), limit: z.number().int().min(1).max(50).optional(), max_per_session: z.number().int().min(1).max(10).optional(), group_by_kind: z.boolean().optional(), search_sessions: z.boolean().optional() }), raw, "engram_recall");
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
            const maxPerSession = args.max_per_session ?? service.config.maxRecallPerSession ?? 3;
            items = domain.recall(caller.cwd, args.query, args.limit ?? 12, { maxPerSession });
            if (items.length === 0) zeroHits = true;
            lines.push(zeroHits ? `no active memories match ${JSON.stringify(args.query)} in this workspace` : `# recall: ${JSON.stringify(args.query)} (${items.length}) · ≤${maxPerSession}/session`);
            lines.push(...(args.group_by_kind === false ? items.map((m) => memoryLine(m)) : groupKindLines(items)));
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
          // Evidence-grounded beliefs: repeated signals (proof >= 2) surface as
          // high-confidence observations alongside the raw recall hits.
          const strongObs = (domain.listObservations?.(caller.cwd) ?? []).filter((o) => (o.proof?.count ?? 0) >= 2);
          if (strongObs.length > 0) {
            lines.push("", "# observations (evidence ≥ 2)", ...strongObs.map((o) => `• ${o.text} — ×${o.proof.count} ${o.trend}${o.negations > 0 ? ` · 反证${o.negations}` : ""}`));
          }
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
        description: "Full record of one memory id (from engram_recall): text, tags, entity, signal, hits, provenance session#seq.",
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
        description: "Create/update an engineering task (draft→active). A task is only 'done' with evidence — finish via esr_close (artifact + evaluation + memory_ref). Set id to update an existing task. Pass entity= to auto-create the node and link the task onto it (one call instead of esr_node+esr_link).",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Task name (required on create)" },
            description: { type: "string", description: "What must be produced / satisfied" },
            id: { type: "string", description: "Existing task id to update" },
            entity: { type: "string", description: "Optional domain object to hang this task on — auto-creates ent_<slug> node and links task --relates_to--> it" },
          },
          required: ["name"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ name: z.string().min(1).max(200), description: z.string().optional(), id: z.string().optional(), entity: z.string().optional() }), raw, "esr_task");
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
            deps: existing?.deps ?? [],
            assignee: existing?.assignee ?? null,
            claimedAt: existing?.claimedAt ?? null,
          };
          await domain.putTask(task);
          await domain.markModelDirty?.(caller.cwd).catch?.(() => null);
          const wiring = args.entity !== void 0
            ? await wireTaskEntity(domain, caller.cwd, task.id, args.entity, caller.sessionId, now)
            : "";
          const hint = esrModelingHint(domain, caller.cwd);
          const parts = [`task ${task.id} [${task.state}] — ${task.name}`];
          if (wiring !== "") parts.push(wiring);
          if (hint !== "") parts.push(hint);
          return parts.join("\n");
        },
      }),

      // ── esr_close ─────────────────────────────────────────────────────
      registerTool({
        name: "esr_close",
        description: "Close a task via the ESR evidence protocol: requires artifact (path/url), evaluation (how verified) and memory_ref (memory ids) — missing gates keep it active; force:true skips the on-disk artifact check. Auto-stores a closing memory.",
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
            await domain.markModelDirty?.(caller.cwd).catch?.(() => null);
            const reason = gate.artifactReason !== void 0 ? ` (${gate.artifactReason})` : "";
            return `task ${task.id} still ACTIVE — evidence gaps: ${gaps.join(", ")}${reason}. Provide them (and ensure the artifact path exists on disk unless force:true) and call esr_close again (the [ESR] block shows current gaps).`;
          }
          const closed = domain.compactOnClose?.({ ...next, state: "stable", stateChangedAt: Date.now() }) ?? { ...next, state: "stable", stateChangedAt: Date.now() };
          await domain.putTask(closed);
          await domain.markModelDirty?.(caller.cwd).catch?.(() => null);
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
        description: "Add a typed relation between two entities (depends_on/implements/refines/contradicts…). Feeds entity queries and the workspace link count.",
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
          await domain.markModelDirty?.(caller.cwd).catch?.(() => null);
          return `link ${id} — ${args.source} --${args.relation}--> ${args.target}`;
        },
      }),

      registerTool({
        name: "esr_dep",
        description: "Add a dependency edge between tasks: blocks (waits until dep closes), parent-of (child), relates-to (no blocking). Refuses self-deps and cycles.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "The task gaining the dependency" },
            dep_id: { type: "string", description: "The task it depends on / relates to" },
            kind: { type: "string", enum: ["blocks", "relates-to", "parent-of"], description: "Edge kind (default blocks)" },
          },
          required: ["task_id", "dep_id"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ task_id: z.string().min(1), dep_id: z.string().min(1), kind: z.enum(["blocks", "relates-to", "parent-of"]).optional() }), raw, "esr_dep");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const taskId = resolveTaskId(domain, caller.cwd, args.task_id);
          const depId = resolveTaskId(domain, caller.cwd, args.dep_id);
          const kind = args.kind ?? "blocks";
          const t = await domain.addDep(caller.cwd, taskId, depId, kind);
          // Graph-hygiene (A): the same edge goes into the links table so the
          // dependency is a first-class, visible relation everywhere (graph,
          // /links, entity neighbourhood) — not just a blocker counter.
          const now = Date.now();
          await domain.addLinkOnce({
            id: uuid(),
            workspace: caller.cwd,
            source: taskId,
            relation: kind,
            target: depId,
            confidence: 1,
            sessionId: caller.sessionId,
            createdAt: now,
          });
          await domain.markModelDirty?.(caller.cwd).catch?.(() => null);
          return `dep added: ${t.id} --${kind}--> ${depId} (total ${(t.deps ?? []).length} edges · now graphed)`;
        },
      }),

      // ── esr_claim / esr_unclaim ─────────────────────────────────────
      registerTool({
        name: "esr_claim",
        description: "Atomically claim a task (assignee+claimedAt, draft→active). Refuses when another agent holds it unless force:true. Find work with esr_ready.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task id from [ESR] or esr_task" },
            agent: { type: "string", description: "Claimer id (default: current session agent)" },
            force: { type: "boolean", description: "Steal the claim from its current holder (default false)" },
          },
          required: ["task_id"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ task_id: z.string().min(1), agent: z.string().optional(), force: z.boolean().optional() }), raw, "esr_claim");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const agent = args.agent ?? caller.agentId ?? "agent";
          const t = await domain.claimTask(caller.cwd, resolveTaskId(domain, caller.cwd, args.task_id), agent, { force: args.force === true });
          await domain.markModelDirty?.(caller.cwd).catch?.(() => null);
          return `claimed ${t.id} by ${agent} [${t.state}] — ${t.name}`;
        },
      }),
      registerTool({
        name: "esr_unclaim",
        description: "Release a claimed task's assignee back to null. Non-holder needs force:true. Inverse of esr_claim.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task id from [ESR] or esr_task" },
            force: { type: "boolean", description: "Release even when someone else holds it (default false)" },
          },
          required: ["task_id"],
        },
        output: TEXT_OUTPUT,
        execute: async (raw, exec) => {
          const args = parse(z.object({ task_id: z.string().min(1), force: z.boolean().optional() }), raw, "esr_unclaim");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const agent = caller.agentId ?? "agent";
          const t = await domain.unclaimTask(caller.cwd, resolveTaskId(domain, caller.cwd, args.task_id), agent, { force: args.force === true });
          await domain.markModelDirty?.(caller.cwd).catch?.(() => null);
          return `released ${t.id} — ${t.name} (unclaimed)`;
        },
      }),

      // ── esr_ready ────────────────────────────────────────────────────
      registerTool({
        name: "esr_ready",
        description: "List claimable tasks: no open blocker and nobody claimed. One line per task.",
        parameters: {
          type: "object",
          properties: {
            workspace: { type: "string", description: "Override the workspace key (default: current session cwd)" },
            limit: { type: "integer", minimum: 1, maximum: 50, description: "Max tasks (default 10)" },
          },
        },
        output: TEXT_OUTPUT,
        timeoutMs: 20000,
        execute: async (raw, exec) => {
          const args = parse(z.object({ workspace: z.string().optional(), limit: z.number().int().min(1).max(50).optional() }), raw, "esr_ready");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const ws = args.workspace ?? caller.cwd;
          const ready = domain.readyTasks(ws, args.limit ?? 10);
          if (ready.length === 0) return `no claimable work right now in ${ws} — tasks with open blockers stay blocked until their deps close`;
          return `# ready (claimable): ${ready.length}\n` + ready.map((t) => `- ${t.id} [${t.state}] ${t.name}${(t.deps ?? []).length > 0 ? ` (deps ${t.deps.length})` : ""}`).join("\n");
        },
      }),

      // ── esr_node ─────────────────────────────────────
      registerTool({
        name: "esr_node",
        description: "Create/update an entity node — stable symbol for a recurring thing (package/service/doc/repo/person/bug/concept). Nodes anchor esr_link relations and memory entity. Same name updates; id = ent_<slug>.",
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
          await domain.markModelDirty?.(caller.cwd).catch?.(() => null);
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
        description: "Run memory GC: archives TTL-expired, over-cap low-retention memories, stable tasks past retention, dangling links. Working set protected; archive-only (nothing hard-deleted). dry_run:true previews.",
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

      // ── esr_model ─────────────────────────────────────────────────────
      registerTool({
        name: "esr_model",
        description: "Precomputed mental model of the workspace (task counts, entity graph, top evidence-grounded beliefs, risks). Zero LLM. mode=brief → ~50-token one-liner; max_chars trims. Read before scattering recall.",
        parameters: {
          type: "object",
          properties: {
            ws: { type: "string", description: "Workspace to summarize (default: current session cwd)" },
            mode: { type: "string", enum: ["full", "brief"], description: "brief = one-line headline (session-start injection); full = complete markdown (default)" },
            max_chars: { type: "integer", minimum: 1, maximum: 4000, description: "Cap output length (default: no cap)" },
          },
        },
        output: TEXT_OUTPUT,
        timeoutMs: 20000,
        execute: async (raw, exec) => {
          const args = parse(z.object({ ws: z.string().optional(), mode: z.enum(["full", "brief"]).optional(), max_chars: z.number().int().min(1).max(4000).optional() }), raw, "esr_model");
          const caller = callerOf(exec);
          const domain = await requireDomain(service);
          const ws = args.ws ?? caller.cwd;
          const { getModel } = await import("./mental.js");
          const model = await getModel(domain, ws, { mode: args.mode ?? "full" });
          const mins = Math.max(0, Math.floor((Date.now() - model.generated_at) / 60000));
          let content = model.content;
          if (typeof args.max_chars === "number" && content.length > args.max_chars) {
            content = `${content.slice(0, Math.max(1, args.max_chars - 1))}…`;
          }
          return `${content}\n\n(生成于 ${mins} 分钟前 · ${model.fresh ? "本次重算" : "缓存命中"} · mode=${args.mode ?? "full"} · ws=${ws})`;
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
      return "modeling: no entity graph in this workspace yet — esr_task(entity=…) auto-creates the node and hangs the task on it; or use esr_node for recurring domain objects, then esr_link to connect (graph: GUI Settings → Engram).";
    }
    const names = entities.slice(0, 3).map((e) => e.name).join(", ");
    return `modeling: entities ${names}${entities.length > 3 ? ` +${entities.length - 3}` : ""} / links ${links.length} — esr_task(entity=…) hangs new work onto a node; esr_link can wire tasks & nodes further into this graph.`;
  } catch {
    return "";
  }
}

/**
 * Auto-wire a task onto a domain object (graph-hygiene fix): ensure the entity
 * node exists (id = ent_<slug>, same derivation as esr_node) and add the
 * one-way `task --relates_to--> entity` edge, idempotently. One call instead
 * of esr_node + esr_link so a task is never an isolated node. Pure/mechanical,
 * zero LLM. Returns a short report line ("" when entity is empty).
 */
export async function wireTaskEntity(domain, workspace, taskId, entityName, sessionId, now = Date.now()) {
  const name = String(entityName).trim().slice(0, 120);
  if (name.length === 0) return "";
  const entId = `ent_${slugId(name)}`;
  let created = false;
  if (domain.getEntity(workspace, entId) === void 0) {
    await domain.putEntity({
      id: entId,
      workspace,
      name,
      description: "",
      kind: "concept",
      sessionId,
      createdAt: now,
      updatedAt: now,
    });
    created = true;
  }
  const added = await domain.addLinkOnce({
    id: uuid(),
    workspace,
    source: taskId,
    relation: "relates_to",
    target: entId,
    confidence: 1,
    sessionId,
    createdAt: now,
  });
  return `wired: ${taskId} --relates_to--> ${entId}${created ? " (node created)" : ""}${added ? "" : " (edge already exists)"}`;
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
