import { test, expect } from "@playwright/test";
test("reload during an accepted run restores the question even before backend history is persisted", async ({
  page,
}) => {
  let active: { sessionKey: string; runId: string; question: string } | undefined;
  await page.route("**/fin-core/api/bootstrap", (r) =>
    r.fulfill({
      json: {
        gatewayToken: "test-only-token",
        agentNameMap: { main: "Research" },
        currentUser: { id: "qa", agentId: "main" },
      },
    }),
  );
  await page.routeWebSocket("**/fin-core/ws", (ws) => {
    ws.onMessage((raw) => {
      const f = JSON.parse(String(raw));
      const respond = (payload: unknown) =>
        ws.send(JSON.stringify({ type: "res", id: f.id, ok: true, payload }));
      if (f.method === "connect") respond({ type: "hello-ok", protocol: 3 });
      if (f.method === "models.list") respond({ models: [] });
      if (f.method === "sessions.list")
        respond({
          sessions: active
            ? [{ key: active.sessionKey, derivedTitle: "QA 刷新恢复", updatedAt: Date.now() }]
            : [],
        });
      if (f.method === "sessions.patch") respond({});
      if (f.method === "chat.send") {
        active = {
          sessionKey: f.params.sessionKey,
          runId: f.params.idempotencyKey,
          question: f.params.message,
        };
        respond({ runId: active.runId, status: "started" });
      }
      if (f.method === "chat.history") {
        respond({ messages: [] });
        if (active)
          ws.send(
            JSON.stringify({
              type: "event",
              event: "chat",
              payload: {
                sessionKey: active.sessionKey,
                runId: active.runId,
                seq: 2,
                state: "delta",
                message: { content: "刷新恢复后继续收到流式内容。" },
              },
            }),
          );
      }
      if (f.method === "agent.wait") respond({ status: "timeout" });
      if (f.method === "chat.abort") respond({ ok: true, aborted: true, runIds: [active?.runId] });
    });
    ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: {} }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "本地演示", exact: true }).click();
  await page.getByRole("button", { name: "连接现有后端" }).click();
  await expect(page.getByRole("button", { name: "已连接", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "研究问题" }).fill("QA 刷新期间的问题");
  await page.getByRole("button", { name: "发送研究问题" }).click();
  await expect(page.getByRole("button", { name: "停止研究", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(sessionStorage.getItem("aurora-active-research-v1") || "[]")[0]?.stage,
      ),
    )
    .toBe("accepted");
  await page.reload();
  await expect(page.getByRole("button", { name: "已连接", exact: true })).toBeVisible();
  await expect(page.locator(".user-message")).toContainText("QA 刷新期间的问题");
  await expect(page.getByRole("button", { name: "停止研究", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送研究问题" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("aurora-active-research-v1") || "[]"),
    ),
  ).toEqual([]);
});
