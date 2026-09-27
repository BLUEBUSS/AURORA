import { createServer } from "node:http";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeState } from "./state.js";
import { LocalAccess, responseHeaders } from "./security.js";
import { json, method, reportError } from "./http.js";
import { WorkspaceFiles, resolveSafePath } from "./files/index.js";
import { fileRoutes } from "./file-routes.js";
import { serveStatic } from "./static.js";
import { HttpError } from "./errors.js";
import { ModelStore } from "./models/index.js";
import { modelRoutes } from "./models/routes.js";
import { ResearchEngine, attachResearchGateway } from "./engine/index.js";
import { DataSourceStore, dataSourceRoutes, createDataProbe, type DataProbe } from "./data-sources/index.js";

export interface RuntimeOptions { port?: number; stateDirectory?: string; staticDirectory?: string; dataSourceProbe?: DataProbe }

export async function startRuntime(options: RuntimeOptions = {}) {
  const port = options.port ?? 5174;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port.");
  const staticDirectory = options.staticDirectory ?? fileURLToPath(new URL("../dist", import.meta.url));
  await access(path.join(staticDirectory, "index.html"));
  const state = await initializeState(options.stateDirectory);
  const workspaceRoot = await resolveSafePath(state.root, "workspace/main", true);
  const files = new WorkspaceFiles(workspaceRoot);
  await files.initialize();
  const models = new ModelStore(state.root);
  await models.initialize();
  const sources = new DataSourceStore(state.root);
  await sources.initialize(models.view().model?.secUserAgent);
  const probe = options.dataSourceProbe ?? createDataProbe();
  const research = new ResearchEngine(state.root, state.instanceId, models, files, sources);
  await research.initialize();
  let origin = "";
  let security: LocalAccess;
  const server = createServer(async (req, res) => {
    responseHeaders(res);
    try {
      const url = new URL(req.url || "/", origin);
      if (url.origin !== origin) throw new HttpError(403, "ORIGIN_DENIED", "无效的服务地址。");
      const api = url.pathname.startsWith("/fin-core/") || url.pathname.startsWith("/api/");
      security.checkRequest(req, !api && ["GET", "HEAD"].includes(req.method || ""));
      if (url.pathname === "/healthz") {
        method(req, ["GET"]);
        json(res, 200, { ok: true, service: "aurora-runtime", researchReady: true, modelConfigured: models.view().configured });
        return;
      }
      if (url.pathname === "/fin-core/api/local-session") {
        method(req, ["POST"]);
        security.createSession(req, res);
        json(res, 200, { ok: true });
        return;
      }
      if (url.pathname.startsWith("/fin-core/") || url.pathname.startsWith("/api/")) {
        security.requireSession(req);
        if (url.pathname === "/fin-core/api/bootstrap") {
          method(req, ["GET"]);
          json(res, 200, {
            agentNameMap: { main: "AURORA" },
            currentUser: { id: state.instanceId, username: "本机工作区", agentId: "main", allowedAgents: ["main"] },
            runtime: { kind: "aurora", researchReady: true, setupRequired: !models.view().configured },
          });
          return;
        }
        if (await modelRoutes(req, res, url, models, () => research.busy)) return;
        if (await dataSourceRoutes(req, res, url, sources, models, () => research.busy, probe)) return;
        if (url.pathname === "/fin-core/backend/auth/logout") {
          method(req, ["POST"]);
          security.revoke(req, res);
          json(res, 200, { ok: true });
          return;
        }
        if (await fileRoutes(req, res, url, files)) return;
        throw new HttpError(404, "NOT_AVAILABLE", "此接口尚未提供。");
      }
      await serveStatic(req, res, url, staticDirectory);
    } catch (error) { reportError(res, error); }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  const closeResearch = attachResearchGateway(server, () => security, research);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { reject(new Error("No local address.")); return; }
      origin = `http://127.0.0.1:${address.port}`;
      security = new LocalAccess(origin);
      server.off("error", reject);
      resolve();
    });
  });
  return {
    origin, state,
    close: async () => { await closeResearch(); await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }); },
  };
}
