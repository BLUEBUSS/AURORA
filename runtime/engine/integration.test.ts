import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startRuntime } from "../server.js";
import { startProviderFixture } from "./provider-fixture.test-helper.js";

let temp: string;
let app: Awaited<ReturnType<typeof startRuntime>>;
let provider: Awaited<ReturnType<typeof startProviderFixture>>;
let headers: Record<string, string>;
const sockets: WebSocket[] = [];
beforeEach(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "aurora-engine-test-"));
  await mkdir(path.join(temp, "web")); await writeFile(path.join(temp, "web", "index.html"), "AURORA");
  provider = await startProviderFixture();
  app = await startRuntime({ port: 0, staticDirectory: path.join(temp, "web"), stateDirectory: path.join(temp, "state") });
  headers = { Origin: app.origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };
  const session = await fetch(app.origin + "/fin-core/api/local-session", { method: "POST", headers });
  headers.Cookie = session.headers.get("set-cookie")!.split(";")[0];
});
afterEach(async () => {
  for (const socket of sockets) socket.terminate(); sockets.length = 0;
  await app.close(); await provider.close();
  vi.unstubAllGlobals();
  if (!path.resolve(temp).startsWith(path.join(os.tmpdir(), "aurora-engine-test-"))) throw new Error("Unsafe cleanup target");
  await rm(temp, { recursive: true, force: true });
});
async function configure(apiKey = "fixture-own-key") {
  return fetch(app.origin + "/fin-core/api/model", { method: "POST", headers, body: JSON.stringify({ api: "openai-completions", baseUrl: provider.baseUrl, modelId: "fixture-model", apiKey }) });
}
async function connection() {
  const socket = new WebSocket(app.origin.replace("http:", "ws:") + "/fin-core/ws", { headers }); sockets.push(socket);
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let serial = 0;
  const challenge = new Promise<void>((resolve) => socket.on("message", (raw) => {
    const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
    if (frame.event === "connect.challenge") resolve();
    if (frame.type === "event") events.push(frame as typeof events[number]);
    if (frame.type === "res") { const p = pending.get(String(frame.id)); pending.delete(String(frame.id)); if (frame.ok) p?.resolve(frame.payload); else p?.reject(new Error(JSON.stringify(frame.error))); }
  }));
  await challenge;
  const rpc = <T = unknown>(method: string, params: object = {}) => new Promise<T>((resolve, reject) => {
    const id = `qa-${++serial}`; pending.set(id, { resolve: (value) => resolve(value as T), reject });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
  });
  await rpc("connect", { minProtocol: 3, maxProtocol: 3 });
  return { rpc, events };
}

it("requires a user model, rejects bad keys without echoing them, and saves no raw Windows key", async () => {
  const client = await connection();
  const key = `agent:main:webuser:${app.state.instanceId}:qa`;
  await expect(client.rpc("chat.send", { sessionKey: key, message: "hello", idempotencyKey: "no-key" })).rejects.toThrow("MODEL_REQUIRED");
  const failed = await configure("wrong-fixture-key");
  expect(failed.status).toBe(400); expect(await failed.text()).not.toContain("wrong-fixture-key");
  expect((await configure()).status).toBe(200);
  const view = await (await fetch(app.origin + "/fin-core/api/model", { headers })).text();
  expect(view).not.toContain("fixture-own-key"); expect(view).toContain("inherit-main");
  if (process.platform === "win32") expect(await readFile(path.join(temp, "state", "private", "model.json"), "utf8")).not.toContain("fixture-own-key");
});

it("runs the actual Pi loop with migrated task tools, child execution and persisted history", async () => {
  expect((await configure()).status).toBe(200);
  const upload = await (await fetch(app.origin + "/fin-core/backend/upload", { method: "POST", headers: { ...headers, "X-Filename": "evidence.txt" }, body: "FILE_EVIDENCE" })).json() as { path: string };
  const client = await connection(); const key = `agent:main:webuser:${app.state.instanceId}:research`;
  const params = { sessionKey: key, message: `Fixture research ATTACHMENT:${upload.path}`, idempotencyKey: "research-1" };
  expect(await client.rpc("chat.send", params)).toMatchObject({ status: "started" });
  await expect.poll(() => client.events.find((event) => event.event === "chat" && event.payload.state === "final"), { timeout: 20000 }).toBeTruthy();
  const toolNames = client.events.filter((event) => event.event === "agent" && event.payload.stream === "tool").map((event) => (event.payload.data as { name: string }).name);
  expect(toolNames).toEqual(expect.arrayContaining(["task_create", "read", "sessions_spawn", "task_update"]));
  expect(JSON.stringify(client.events)).toContain("CHILD_OK");
  const history = await client.rpc<{ messages: unknown[]; lastRun: { status: string } }>("chat.history", { sessionKey: key });
  expect(history.lastRun.status).toBe("ok");
  expect(JSON.stringify(history.messages)).toContain("MARKER_OK");
  expect(JSON.stringify(history.messages)).toContain("FILE_EVIDENCE");
  const calls = provider.stats().modelCalls;
  expect(await client.rpc("chat.send", params)).toMatchObject({ status: "ok" });
  expect(provider.stats().modelCalls).toBe(calls);
  expect(new Set(provider.stats().authorizations)).toEqual(new Set(["Bearer fixture-own-key"]));
  await expect(client.rpc("chat.history", { sessionKey: "agent:main:webuser:someone-else:qa" })).rejects.toThrow("SESSION_DENIED");
  await client.rpc("sessions.patch", { key, label: "Renamed QA", archived: true });
  await app.close();
  app = await startRuntime({ port: 0, staticDirectory: path.join(temp, "web"), stateDirectory: path.join(temp, "state") });
  headers = { Origin: app.origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };
  const session = await fetch(app.origin + "/fin-core/api/local-session", { method: "POST", headers });
  headers.Cookie = session.headers.get("set-cookie")!.split(";")[0];
  const restored = await connection();
  expect(await restored.rpc("sessions.list")).toMatchObject({ sessions: [{ key, derivedTitle: "Renamed QA", archived: true }] });
  expect(JSON.stringify(await restored.rpc("chat.history", { sessionKey: key }))).toContain("MARKER_OK");
  expect(provider.stats().modelCalls).toBe(calls);
});

it("stops a live stream and blocks changing credentials while research is active", async () => {
  expect((await configure()).status).toBe(200);
  const client = await connection(); const key = `agent:main:webuser:${app.state.instanceId}:stop`;
  await client.rpc("chat.send", { sessionKey: key, message: "STOP_CASE", idempotencyKey: "stop-1" });
  await expect.poll(() => JSON.stringify(client.events).includes("partial response"), { timeout: 10000 }).toBe(true);
  expect((await fetch(app.origin + "/fin-core/api/model", { method: "DELETE", headers })).status).toBe(409);
  expect((await fetch(app.origin + "/fin-core/api/data-sources", { method: "POST", headers, body: JSON.stringify({ id: "fred", action: "save", credential: "fixture-fred-key" }) })).status).toBe(409);
  expect(await client.rpc("chat.abort", { sessionKey: key, runId: "stop-1" })).toMatchObject({ aborted: true });
  expect(await client.rpc("chat.history", { sessionKey: key })).toMatchObject({ lastRun: { status: "aborted" } });
  await expect.poll(() => client.events.some((event) => event.event === "chat" && event.payload.state === "aborted")).toBe(true);
  expect(client.events.find((event) => event.event === "chat" && event.payload.state === "aborted")?.payload).not.toHaveProperty("errorMessage");
  expect((await fetch(app.origin + "/fin-core/api/model", { method: "DELETE", headers })).status).toBe(200);
  expect((await (await fetch(app.origin + "/fin-core/api/model", { headers })).json() as { configured: boolean }).configured).toBe(false);
});

it("passes a saved user data key through the actual Agent tool loop without exposing it to the model", async () => {
  expect((await configure()).status).toBe(200);
  const realFetch = globalThis.fetch;
  const requests: string[] = [];
  vi.stubGlobal("fetch", ((input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "api.stlouisfed.org") {
      requests.push(url.searchParams.get("api_key") || "");
      return Promise.resolve(new Response(JSON.stringify({ observations: [{ date: "2026-01-01", value: "321.75" }] })));
    }
    return realFetch(input, init);
  }) as typeof fetch);
  expect((await fetch(app.origin + "/fin-core/api/data-sources", { method: "POST", headers, body: JSON.stringify({ id: "fred", action: "save", credential: "fixture-fred-only" }) })).status).toBe(200);
  const client = await connection();
  const sessionKey = `agent:main:webuser:${app.state.instanceId}:data-source-run`;
  await client.rpc("chat.send", { sessionKey, message: "DATA_SOURCE_CASE", idempotencyKey: "data-run" });
  await expect.poll(() => client.events.some(e => e.event === "chat" && e.payload.state === "final"), { timeout: 15000 }).toBe(true);
  expect(requests).toEqual(["fixture-fred-only"]);
  const history = JSON.stringify(await client.rpc("chat.history", { sessionKey }));
  expect(history).toContain("321.75"); expect(history).not.toContain("fixture-fred-only");
  expect(JSON.stringify(client.events)).not.toContain("fixture-fred-only");
  expect(new Set(provider.stats().authorizations)).toEqual(new Set(["Bearer fixture-own-key"]));
});
