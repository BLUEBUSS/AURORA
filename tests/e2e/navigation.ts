import { expect, type Page } from "@playwright/test";
export async function openWorkspaceMenu(page: Page) {
  const menu = page.getByRole("menu", { name: "工作区菜单" });
  if (!(await menu.isVisible())) {
    const trigger = page.getByRole("button", { name: "打开工作区菜单", exact: true });
    if (!(await trigger.isVisible()))
      await page.getByRole("button", { name: "展开导航", exact: true }).click();
    await trigger.click();
  }
  await expect(menu).toBeVisible();
  return menu;
}
export async function openWorkspacePage(page: Page, label: string) {
  const menu = await openWorkspaceMenu(page);
  await menu.getByRole("menuitem", { name: label, exact: true }).click();
}
export async function openSettings(page: Page) {
  const menu = await openWorkspaceMenu(page);
  await menu.getByRole("menuitem", { name: "设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "工作台设置" })).toBeVisible();
}
