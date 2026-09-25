import { openWorkspacePage } from "./navigation";
import { test, expect } from "@playwright/test";
test("unsaved file edits require a decision before navigating to another page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^NVDA 的增长/ }).click();
  await page.locator(".evidence-file").first().click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("textbox", { name: "编辑文件内容" }).fill("# 未保存的 QA 文档");
  await openWorkspacePage(page, "文件");
  await expect(page.getByRole("dialog", { name: "保留文件修改？" })).toBeVisible();
  await page
    .getByRole("dialog", { name: "保留文件修改？" })
    .getByRole("button", { name: "关闭对话框" })
    .click();
  await expect(page.getByRole("textbox", { name: "编辑文件内容" })).toHaveValue(
    "# 未保存的 QA 文档",
  );
  await openWorkspacePage(page, "文件");
  await page.getByRole("button", { name: "保存并返回" }).click();
  await expect(page.locator(".page-heading h1")).toHaveText("文件");
  await page.getByRole("button", { name: /^NVIDIA · 研究框架.md/ }).click();
  await expect(page.getByRole("heading", { name: "未保存的 QA 文档" })).toBeVisible();
});
