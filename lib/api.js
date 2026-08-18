/**
 * dsh-loom: read-mostly web API for the GUI (host half).
 *
 * A small same-origin JSON route family under `/api/dsh-loom`. Every route
 * wears the loopback-only trust fence (copied from the SSH family): these
 * routes expose the on-disk memory store, so a LAN-exposed dsh web must not
 * serve them. All reads go straight at the opened storage-domain handle
 * (synchronous after the first open); the two mutations (archive / delete)
 * go through the same store methods the agent tools use.
 */

/** Route family prefix (kept in sync with the client half). */
export const API_PREFIX = "/api/dsh-loom";

/** Cap on JSON request bodies (archives/deletes are tiny). */
const MAX_JSON_BODY_BYTES = 32 * 1024;

/** Loopback literal check plus browser same-origin markers. */
function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress;
  if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
  const host = request.headers.host;
  if (typeof host !== "string") return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "referrer-policy": "no-referrer" });
  res.end(payload);
}

function writeError(res, status, message) {
  writeJson(res, status, { error: message });
}

function readQuery(req) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  return url.searchParams;
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BODY_BYTES) {
        resolve({ error: "body too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (size === 0) {
        resolve({ value: {} });
        return;
      }
      try {
        resolve({ value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        resolve({ error: "invalid JSON body" });
      }
    });
    req.on("error", () => resolve({ error: "request error" }));
  });
}

/** Coarse token estimate for a [LOOM] index block (ASCII ≈ 4 chars/token). */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil([...text].length / 4));
}

/**
 * Build the route list for one plugin instance.
 * @param service - the loom service ({ config, getDomain, openedDomain, ensureDomain }).
 * @returns the routes to pass to `ctx.webServer.register(route)`.
 */
export function makeLoomRoutes(service) {
  const withDomain = async (res) => {
    const opened = service.openedDomain?.();
    if (opened !== void 0) return opened;
    try {
      return await service.getDomain();
    } catch (error) {
      writeError(res, 503, `loom storage unavailable: ${String(error?.message ?? error)}`);
      return void 0;
    }
  };

  const readConfig = (_req, res) => {
    const c = service.config ?? {};
    const payload = {
      autoCapture: c.autoCapture,
      sessionSearch: c.sessionSearch,
      autoCapturePerSession: c.autoCapturePerSession,
      indexMaxLines: c.indexMaxLines,
      indexMaxChars: c.indexMaxChars,
      minIndexSignal: c.minIndexSignal,
      promoteHits: c.promoteHits,
      expireDays: c.expireDays,
      maxMemoriesPerWorkspace: c.maxMemoriesPerWorkspace,
    };
    writeJson(res, 200, payload);
  };

  const overview = async (req, res) => {
    const domain = await withDomain(res);
    if (domain === void 0) return;
    const summary = domain.summarize();
    // [LOOM] index estimate: recompute the exact block cost per workspace.
    const indexes = {};
    for (const ws of Object.keys(summary.workspaces)) {
      const block = service.renderIndexBlock?.(ws) ?? "";
      indexes[ws] = { chars: [...block].length, tokens: estimateTokens(block), lines: block.split("\n").length - 1 };
    }
    writeJson(res, 200, {
      ...summary,
      indexes,
      captures: service.captureStats ?? { total: 0, git: 0, file: 0, error: 0 },
      gc: service.gcStats ?? { lastRun: 0, archivedMemories: 0, archivedTasks: 0, removedLinks: 0 },
      config: service.config ?? {},
      anonymous: {
        version: 2,
        note: "counts exclude archived/expired entries; tasks exclude stable.",
      },
    });
    void req;
  };

  const memories = async (req, res) => {
    const domain = await withDomain(res);
    if (domain === void 0) return;
    const params = readQuery(req);
    const items = domain.searchMemories({
      workspace: params.get("workspace") || void 0,
      q: params.get("q") || void 0,
      kind: params.get("kind") || void 0,
      status: params.get("status") || void 0,
      limit: Number(params.get("limit") ?? 100),
    });
    writeJson(res, 200, { items });
  };

  const tasks = async (req, res) => {
    const domain = await withDomain(res);
    if (domain === void 0) return;
    const params = readQuery(req);
    const workspace = params.get("workspace");
    if (!workspace) {
      writeError(res, 400, "workspace query parameter is required");
      return;
    }
    const includeStable = params.get("includeStable") === "1";
    writeJson(res, 200, { items: domain.listTasks(workspace, { includeStable }) });
  };

  const links = async (req, res) => {
    const domain = await withDomain(res);
    if (domain === void 0) return;
    const params = readQuery(req);
    const workspace = params.get("workspace");
    if (!workspace) {
      writeError(res, 400, "workspace query parameter is required");
      return;
    }
    writeJson(res, 200, { items: domain.allLinks(workspace) });
  };

  const archive = async (req, res) => {
    const domain = await withDomain(res);
    if (domain === void 0) return;
    const body = await readJsonBody(req);
    if (body.error) return writeError(res, 400, body.error);
    const { id, workspace } = body.value ?? {};
    if (typeof id !== "string" || typeof workspace !== "string") {
      return writeError(res, 400, "id and workspace are required");
    }
    try {
      const ok = await domain.archiveMemory(workspace, id);
      if (!ok) return writeError(res, 404, "memory not found or already archived");
      writeJson(res, 200, { ok: true });
    } catch (error) {
      writeError(res, 500, String(error?.message ?? error));
    }
  };

  const remove = async (req, res) => {
    const domain = await withDomain(res);
    if (domain === void 0) return;
    const body = await readJsonBody(req);
    if (body.error) return writeError(res, 400, body.error);
    const { id, workspace } = body.value ?? {};
    if (typeof id !== "string" || typeof workspace !== "string") {
      return writeError(res, 400, "id and workspace are required");
    }
    try {
      const ok = await domain.deleteMemory(workspace, id);
      if (!ok) return writeError(res, 404, "memory not found");
      writeJson(res, 200, { ok: true });
    } catch (error) {
      writeError(res, 500, String(error?.message ?? error));
    }
  };

  const gcRun = async (req, res) => {
    const domain = await withDomain(res);
    if (domain === void 0) return;
    const body = await readJsonBody(req);
    if (body.error) return writeError(res, 400, body.error);
    const { workspace, dryRun } = body.value ?? {};
    // Workspace optional -> sweep every workspace (same semantics as the tool).
    if (workspace !== void 0 && typeof workspace !== "string") {
      return writeError(res, 400, "workspace must be a string when provided");
    }
    try {
      const report = await domain.gc(
        workspace === void 0 || workspace.length === 0 ? void 0 : workspace,
        service.config ?? {},
        { dryRun: dryRun === true },
      );
      if (dryRun !== true) {
        service.gcStats ??= { lastRun: 0, archivedMemories: 0, archivedTasks: 0, removedLinks: 0 };
        service.gcStats.lastRun = Date.now();
        service.gcStats.archivedMemories += report.archivedMemories.length;
        service.gcStats.archivedTasks += report.archivedTasks.length;
        service.gcStats.removedLinks += report.removedLinks.length;
      }
      writeJson(res, 200, { report });
    } catch (error) {
      writeError(res, 500, String(error?.message ?? error));
    }
  };

  const guard = (req, res, method, handler) => {
    if ((req.method ?? "GET").toUpperCase() !== method) {
      writeError(res, 405, "method not allowed");
      return;
    }
    if (!isLoopbackRequest(req)) {
      writeError(res, 403, "loopback-only");
      return;
    }
    return handler(req, res);
  };

  const make = (method, path, handler) => ({
    kind: "exact",
    path: `${API_PREFIX}${path}`,
    handler: (req, res) => guard(req, res, method, handler),
  });

  return [
    make("GET", "/overview", overview),
    make("GET", "/memories", memories),
    make("GET", "/tasks", tasks),
    make("GET", "/links", links),
    make("GET", "/config", readConfig),
    make("POST", "/memories/archive", archive),
    make("POST", "/memories/delete", remove),
    make("POST", "/gc", gcRun),
  ];
}
