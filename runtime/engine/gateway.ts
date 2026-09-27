import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { LocalAccess } from "../security.js";
import { HttpError } from "../errors.js";
import type { ResearchEngine } from "./runner.js";

export function attachResearchGateway(server: Server, access: () => LocalAccess, engine: ResearchEngine) {
  const ws = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const admitted = new Set<WebSocket>();
  const requests = new Map<WebSocket, import("node:http").IncomingMessage>();
  engine.setPublish((event, payload) => {
    const message = JSON.stringify({ type: "event", event, payload });
    for (const client of admitted) {
      try { access().requireSession(requests.get(client)!); } catch { client.close(1008, "Session expired"); continue; }
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > 4 * 1024 * 1024) { client.close(1013, "Client too slow"); continue; }
      client.send(message);
    }
  });
  server.on("upgrade", (request, socket, head) => {
    try {
      if (request.url !== "/fin-core/ws") throw new Error("Unknown socket");
      access().requireSession(request);
      ws.handleUpgrade(request, socket, head, (client) => ws.emit("connection", client, request));
    } catch { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); }
  });
  ws.on("connection", (client, request) => {
    requests.set(client, request);
    let connected = false;
    const deadline = setTimeout(() => client.close(1008, "Handshake required"), 10000);
    client.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { protocol: 3 } }));
    client.on("close", () => { admitted.delete(client); requests.delete(client); clearTimeout(deadline); });
    client.on("error", () => { admitted.delete(client); });
    client.on("message", (raw) => {
      void (async () => {
        let id: unknown;
        try {
          access().requireSession(request);
          const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
          id = frame.id;
          if (frame.type !== "req" || typeof id !== "string" || id.length > 160 || typeof frame.method !== "string" || !frame.params || typeof frame.params !== "object" || Array.isArray(frame.params)) throw new HttpError(400, "INVALID_REQUEST", "请求格式无效。");
          const params = frame.params as Record<string, unknown>;
          let payload: unknown;
          if (frame.method === "connect") {
            if (connected || params.minProtocol !== 3 || params.maxProtocol !== 3) throw new HttpError(400, "PROTOCOL_MISMATCH", "不支持的协议。");
            connected = true; clearTimeout(deadline); admitted.add(client);
            payload = { type: "hello-ok", protocol: 3 };
          } else {
            if (!connected) throw new HttpError(401, "HANDSHAKE_REQUIRED", "请先建立本机连接。");
            payload = await dispatch(engine, frame.method, params);
          }
          if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "res", id, ok: true, payload }));
        } catch (error) {
          const safe = error instanceof HttpError ? { code: error.code, message: error.message } : { code: "REQUEST_FAILED", message: "本机研究请求未能完成。" };
          if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "res", id: typeof id === "string" ? id : "invalid", ok: false, error: safe }));
        }
      })();
    });
  });
  return async () => { await engine.close(); for (const client of ws.clients) client.terminate(); await new Promise<void>((resolve) => ws.close(() => resolve())); };
}

async function dispatch(engine: ResearchEngine, method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "sessions.list": return { sessions: engine.sessions.list() };
    case "models.list": {
      const view = engine.models.view();
      return { models: view.model ? [{ id: view.model.modelId, name: view.model.modelId, provider: "aurora-user", contextWindow: view.model.contextWindow }] : [], defaultModel: view.model ? { provider: "aurora-user", model: view.model.modelId } : undefined };
    }
    case "sessions.patch":
      engine.sessions.validate(params.key);
      if (engine.sessionBusy(params.key)) throw new HttpError(409, "RUN_ACTIVE", "请先停止当前研究，再修改会话。");
      return engine.sessions.patch(params.key, params);
    case "chat.history": {
      engine.sessions.validate(params.sessionKey);
      const row = engine.sessions.get(params.sessionKey);
      const roundStates = row.messages.flatMap((message) => {
        if (message.role !== "user" || !("auroraRunId" in message) || typeof message.auroraRunId !== "string") return [];
        return [{ runId: message.auroraRunId, userTimestamp: message.timestamp, status: row.runs[message.auroraRunId] }];
      });
      return { sessionKey: row.key, messages: row.messages.slice(-500), roundStates, lastRun: roundStates.at(-1) };
    }
    case "chat.send": return engine.send(params);
    case "chat.abort": engine.sessions.validate(params.sessionKey); return engine.abort(params.sessionKey, typeof params.runId === "string" ? params.runId : undefined);
    case "agent.wait": return engine.wait(typeof params.runId === "string" ? params.runId : "");
    case "fin-core.provenance.resolve":
    case "fin-core.provenance.fetchData": {
      engine.sessions.validate(params.sessionKey);
      if (typeof params.provenanceId !== "string" || !/^p_[a-f\d]{4,32}$/i.test(params.provenanceId)) throw new HttpError(400, "INVALID_SOURCE", "来源标识无效。");
      const entry = engine.sessions.get(params.sessionKey).evidence?.[String(params.provenanceId)];
      if (!entry) throw new HttpError(404, "SOURCE_NOT_FOUND", "此会话没有该来源记录。");
      const { records, ...summary } = entry;
      return method.endsWith("fetchData") ? { records, totalRows: Array.isArray(records) ? records.length : 0 } : summary;
    }
    default: throw new HttpError(404, "METHOD_NOT_AVAILABLE", "此研究方法尚未提供。");
  }
}
