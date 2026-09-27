import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DataSourceStore } from "./store.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "aurora-data-settings-")); });
afterEach(async () => {
  if (!path.resolve(root).startsWith(path.join(os.tmpdir(), "aurora-data-settings-"))) throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});
it("keeps secrets out of views, isolates providers and reloads encrypted keys", async () => {
  const store = new DataSourceStore(root); await store.initialize();
  await store.save("fred", "fixture-fred-secret"); await store.save("eodhd", "fixture-eodhd-secret");
  expect(JSON.stringify(store.view())).not.toContain("fixture-");
  const restored = new DataSourceStore(root); await restored.initialize();
  expect(await restored.environment()).toEqual({ FRED_API_KEY: "fixture-fred-secret", EODHD_API_TOKEN: "fixture-eodhd-secret" });
  if (process.platform === "win32") expect(await readFile(path.join(root, "private/data-sources.json"), "utf8")).not.toContain("fixture-");
});
it("retains blank keys, excludes disabled keys and does not resurrect removed SEC", async () => {
  const store = new DataSourceStore(root); await store.initialize("Aurora user@example.com");
  await store.save("fred", "fixture-fred-secret"); await store.save("fred", "");
  await store.setEnabled("fred", false);
  expect(await store.environment()).toEqual({ SEC_EDGAR_USER_AGENT: "Aurora user@example.com" });
  await store.remove("sec");
  const restored = new DataSourceStore(root); await restored.initialize("Aurora user@example.com");
  expect(await restored.environment()).toEqual({});
  await restored.setEnabled("fred", true);
  expect(await restored.environment()).toEqual({ FRED_API_KEY: "fixture-fred-secret" });
});
it("validates credentials and invalidates a prior probe after a change", async () => {
  const store = new DataSourceStore(root); await store.initialize();
  await expect(store.save("sec", "not a contact")).rejects.toThrow();
  await expect(store.save("fred", "key\nheader")).rejects.toThrow();
  await store.save("fred", "fixture-first");
  await store.test("fred", async () => ({ ok: true, code: "ok", message: "连接测试通过", checkedAt: new Date().toISOString() }));
  expect(store.view().sources.find(s => s.id === "fred")?.lastTest?.ok).toBe(true);
  await store.save("fred", "fixture-replacement");
  expect(store.view().sources.find(s => s.id === "fred")?.lastTest).toBeUndefined();
});
