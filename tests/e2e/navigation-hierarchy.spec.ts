import { test, expect } from "@playwright/test";
import { openSettings, openWorkspaceMenu, openWorkspacePage } from "./navigation";
test("projects and independent chats have separate hierarchy, including pinned sessions", async ({
  page,
}) => {
  await page.goto("/");
  const projects = page.getByRole("region", { name: "项目列表", exact: true });
  const chats = page.getByRole("region", { name: "独立聊天", exact: true });
  await expect(projects.getByRole("button", { name: /^NVDA 的增长/ })).toHaveCount(1);
  await expect(chats.getByRole("button", { name: /^NVDA 的增长/ })).toHaveCount(0);
  await page.getByRole("button", { name: "AI 算力产业链", exact: true }).click();
  await expect(projects.getByRole("button", { name: /^NVDA 的增长/ })).toHaveCount(0);
  await page.getByRole("button", { name: "AI 算力产业链", exact: true }).click();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("独立项目 QA");
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(projects.getByRole("button", { name: "独立项目 QA", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /管理 NVDA 的增长/ }).click();
  await page.getByRole("combobox", { name: "归入项目" }).selectOption({ label: "独立项目 QA" });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page
      .locator(".sidebar-project")
      .filter({ has: page.getByRole("button", { name: "独立项目 QA", exact: true }) })
      .getByRole("button", { name: /^NVDA 的增长/ }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: /新建研究/ })
    .first()
    .click();
  await page.getByRole("textbox", { name: "研究问题" }).fill("独立聊天 QA");
  await page.getByRole("button", { name: "发送研究问题" }).click();
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
  await expect(chats.getByRole("button", { name: "独立聊天 QA", exact: true })).toBeVisible();
  await expect(projects.getByRole("button", { name: "独立聊天 QA", exact: true })).toHaveCount(0);
});
test("bottom menu and category settings are separate, keyboard accessible and compact", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "切换夜间主题" }).click();
  const menu = await openWorkspaceMenu(page);
  await expect(menu.getByRole("menuitem", { name: "文件", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "工作台设置" })).toHaveCount(0);
  await page.screenshot({ path: "artifacts/qa/navigation-menu-dark.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "打开工作区菜单" })).toBeFocused();
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "工作台设置" });
  await expect(dialog.getByRole("tabpanel", { name: "常规", exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "外观" })).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await page.screenshot({ path: "artifacts/qa/settings-general-dark.png", animations: "disabled" });
  await dialog.getByRole("tab", { name: "常规", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("tabpanel", { name: "账户与连接" })).toBeVisible();
  await page.screenshot({
    path: "artifacts/qa/settings-connection-dark.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await expect(page.getByRole("button", { name: "打开工作区菜单" })).toBeFocused();
  await openSettings(page);
  await dialog.getByRole("combobox", { name: "外观" }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: "artifacts/qa/settings-general-light.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});
test("mobile menu and settings stay usable without closing the navigation underneath unexpectedly", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const menu = await openWorkspaceMenu(page);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("dialog", { name: "导航", exact: true })).toBeVisible();
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "工作台设置" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "导航", exact: true })).toHaveCount(0);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/qa/settings-mobile.png", animations: "disabled" });
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await openWorkspacePage(page, "文件");
  await expect(page.locator(".page-heading h1")).toHaveText("文件");
});
