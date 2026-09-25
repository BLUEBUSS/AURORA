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

export interface RuntimeOptions { port?: number; stateDirectory?: string; staticDirectory?: string }

export async function startRuntime(options: RuntimeOptions = {}) {
  const port = options.port ?? 5174;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port.");
  const staticDirectory = options.staticDirectory ?? fileURLToPath(new URL("../dist", import.meta.url));
  await access(path.join(staticDirectory, "index.html"));
  const state = await initializeState(options.stateDirectory);
  const workspaceRoot = await resolveSafePath(state.root, "workspace/main", true);
  const files = new WorkspaceFiles(workspaceRoot);
  await files.initialize();
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
        json(res, 200, { ok: true, service: "aurora-runtime", researchReady: false });
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
            runtime: { kind: "aurora", researchReady: false, setupRequired: true },
          });
          return;
        }
        if (url.pathname === "/fin-core/backend/auth/logout") {
          method(req, ["POST"]);
          security.revoke(req, res);
          json(res, 200, { ok: true });
          return;
        }
        if (await fileRoutes(req, res, url, files)) return;
        throw new HttpError(503, "RESEARCH_NOT_READY", "本机服务已启动，研究引擎接入尚未完成。");
      }
      await serveStatic(req, res, url, staticDirectory);
    } catch (error) { reportError(res, error); }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.on("upgrade", (req, socket) => {
    try { security.requireSession(req); socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"); }
    catch { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); }
  });
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
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
