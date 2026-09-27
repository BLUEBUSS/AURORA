import { test, expect } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { startRuntime } from "../../runtime/index.js";

test("data source UI saves privately, explicitly tests, disables, reloads and removes", async ({ page }) => {
  test.setTimeout(60000);
  const root = await mkdtemp(path.join(os.tmpdir(), "aurora-sources-browser-"));
  const probes: Array<{ id: string; credential: string }> = [];
  const runtime = await startRuntime({ port: 0, stateDirectory: root, staticDirectory: path.resolve("dist"), dataSourceProbe: async (id, credential) => {
    probes.push({ id, credential });
    if (probes.length === 1) return { ok: false, code: "rate_limited", message: "测试供应商暂时限流，请稍后重试。", checkedAt: new Date().toISOString() };
    return { ok: true, code: "ok", message: "已取得测试样本数据。", checkedAt: new Date().toISOString() };
  } });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(runtime.origin);
    const dialog = page.getByRole("dialog", { name: "工作台设置" });
    await dialog.getByRole("tab", { name: "数据源", exact: true }).click();
    const card = dialog.locator(".data-source-card").filter({ has: page.locator("summary strong", { hasText: /^FRED$/ }) });
    await card.locator("summary").click();
    await card.getByLabel("FRED · API Key").fill("fixture-user-fred");
    await card.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(card.getByRole("status")).toContainText("已保存");
    expect(probes).toEqual([]);
    await expect(card.getByLabel("FRED · API Key")).toHaveValue("");
    await card.getByRole("button", { name: "测试已保存配置" }).click();
    await expect(card.getByRole("status")).toContainText("限流");
    await expect(card.locator("summary")).toContainText("上次测试失败");
    await card.getByRole("button", { name: "测试已保存配置" }).click();
    await expect(card.getByRole("status")).toContainText("测试样本");
    expect(probes).toEqual([{ id: "fred", credential: "fixture-user-fred" }, { id: "fred", credential: "fixture-user-fred" }]);
    await card.getByRole("button", { name: "停用", exact: true }).click();
    await expect(card.locator("summary")).toContainText("已停用");
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("fixture-user-fred");
    if (process.platform === "win32") expect(await readFile(path.join(root, "private/data-sources.json"), "utf8")).not.toContain("fixture-user-fred");
    await page.screenshot({ path: "artifacts/qa/data-sources-light.png" });
    await page.reload();
    await dialog.getByRole("tab", { name: "数据源", exact: true }).click();
    await expect(card.locator("summary")).toContainText("已停用");
    await card.locator("summary").click();
    await card.getByRole("button", { name: "启用", exact: true }).click();
    await expect(card.locator("summary")).toContainText("上次测试通过");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.waitForTimeout(700); // Let the intentional theme transition settle before capturing.
    await page.screenshot({ path: "artifacts/qa/data-sources-dark.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "artifacts/qa/data-sources-mobile.png" });
    await card.getByRole("button", { name: "移除凭据" }).click();
    await expect(card.locator("summary")).toContainText("未配置");
    await expect(card.getByRole("button", { name: "测试已保存配置" })).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    await runtime.close();
    if (!path.resolve(root).startsWith(path.join(os.tmpdir(), "aurora-sources-browser-"))) throw new Error("Unsafe cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
