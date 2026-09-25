import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startRuntime } from "../../runtime/index.js";

test("production runtime establishes an HttpOnly local session and protects real files", async ({ page, context }) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "aurora-runtime-browser-"));
  const runtime = await startRuntime({ port: 0, stateDirectory: temporary, staticDirectory: path.resolve("dist") });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    // No route mocks: this is the compiled frontend talking to the real local server.
    await page.goto(runtime.origin);
    await expect(page.getByRole("button", { name: "新建研究", exact: false }).first()).toBeVisible();
    await expect.poll(async () => (await context.cookies(runtime.origin)).some((cookie) => cookie.name === "aurora_local_session" && cookie.httpOnly && cookie.sameSite === "Strict")).toBe(true);
    const result = await page.evaluate(async () => {
      const boot = await (await fetch("/fin-core/api/bootstrap")).json();
      const upload = await fetch("/fin-core/backend/upload", { method: "POST", headers: { "X-Filename": "browser-check.txt" }, body: "REAL_LOCAL_FILE" });
      const file = await upload.json();
      const read = await (await fetch(file.url)).text();
      const invalid = await fetch("/fin-core/workspace-api/upload", { method: "POST", headers: { "X-Filename": "..%2Foutside.txt" }, body: "no write" });
      return { engineReady: boot.runtime.researchReady, tokenExposed: "gatewayToken" in boot, uploadStatus: upload.status, read, invalidStatus: invalid.status };
    });
    expect(result).toEqual({ engineReady: false, tokenExposed: false, uploadStatus: 200, read: "REAL_LOCAL_FILE", invalidStatus: 400 });
    const rejected = await context.request.get(runtime.origin + "/fin-core/backend/files", { headers: { Origin: "https://outside.invalid" } });
    expect(rejected.status()).toBe(403);
    await page.reload();
    await expect(page.getByRole("button", { name: "新建研究", exact: false }).first()).toBeVisible();
    expect(await page.evaluate(async () => (await (await fetch("/fin-core/backend/files")).json()).files.length)).toBe(1);
    expect(errors).toEqual([]);
    await page.screenshot({ path: "artifacts/qa/standalone-runtime-shell.png", fullPage: true });
  } finally {
    await runtime.close();
    if (!path.resolve(temporary).startsWith(path.join(os.tmpdir(), "aurora-runtime-browser-"))) throw new Error("Unsafe test cleanup target");
    await rm(temporary, { recursive: true, force: true });
  }
});
