import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { request } from "node:http";
import { startRuntime } from "./server.js";
import { defaultStateDirectory } from "./state.js";

let directory: string;
let app: Awaited<ReturnType<typeof startRuntime>>;
let cookie = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "aurora-http-test-"));
  await mkdir(path.join(directory, "web"));
  await writeFile(path.join(directory, "web", "index.html"), "<!doctype html><title>AURORA</title>");
  app = await startRuntime({ port: 0, stateDirectory: path.join(directory, "state"), staticDirectory: path.join(directory, "web") });
  cookie = "";
});
afterEach(async () => {
  await app.close();
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), "aurora-http-test-"))) throw new Error("Unsafe test cleanup target");
  await rm(directory, { recursive: true, force: true });
});
function headers(extra: Record<string, string> = {}) {
  return { Origin: app.origin, "Sec-Fetch-Site": "same-origin", ...(cookie ? { Cookie: cookie } : {}), ...extra };
}
async function login() {
  const response = await fetch(`${app.origin}/fin-core/api/local-session`, { method: "POST", headers: headers() });
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie") || "";
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Strict");
  cookie = setCookie.split(";")[0];
}

it("serves the production shell without authentication while protecting every private API", async () => {
  const page = await fetch(app.origin);
  expect(await page.text()).toContain("AURORA");
  expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  for (const route of ["/fin-core/api/bootstrap", "/fin-core/backend/files", "/fin-core/workspace-api/download?path=x.txt"]) {
    expect((await fetch(app.origin + route)).status).toBe(401);
  }
  expect((await fetch(app.origin + "/healthz")).status).toBe(200);
});

it("denies external origins and unauthenticated preflight; no wildcard CORS", async () => {
  for (const method of ["POST", "OPTIONS"]) {
    const response = await fetch(app.origin + "/fin-core/api/local-session", {
      method, headers: { Origin: "https://outside.invalid", "Sec-Fetch-Site": "cross-site" },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  }
  expect((await fetch(app.origin + "/fin-core/api/local-session", { method: "POST" })).status).toBe(403);
});

it("rejects a forged Host even on a loopback socket", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(app.origin, { headers: { Host: "evil.invalid" } }, (res) => { res.resume(); resolve(res.statusCode || 0); });
    req.on("error", reject); req.end();
  });
  expect(status).toBe(403);
});

it("returns no model or gateway secret and reports the research engine as not ready", async () => {
  await login();
  const response = await fetch(app.origin + "/fin-core/api/bootstrap", { headers: headers() });
  const data = await response.json() as { currentUser: { id: string }; runtime: object };
  expect(data.currentUser.id).toBe(app.state.instanceId);
  expect(data.runtime).toEqual({ kind: "aurora", researchReady: false, setupRequired: true });
  expect(data).not.toHaveProperty("gatewayToken");
  expect((await fetch(app.origin + "/fin-core/api/models", { headers: headers() })).status).toBe(503);
});

it("uploads and downloads actual files behind the local session", async () => {
  await login();
  const uploaded = await fetch(app.origin + "/fin-core/backend/upload", {
    method: "POST", headers: headers({ "X-Filename": encodeURIComponent("研究.md") }), body: "AURORA fixture text",
  });
  expect(uploaded.status).toBe(200);
  const data = await uploaded.json() as { url: string };
  const read = await fetch(app.origin + data.url, { headers: headers() });
  expect(await read.text()).toBe("AURORA fixture text");
  expect(read.headers.get("content-type")).toContain("text/plain");
  const listed = await (await fetch(app.origin + "/fin-core/backend/files", { headers: headers() })).json() as { files: unknown[] };
  expect(listed.files).toHaveLength(1);
});

it.each(["..%2Fescaped.txt", "..%5Cescaped.txt", "%ZZ", "C%3A%5Cescaped.txt"])("rejects the raw upload name %s without writes", async (name) => {
  await login();
  const result = await fetch(app.origin + "/fin-core/workspace-api/upload", {
    method: "POST", headers: headers({ "X-Filename": name }), body: "no write",
  });
  expect(result.status).toBe(400);
  expect(await readdir(path.join(app.state.root, "workspace", "main", "imports"))).toEqual([]);
});

it("revokes a cookie after logout and refuses state changes without Origin", async () => {
  await login();
  expect((await fetch(app.origin + "/fin-core/backend/upload", { method: "POST", headers: { Cookie: cookie, "X-Filename": "x.txt" }, body: "no" })).status).toBe(403);
  expect((await fetch(app.origin + "/fin-core/backend/auth/logout", { method: "POST", headers: headers() })).status).toBe(200);
  expect((await fetch(app.origin + "/fin-core/api/bootstrap", { headers: headers() })).status).toBe(401);
});

it("does not read old backend state and preserves its own identity across restarts", async () => {
  await login();
  expect(defaultStateDirectory({ LOCALAPPDATA: directory, OPENCLAW_STATE_DIR: "unused" }, "win32")).toBe(path.join(directory, "Aurora"));
  const first = app.state.instanceId;
  await app.close();
  app = await startRuntime({ port: 0, stateDirectory: path.join(directory, "state"), staticDirectory: path.join(directory, "web") });
  expect(app.state.instanceId).toBe(first);
  expect((await fetch(app.origin + "/fin-core/api/bootstrap", { headers: headers() })).status).toBe(401);
  expect(JSON.parse(await readFile(path.join(app.state.root, "instance.json"), "utf8"))).not.toHaveProperty("apiKey");
});

it("fails cleanly on an occupied port without stopping the original listener", async () => {
  await expect(startRuntime({ port: Number(new URL(app.origin).port), stateDirectory: path.join(directory, "other-state"), staticDirectory: path.join(directory, "web") })).rejects.toMatchObject({ code: "EADDRINUSE" });
  expect((await fetch(app.origin + "/healthz")).status).toBe(200);
});
