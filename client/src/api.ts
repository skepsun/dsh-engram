/**
 * dsh-engram client: browser API client for the /api/dsh-engram route family.
 * Plain same-origin fetch (the SSH panel's proven pattern) — no RPC, no
 * WebSocket. Every endpoint is loopback-fenced on the host side.
 */

export const API_PREFIX = "/api/dsh-engram";

export interface MemoryRecord {
  id: string;
  workspace: string;
  kind: string;
  text: string;
  tags: string[];
  entity: string | null;
  sessionId: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
  hits: number;
  signal: number;
  status: "active" | "archived";
  expiresAt: number | null;
}

export interface TaskRecord {
  id: string;
  workspace: string;
  name: string;
  description: string;
  state: "draft" | "active" | "stable";
  artifact: string | null;
  evaluation: string | null;
  memoryRefs: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ToolStats {
  days: number;
  files: number;
  events: number;
  tools: Record<string, number>;
  buckets: Record<string, Record<string, number>>;
}

export interface ObservationRecord {
  id: string;
  workspace: string;
  text: string;
  kind: "belief" | "pattern";
  proof: { count: number; sources: string[] };
  span: { first_seen_at: number; last_seen_at: number };
  negations: number;
  trend: "new" | "strengthening" | "stable" | "weakening" | "stale";
  tags: string[];
  entity: string | null;
  updated_at: number;
}

export interface LinkRecord {
  id: string;
  workspace: string;
  source: string;
  relation: string;
  target: string;
  confidence: number;
  createdAt: number;
}

/** Graph node registered by the model via esr_node (id = ent_<slug>). */
export interface EntityRecord {
  id: string;
  workspace: string;
  name: string;
  description: string;
  kind: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceCounts {
  memories: number;
  tasks: number;
  links: number;
  nodes: number;
}

export interface EngramConfig {
  autoCapture: boolean;
  sessionSearch: boolean;
  autoCapturePerSession: number;
  indexMaxLines: number;
  indexMaxChars: number;
  minIndexSignal: number;
  promoteHits: number;
  expireDays: number;
  maxMemoriesPerWorkspace: number;
  gcEnabled: boolean;
  gcStableRetentionDays: number;
}

export interface GcStats {
  lastRun: number;
  archivedMemories: number;
  archivedTasks: number;
  removedLinks: number;
}

export interface GcItem {
  id: string;
  workspace: string;
  reason: string;
  kind?: string;
  text?: string;
  name?: string;
  source?: string;
  relation?: string;
  target?: string;
}

export interface GcReport {
  dryRun: boolean;
  workspaces: string[];
  protectedMemories: number;
  archivedMemories: GcItem[];
  archivedTasks: GcItem[];
  removedLinks: GcItem[];
}

export interface IndexCost {
  chars: number;
  tokens: number;
  lines: number;
}

export interface UsageDay {
  workspace: string;
  day: string;
  counts: Record<string, number>;
  failures: number;
  recall: Record<string, number>;
}

export interface UsageRatios {
  calls: number;
  esrCalls: number;
  memCalls: number;
  esrRatio: number | null;
  recallHitRate: number | null;
  recallHitsPerQuery: number | null;
  detailFollowRate: number | null;
}

export interface EngramStats {
  workspace: string | null;
  byDay: UsageDay[];
  totals: { counts: Record<string, number>; failures: number; recall: Record<string, number> };
  ratios: UsageRatios;
}

export interface EngramOverview {
  workspaces: Record<string, WorkspaceCounts>;
  kinds: Record<string, number>;
  totals: WorkspaceCounts;
  indexes: Record<string, IndexCost>;
  captures: { total: number; git: number; file: number; error: number };
  gc: GcStats;
  config: EngramConfig;
}

/** Cost + count metadata for one injected block. */
export interface BlockMeta {
  chars: number;
  tokens: number;
  lines: number;
}

/** Exact [ENGRAM] + [ESR] blocks as injected into a session for one workspace. */
export interface InjectPreview {
  workspace: string;
  engram: string;
  esr: string;
  meta: {
    engram: BlockMeta;
    esr: BlockMeta;
    counts: { memories: number; tasks: number; links: number; nodes: number };
  };
}

/** Error carrying the route's JSON error message. */
export class EngramApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngramApiError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new EngramApiError(`HTTP ${response.status}: invalid JSON response`);
  }
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `HTTP ${response.status}`;
    throw new EngramApiError(message);
  }
  return body as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

export class EngramApi {
  async overview(): Promise<EngramOverview> {
    // NB: readJson expects a Response, not a Promise — always await fetch first.
    return readJson(await fetch(`${API_PREFIX}/overview`));
  }

  async memories(opts: { workspace?: string; q?: string; kind?: string; status?: string; limit?: number } = {}): Promise<{ items: MemoryRecord[] }> {
    return readJson(
      await fetch(`${API_PREFIX}/memories${query({ workspace: opts.workspace, q: opts.q, kind: opts.kind, status: opts.status, limit: opts.limit })}`),
    );
  }

  async tasks(workspace: string, includeStable = false): Promise<{ items: TaskRecord[] }> {
    return readJson(await fetch(`${API_PREFIX}/tasks${query({ workspace, includeStable: includeStable ? "1" : undefined })}`));
  }

  /** Real tool-call rollup over recent session logs (host /toolstats). */
  async toolStats(days = 14): Promise<ToolStats> {
    return readJson(await fetch(`${API_PREFIX}/toolstats?days=${days}`));
  }

  async createTask(workspace: string, name: string, description = ""): Promise<{ task: TaskRecord }> {
    return readJson(
      await fetch(`${API_PREFIX}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace, name, description }),
      }),
    );
  }

  async closeTask(
    workspace: string,
    id: string,
    evidence: { artifact?: string; evaluation?: string; memoryRefs?: string[] },
  ): Promise<{ ok: boolean; state: "active" | "stable"; gaps?: string[]; artifactReason?: string }> {
    return readJson(
      await fetch(`${API_PREFIX}/tasks/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace,
          id,
          artifact: evidence.artifact ?? "",
          evaluation: evidence.evaluation ?? "",
          memory_refs: evidence.memoryRefs ?? [],
        }),
      }),
    );
  }

  async links(workspace: string): Promise<{ items: LinkRecord[] }> {
    return readJson(await fetch(`${API_PREFIX}/links${query({ workspace })}`));
  }

  async nodes(workspace: string): Promise<{ items: EntityRecord[] }> {
    return readJson(await fetch(`${API_PREFIX}/nodes${query({ workspace })}`));
  }

  async observations(workspace: string): Promise<{ items: ObservationRecord[] }> {
    return readJson(await fetch(`${API_PREFIX}/observations${query({ workspace })}`));
  }

  async stats(workspace?: string): Promise<EngramStats> {
    return readJson(await fetch(`${API_PREFIX}/stats${query({ workspace })}`));
  }

  async config(): Promise<EngramConfig> {
    return readJson(await fetch(`${API_PREFIX}/config`));
  }

  async preview(workspace: string): Promise<InjectPreview> {
    return readJson(await fetch(`${API_PREFIX}/preview${query({ workspace })}`));
  }

  async archive(id: string, workspace: string): Promise<void> {
    await readJson(
      await fetch(`${API_PREFIX}/memories/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, workspace }),
      }),
    );
  }

  async remove(id: string, workspace: string): Promise<void> {
    await readJson(
      await fetch(`${API_PREFIX}/memories/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, workspace }),
      }),
    );
  }

  async gc(workspace: string | undefined, dryRun: boolean): Promise<{ report: GcReport }> {
    return readJson(
      await fetch(`${API_PREFIX}/gc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(workspace ? { workspace } : {}),
          dryRun,
        }),
      }),
    );
  }
}
