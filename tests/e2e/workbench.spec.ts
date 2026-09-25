import { openWorkspacePage } from "./navigation";
import { test, expect, type Page } from "@playwright/test";
async function seedResearch(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^NVDA 的增长/ }).click();
}
test("welcome stays minimal; theme follows system and manual choice survives reload", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("complementary", { name: "研究资料" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "研究问题" })).toBeVisible();
  await page.getByRole("button", { name: "切换日间主题" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: "artifacts/qa/welcome-light.png", animations: "disabled" });
});
test("send control becomes a square stop; next draft survives stop and requires manual send", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "研究问题" });
  await input.fill("NVDA 的需求持续性");
  await input.press("Enter");
  const stop = page.getByRole("button", { name: "停止研究", exact: true });
  await expect(stop).toBeVisible();
  await expect(stop.locator("svg.lucide-square")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "发送研究问题" })).toHaveCount(0);
  await input.fill("下一轮需要保留的草稿");
  await input.press("Enter");
  await expect(stop).toBeVisible();
  await page.screenshot({ path: "artifacts/qa/research-running.png", animations: "disabled" });
  await stop.click();
  await expect(input).toHaveValue("下一轮需要保留的草稿");
  await expect(page.getByRole("button", { name: "发送研究问题" })).toBeVisible();
  await expect(page.locator(".user-message")).toHaveCount(1);
  await page.getByRole("button", { name: "发送研究问题" }).click();
  await expect(page.locator(".user-message")).toHaveCount(2);
  await expect(input).toHaveValue("");
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
});
test("completion preserves draft; sources first, process folded and manual reopen persists", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "研究问题" });
  await input.fill("NVDA 研究");
  await input.press("Enter");
  await input.fill("完成后仍保留");
  await page.getByRole("button", { name: "研究过程", exact: true }).click();
  await expect(
    page.locator(
      ".process-section .research-execution, .process-section .research-execution-empty",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "发送研究问题" })).toBeVisible({ timeout: 12000 });
  await expect(input).toHaveValue("完成后仍保留");
  await expect(page.locator(".process-section .research-execution")).toHaveCount(0);
  await expect(page.locator(".evidence-scroll > section").first()).toContainText("参考入口");
  await page.getByRole("button", { name: "研究过程", exact: true }).click();
  await input.fill("修改草稿");
  await expect(page.locator(".process-section .research-execution")).toBeVisible();
  await expect(page.locator(".user-message")).toHaveCount(1);
});
test("demo failure keeps draft and output; retry does not overwrite a next draft", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "研究问题" });
  await input.fill("AMD 研究");
  await input.press("Enter");
  await expect(page.locator(".assistant-message .markdown")).toBeVisible();
  await input.fill("失败后保留");
  await page.getByRole("button", { name: "本地演示", exact: true }).click();
  await page.getByRole("tab", { name: "演示检查", exact: true }).click();
  await page.getByRole("button", { name: "模拟当前研究失败" }).click();
  await expect(page.getByRole("alert")).toContainText("演示中断");
  await expect(input).toHaveValue("失败后保留");
  await page.getByRole("button", { name: "重试上一条" }).click();
  await expect(input).toHaveValue("失败后保留");
  await expect(page.locator(".user-message")).toHaveCount(1);
});
test("pane resize uses drag and keyboard, persists, and resets; dark surfaces stay neutral", async ({
  page,
}) => {
  await seedResearch(page);
  const left = page.getByRole("separator", { name: "调整左侧导航宽度" });
  await left.focus();
  await left.press("ArrowRight");
  await expect(left).toHaveAttribute("aria-valuenow", "224");
  const right = page.getByRole("separator", { name: "调整右侧资料宽度" });
  const box = (await right.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 30, box.y + 200);
  await page.mouse.up();
  await expect(right).toHaveAttribute("aria-valuenow", "322");
  await page.reload();
  await page.getByRole("button", { name: /^NVDA 的增长/ }).click();
  await expect(left).toHaveAttribute("aria-valuenow", "224");
  await right.dblclick();
  await expect(right).toHaveAttribute("aria-valuenow", "288");
  await page.getByRole("button", { name: "切换夜间主题" }).click();
  await expect(page.locator(".brand")).toHaveCSS("color", "rgb(223, 193, 127)");
  await expect(page.locator(".sidebar")).toHaveCSS("background-color", "rgb(26, 26, 26)");
  await page.screenshot({ path: "artifacts/qa/research-dark.png", animations: "disabled" });
});
test("file opens in main, edit and download work, return restores research draft and position", async ({
  page,
}) => {
  await seedResearch(page);
  const input = page.getByRole("textbox", { name: "研究问题" });
  await input.fill("阅读报告期间的草稿");
  await page.locator(".conversation-scroll").evaluate((el) => {
    el.scrollTop = 210;
  });
  await page.locator(".evidence-file").first().click();
  await expect(page.locator(".reader")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "主导航" })).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "编辑文件内容" });
  await editor.fill("# QA 报告\n\n已编辑的研究内容。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: "QA 报告" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载", exact: true }).click();
  expect((await download).suggestedFilename()).toContain(".md");
  await page.screenshot({ path: "artifacts/qa/report-reader.png", animations: "disabled" });
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(input).toHaveValue("阅读报告期间的草稿");
  expect(await page.locator(".conversation-scroll").evaluate((el) => el.scrollTop)).toBeGreaterThan(
    180,
  );
});
test("projects, text files, watchlist and reminders persist their actual local interactions", async ({
  page,
}) => {
  await page.goto("/");
  await openWorkspacePage(page, "项目");
  await page
    .locator(".page-content")
    .getByRole("button", { name: "新建项目", exact: true })
    .click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("QA 研究项目");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page.getByRole("heading", { name: "QA 研究项目" })).toBeVisible();
  await openWorkspacePage(page, "文件");
  await page.getByRole("button", { name: "新建文件", exact: true }).click();
  await page.getByRole("textbox", { name: "文件名" }).fill("QA 笔记");
  await page.getByRole("button", { name: "创建文件", exact: true }).click();
  await expect(page.locator(".reader-title")).toContainText("QA 笔记.md");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.locator(".page-content input[type=file]").setInputFiles({
    name: "QA-import.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("research file content"),
  });
  await expect(page.getByText("QA-import.txt", { exact: true })).toBeVisible();
  await openWorkspacePage(page, "自选");
  await page.getByRole("button", { name: "添加标的" }).click();
  await page.getByRole("textbox", { name: "代码", exact: true }).fill("NVDA");
  await page.getByRole("combobox", { name: "标的类型" }).selectOption("contract");
  await page.getByRole("button", { name: "添加自选", exact: true }).click();
  await expect(page.locator(".watch-row")).toHaveCount(5);
  await expect(page.locator(".watch-row").last()).toContainText("交易合约");
  await openWorkspacePage(page, "提醒");
  await page.getByRole("button", { name: "新建提醒", exact: true }).click();
  await page.getByRole("textbox", { name: "提醒名称" }).fill("QA 复盘");
  await page.getByRole("textbox", { name: "研究任务" }).fill("检查新增证据");
  await page.getByRole("button", { name: "保存提醒" }).click();
  await page.getByRole("button", { name: "启用 QA 复盘" }).click();
  await expect(page.locator(".reminder-card").first()).toContainText("已启用 · 演示");
  await page.reload();
  await openWorkspacePage(page, "提醒");
  await expect(page.getByRole("heading", { name: "QA 复盘" })).toBeVisible();
  await page.screenshot({ path: "artifacts/qa/reminders.png", animations: "disabled" });
});
test("mobile reading, drawers, report return and basic conversation fit without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "主导航" })).toHaveCount(0);
  await page.getByRole("button", { name: "展开导航" }).click();
  await page.getByRole("button", { name: /^NVDA 的增长/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "从算力需求，到兑现的利润" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/qa/mobile-light.png", animations: "disabled" });
  await page.getByRole("button", { name: "展开研究资料" }).click();
  await expect(page.getByRole("dialog", { name: "研究资料" })).toBeVisible();
  await page.locator(".evidence-file").first().click();
  await expect(page.locator(".reader")).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("textbox", { name: "研究问题" }).fill("手机基本对话");
  await page.getByRole("button", { name: "发送研究问题" }).click();
  await expect(page.getByRole("button", { name: "停止研究", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
  await page.getByRole("button", { name: "切换夜间主题" }).click();
  await page.screenshot({ path: "artifacts/qa/mobile-dark.png", animations: "disabled" });
});
test("all six pages render in both themes without console errors or layout overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("button", { name: "切换夜间主题" }).click();
    for (const label of ["项目", "文件", "报告", "自选", "提醒"]) {
      await openWorkspacePage(page, label);
      await expect(page.locator(".page-heading h1")).toHaveText(label);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `artifacts/qa/${label}-${theme}.png`, animations: "disabled" });
    }
  }
  expect(errors).toEqual([]);
});
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 430, height: 932 },
]) {
  test(`secondary viewport ${viewport.width} preserves reading and basic controls`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    if (viewport.width < 1100) await page.getByRole("button", { name: "展开导航" }).click();
    await page.getByRole("button", { name: /^NVDA 的增长/ }).click();
    await expect(page.getByRole("textbox", { name: "研究问题" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `artifacts/qa/research-${viewport.width}.png`,
      animations: "disabled",
    });
  });
}
