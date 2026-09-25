import { test, expect } from "@playwright/test";
import { openWorkspacePage } from "./navigation";

test("an attachment finishing after navigation stays with its original conversation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^NVDA 的增长/ }).click();
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      await new Promise<void>((resolve) => {
        (window as Window & { releaseFileRead?: () => void }).releaseFileRead = resolve;
      });
      return original.call(this);
    };
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "QA-NVDA-only.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# NVIDIA attachment"),
  });
  await page.getByRole("button", { name: /^AMD：竞争格局/ }).click();
  await page.evaluate(() => {
    (window as Window & { releaseFileRead?: () => void }).releaseFileRead?.();
  });
  await expect(page.getByText("QA-NVDA-only.md", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^NVDA 的增长/ }).click();
  await expect(page.getByText("QA-NVDA-only.md", { exact: true })).toBeVisible();
});

test("quota failure keeps imported and edited text recoverable without claiming it was saved", async ({ page }) => {
  await page.goto("/");
  await openWorkspacePage(page, "文件");
  const quotaName = await page.evaluate(() => {
    const block = "x".repeat(100000);
    try {
      for (let index = 0; index < 100; index++) localStorage.setItem(`qa-fill-${index}`, block);
    } catch (error) {
      return (error as DOMException).name;
    }
    return "";
  });
  expect(quotaName).toBe("QuotaExceededError");
  await page.locator("input[type=file]").setInputFiles({
    name: "QA-quota.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# QA quota\n" + "x".repeat(490000)),
  });
  await expect(page.getByRole("status")).toContainText("文件仅在当前页面保留");
  expect(await page.evaluate(() => (localStorage.getItem("aurora-demo-v1") || "").includes("QA-quota.md"))).toBe(false);
  await page.getByRole("button", { name: /^QA-quota.md/ }).click();
  await expect(page.locator(".reader footer")).toContainText("有未保存修改");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "编辑文件内容" });
  await editor.fill("# Updated QA quota\n" + "y".repeat(490000));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(page.getByRole("status")).toContainText("保存未成功");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "保留文件修改？" });
  await confirmation.getByRole("button", { name: "保存并返回" }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "关闭对话框" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("QA-quota.md");
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith("qa-fill-")) localStorage.removeItem(key);
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator(".reader footer")).toContainText("已保存");
  await page.reload();
  await openWorkspacePage(page, "文件");
  await page.getByRole("button", { name: /^QA-quota.md/ }).click();
  await expect(page.getByRole("heading", { name: "Updated QA quota", exact: true })).toBeVisible();
});

test("opening a live conversation from its project fetches backend history", async ({ page }) => {
  const requests: string[] = [];
  const sessionKey = "agent:main:webuser:qa:antlyst-project-history";
  await page.route("**/fin-core/api/bootstrap", (route) => route.fulfill({ json: {
    gatewayToken: "fixture-only",
    agentNameMap: { main: "QA" },
    currentUser: { id: "qa", agentId: "main", allowedAgents: ["main"] },
  } }));
  await page.routeWebSocket("**/fin-core/ws", (ws) => {
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { id: string; method: string };
      requests.push(frame.method);
      const respond = (payload: unknown) => ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload }));
      if (frame.method === "connect") respond({ type: "hello-ok", protocol: 3 });
      else if (frame.method === "sessions.list") respond({ sessions: [{ key: sessionKey, derivedTitle: "QA persisted history", updatedAt: 1 }] });
      else if (frame.method === "models.list") respond({ models: [] });
      else if (frame.method === "chat.history") respond({ messages: [
        { role: "user", content: "QA old question" },
        { role: "assistant", content: "QA actual saved answer" },
      ] });
      else respond({});
    });
    ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "qa" } }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "本地演示", exact: true }).click();
  await page.getByRole("button", { name: "连接现有后端", exact: true }).click();
  await expect(page.getByRole("button", { name: "已连接", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("QA project");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("button", { name: "管理 QA persisted history", exact: true }).click();
  await page.getByRole("combobox", { name: "归入项目" }).selectOption({ label: "QA project" });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await openWorkspacePage(page, "项目");
  await page.locator(".project-title").click();
  await page.locator(".project-session-list .page-row-main").click();
  await expect(page.getByText("QA actual saved answer", { exact: true })).toBeVisible();
  expect(requests).toContain("chat.history");
  expect(requests).not.toContain("chat.send");
});
