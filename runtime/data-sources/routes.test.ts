import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startRuntime } from "../server.js";
import type { DataProbe } from "./catalog.js";

let root: string; let app: Awaited<ReturnType<typeof startRuntime>>; let headers: Record<string, string>;
const probe = vi.fn<DataProbe>();
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "aurora-source-routes-"));
  await mkdir(path.join(root, "web")); await writeFile(path.join(root, "web/index.html"), "AURORA");
  probe.mockReset(); probe.mockResolvedValue({ ok: true, code: "ok", message: "测试通过", checkedAt: new Date().toISOString() });
  app = await startRuntime({ port: 0, stateDirectory: path.join(root, "state"), staticDirectory: path.join(root, "web"), dataSourceProbe: probe });
  headers = { Origin: app.origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };
  const session = await fetch(app.origin + "/fin-core/api/local-session", { method: "POST", headers });
  headers.Cookie = session.headers.get("set-cookie")!.split(";")[0];
});
afterEach(async () => { await app.close(); if (!path.resolve(root).startsWith(path.join(os.tmpdir(), "aurora-source-routes-"))) throw new Error("Unsafe cleanup"); await rm(root, { recursive: true, force: true }); });
const action = (body: object) => fetch(app.origin + "/fin-core/api/data-sources", { method: "POST", headers, body: JSON.stringify(body) });
it("requires a local session and origin, saves without network calls, and probes only explicitly", async () => {
  expect((await fetch(app.origin + "/fin-core/api/data-sources")).status).toBe(401);
  expect((await fetch(app.origin + "/fin-core/api/data-sources", { method: "POST", headers: { ...headers, Origin: "https://outside.invalid" }, body: "{}" })).status).toBe(403);
  const saved = await action({ id: "fred", action: "save", credential: "fixture-private-key" });
  expect(saved.status).toBe(200); expect(await saved.text()).not.toContain("fixture-private-key"); expect(probe).not.toHaveBeenCalled();
  expect((await action({ id: "fred", action: "test" })).status).toBe(200);
  expect(probe).toHaveBeenCalledExactlyOnceWith("fred", "fixture-private-key");
  expect((await action({ id: "unknown", action: "save", credential: "fixture-private-key" })).status).toBe(400);
});
it("serializes model edits against data probes", async () => {
  await action({ id: "fred", action: "save", credential: "fixture-private-key" });
  let finish!: (value: Awaited<ReturnType<DataProbe>>) => void;
  probe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const testing = action({ id: "fred", action: "test" });
  await expect.poll(() => probe.mock.calls.length).toBe(1);
  expect((await action({ id: "fred", action: "remove" })).status).toBe(409);
  expect((await fetch(app.origin + "/fin-core/api/model", { method: "DELETE", headers })).status).toBe(409);
  finish({ ok: true, code: "ok", message: "测试通过", checkedAt: new Date().toISOString() }); await testing;
  expect((await action({ id: "fred", action: "remove" })).status).toBe(200);
});
