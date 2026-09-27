import { test, expect } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startRuntime } from "../../runtime/index.js";
import { startProviderFixture } from "../../runtime/engine/provider-fixture.test-helper.js";

test("first-run model configuration drives independent research, attachments and history", async ({ page }) => {
  test.setTimeout(60000);
  const directory = await mkdtemp(path.join(os.tmpdir(), "aurora-byok-browser-"));
  const provider = await startProviderFixture();
  const runtime = await startRuntime({ port: 0, stateDirectory: directory, staticDirectory: path.resolve("dist") });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(runtime.origin);
    const dialog = page.getByRole("dialog", { name: "工作台设置" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "模型", exact: true })).toHaveAttribute("aria-selected", "true");
    await dialog.getByLabel("服务地址（Base URL）").fill(provider.baseUrl);
    await dialog.getByLabel("模型名称", { exact: true }).fill("fixture-model");
    await dialog.getByLabel("API Key", { exact: true }).fill("fixture-own-key");
    await dialog.getByRole("button", { name: "测试并保存" }).click();
    await expect(dialog.getByRole("status")).toContainText("连接测试通过", { timeout: 25000 });
    await expect(dialog.getByLabel("API Key", { exact: true })).toHaveValue("");
    await page.screenshot({ path: "artifacts/qa/byok-settings.png", fullPage: true });
    await dialog.getByRole("button", { name: "关闭对话框" }).click();
    const attached = await page.evaluate(async () => {
      const response = await fetch("/fin-core/backend/upload", { method: "POST", headers: { "X-Filename": "proof.txt" }, body: "FILE_EVIDENCE" });
      return await response.json() as { path: string };
    });
    await page.getByPlaceholder("输入研究问题…").fill(`Fixture research ATTACHMENT:${attached.path}`);
    await page.getByRole("button", { name: "发送研究问题", exact: true }).click();
    await expect(page.getByText("MARKER_OK — research and child tools finished.", { exact: false })).toBeVisible({ timeout: 25000 });
    await page.reload();
    await expect(page.getByText("MARKER_OK — research and child tools finished.", { exact: false })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /Fixture report.md/ }).first()).toBeVisible();
    await page.getByRole("button", { name: /Fixture report.md/ }).first().click();
    await expect(page.getByRole("heading", { name: "Verified report" })).toBeVisible();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    const browserStorage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(browserStorage).not.toContain("fixture-own-key");
    if (process.platform === "win32") expect(await readFile(path.join(directory, "private", "model.json"), "utf8")).not.toContain("fixture-own-key");
    expect(errors).toEqual([]);
    await page.screenshot({ path: "artifacts/qa/byok-research.png", fullPage: true });
    const calls = provider.stats().modelCalls;
    await page.getByRole("button", { name: "新建研究", exact: false }).first().click();
    await page.getByPlaceholder("输入研究问题…").fill("STOP_CASE");
    await page.getByRole("button", { name: "发送研究问题", exact: true }).click();
    await expect.poll(() => provider.stats().modelCalls > calls).toBe(true);
    // A new tab/reload can recover a running backend session without tab-local tracking.
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.getByRole("button", { name: "停止研究", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "停止研究", exact: true }).click();
    await expect(page.getByText("已停止", { exact: false }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("已停止", { exact: false }).first()).toBeVisible();
  } finally {
    await runtime.close(); await provider.close();
    if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), "aurora-byok-browser-"))) throw new Error("Unsafe cleanup target");
    await rm(directory, { recursive: true, force: true });
  }
});
