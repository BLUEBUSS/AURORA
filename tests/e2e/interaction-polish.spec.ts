import { test, expect } from "@playwright/test";
test("sidebar omits redundant heading and independent-chat icons while retaining project identities", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("全部研究", { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "研究问题" }).fill("NVDA 独立聊天");
  await page.getByRole("button", { name: "发送研究问题" }).click();
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
  const chats = page.getByRole("region", { name: "独立聊天" });
  const projects = page.getByRole("region", { name: "项目列表" });
  await expect(chats.getByRole("button", { name: "NVDA 独立聊天", exact: true })).toBeVisible();
  await expect(chats.locator(".company-logo")).toHaveCount(0);
  await expect(projects.locator(".company-logo img")).toHaveCount(2);
  await page
    .locator(".sidebar")
    .screenshot({ path: "artifacts/qa/sidebar-compact-text-chats.png", animations: "disabled" });
});
test("custom composer menus support keyboard selection without sending or changing the draft", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "研究问题" });
  await input.fill("菜单操作期间保留的草稿");
  await page.getByRole("button", { name: "研究模式", exact: true }).click();
  let list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(2);
  await page.screenshot({
    path: "artifacts/qa/research-mode-menu-light.png",
    animations: "disabled",
  });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "研究模式", exact: true })).toContainText(
    "快速问答",
  );
  await expect(input).toHaveValue("菜单操作期间保留的草稿");
  await expect(page.locator(".user-message")).toHaveCount(0);
  await page.getByRole("button", { name: "模型", exact: true }).click();
  list = page.getByRole("listbox");
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list).toContainText("演示模型");
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(page.getByRole("button", { name: "模型", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "切换夜间主题" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition", "reveal");
  await page.getByRole("button", { name: "研究模式", exact: true }).click();
  await page.screenshot({
    path: "artifacts/qa/research-mode-menu-dark.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "模型", exact: true }).click();
  const bounds = (await page.getByRole("listbox").boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "artifacts/qa/model-menu-mobile.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "发送研究问题" }).click();
  await page.getByRole("button", { name: "研究模式", exact: true }).click();
  await page.getByRole("option", { name: "深度研究", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止研究", exact: true })).toBeVisible();
  await expect(page.locator(".user-message")).toHaveCount(1);
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
});
test("theme switch performs a circular reveal, preserves draft, and settles after rapid switching", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "研究问题" });
  await input.fill("动效切换中保留的草稿");
  await page.getByRole("button", { name: "切换夜间主题" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document
          .getAnimations()
          .some((a) => a instanceof CSSAnimation && a.animationName === "aurora-theme-reveal"),
      ),
    )
    .toBe(true);
  await page.screenshot({ path: "artifacts/qa/theme-reveal-midpoint.png" });
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition", "reveal");
  await expect(input).toHaveValue("动效切换中保留的草稿");
  await page.getByRole("button", { name: "切换日间主题" }).click();
  await page.getByRole("button", { name: "切换夜间主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition", "reveal");
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("aurora-theme") || "null")),
  ).toBe("dark");
  expect(errors).toEqual([]);
});
test("reduced motion and unsupported view transitions still switch themes correctly", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "切换夜间主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(() => document.documentElement.dataset.themeTransition),
  ).toBeUndefined();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() =>
    Object.defineProperty(document, "startViewTransition", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "切换日间主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition", "fade");
});
