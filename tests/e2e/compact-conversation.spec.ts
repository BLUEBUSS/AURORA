import { test, expect } from "@playwright/test";
test("short user messages fit their content and long messages stay inside the reading column", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "研究问题" });
  await input.fill("1");
  await page.getByRole("button", { name: "发送研究问题" }).click();
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
  const short = (await page.locator(".user-message").boundingBox())!;
  expect(short.width).toBeLessThan(100);
  const reading = (await page.locator(".conversation").boundingBox())!;
  expect(short.x).toBeGreaterThan(reading.x + reading.width * 0.7);
  await input.fill("请分析这个很长的标识：" + "research".repeat(60));
  await page.getByRole("button", { name: "发送研究问题" }).click();
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
  expect(
    await page
      .locator(".user-message")
      .last()
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("composer grows for multiline and wrapped text, caps height, and shrinks after clearing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /^NVDA 的增长/ }).click();
  const input = page.getByRole("textbox", { name: "研究问题" });
  const form = page.locator(".composer");
  const initial = (await form.boundingBox())!.height;
  expect(initial).toBeLessThan(80);
  await input.fill("第一行");
  await input.press("Shift+Enter");
  await input.press("Shift+Enter");
  await input.press("Shift+Enter");
  await input.press("Shift+Enter");
  await expect.poll(async () => (await form.boundingBox())!.height).toBeGreaterThan(initial + 60);
  await input.fill("同一行长问题自动换行。".repeat(60));
  await expect.poll(() => input.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect((await form.boundingBox())!.height).toBeLessThan(280);
  const jump = (await page.getByRole("button", { name: "滚动到最新内容" }).boundingBox())!;
  const expanded = (await form.boundingBox())!;
  expect(jump.y + jump.height).toBeLessThan(expanded.y);
  await input.fill("");
  await expect.poll(async () => (await form.boundingBox())!.height).toBe(initial);
  await page.screenshot({
    path: "artifacts/qa/compact-research-light.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "切换夜间主题" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition", "reveal");
  await page.screenshot({ path: "artifacts/qa/compact-research-dark.png", animations: "disabled" });
  expect(errors).toEqual([]);
});
test("narrow and mobile composers preserve their controls, menus and next draft", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /^NVDA 的增长/ }).click();
  const input = page.getByRole("textbox", { name: "研究问题" });
  await input.fill("输入区随面板变窄后仍保留");
  const splitter = page.getByRole("separator", { name: "调整右侧资料宽度" });
  await splitter.focus();
  for (let i = 0; i < 4; i++) await splitter.press("Shift+ArrowLeft");
  await expect(input).toHaveValue("输入区随面板变窄后仍保留");
  await page.getByRole("button", { name: "研究模式", exact: true }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await splitter.focus();
  await splitter.press("Home");
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill("");
  expect((await page.locator(".composer").boundingBox())!.height).toBeLessThan(120);
  await input.fill(Array.from({ length: 14 }, (_, i) => `第${i + 1}行研究问题`).join("\n"));
  await page.getByRole("button", { name: "模型", exact: true }).click();
  const menu = (await page.getByRole("listbox").boundingBox())!;
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual(844);
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "artifacts/qa/compact-research-mobile-expanded.png",
    animations: "disabled",
  });
  await input.fill("手机研究问题");
  await page.getByRole("button", { name: "发送研究问题" }).click();
  await input.fill("本轮结束后再手动发送");
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
  await expect(input).toHaveValue("本轮结束后再手动发送");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
