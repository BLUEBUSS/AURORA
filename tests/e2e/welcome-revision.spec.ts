import { test, expect } from "@playwright/test";
import { openWorkspacePage, openSettings } from "./navigation";
test("navigation is collected in bottom settings and examples fill without sending", async ({
  page,
}) => {
  await page.goto("/");
  for (const label of ["项目", "文件", "报告", "自选", "提醒"])
    await expect(
      page
        .getByRole("complementary", { name: "主导航" })
        .getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "精选研究案例" })).toBeVisible();
  await page.getByRole("button", { name: "使用案例：算力增长，如何兑现为利润？" }).click();
  await expect(page.getByRole("textbox", { name: "研究问题" })).toHaveValue(/对 NVIDIA/);
  await expect(page.locator(".user-message")).toHaveCount(0);
  await page.getByRole("button", { name: "下一组研究案例" }).click();
  await expect(
    page.getByRole("button", { name: "使用案例：资本开支，何时变成回报？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "使用案例：资本开支，何时变成回报？" }).click();
  await expect(page.getByRole("dialog", { name: "替换当前草稿？" })).toBeVisible();
  await page.getByRole("button", { name: "保留草稿", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "研究问题" })).toHaveValue(/对 NVIDIA/);
  await page.getByRole("button", { name: "使用案例：资本开支，何时变成回报？" }).click();
  await page.getByRole("button", { name: "使用案例问题" }).click();
  await expect(page.getByRole("textbox", { name: "研究问题" })).toHaveValue(/Microsoft/);
  await openWorkspacePage(page, "项目");
  await expect(page.locator(".page-heading h1")).toHaveText("项目");
});
test("desktop and mobile welcome use packaged wordmark, readable cases, and no overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.getByRole("button", { name: "切换夜间主题" }).click();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('500 64px "Aurora Bodoni"'))).toBe(true);
  await expect(page.locator(".welcome-identity .aurora-wordmark")).toHaveCSS(
    "font-family",
    '"Aurora Bodoni", Georgia, serif',
  );
  await page.screenshot({ path: "artifacts/qa/welcome-revision-dark.png", animations: "disabled" });
  await openSettings(page);
  await page.screenshot({ path: "artifacts/qa/settings-workspace.png", animations: "disabled" });
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page.getByRole("button", { name: "切换日间主题" }).click();
  await page.screenshot({
    path: "artifacts/qa/welcome-revision-light.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: "artifacts/qa/welcome-revision-mobile.png",
    animations: "disabled",
  });
  await openWorkspacePage(page, "文件");
  await expect(page.locator(".page-heading h1")).toHaveText("文件");
  expect(errors).toEqual([]);
});
