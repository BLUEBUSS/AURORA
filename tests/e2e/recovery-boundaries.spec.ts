import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
const a = "agent:main:webuser:qa:antlyst-a",
  b = "agent:main:webuser:qa:antlyst-b";
type Pending = {
  sessionId: string;
  runId: string;
  startedAt: number;
  stage: string;
  roundCount: number;
  userMessage: { id: string; role: string; text: string; time: number };
};
function pending(sessionId: string, stage = "accepted"): Pending {
  return {
    sessionId,
    runId: `run-${sessionId.at(-1)}`,
    startedAt: 1000,
    stage,
    roundCount: 2,
    userMessage: {
      id: "new-user",
      role: "user",
      text: `new question ${sessionId.at(-1)}`,
      time: 1000,
    },
  };
}
async function setup(
  page: Page,
  sessions: unknown[],
  history: unknown[],
  saved: Pending[],
  abort = true,
) {
  let socket: WebSocketRoute;
  let sendCount = 0;
  await page.addInitScript(
    ({ saved, a }) => {
      localStorage.setItem("aurora-data-mode", '"live"');
      localStorage.setItem("aurora-live-view:qa:main", JSON.stringify(a));
      sessionStorage.setItem("aurora-active-research-v1", JSON.stringify(saved));
    },
    { saved, a },
  );
  await page.route("**/fin-core/api/bootstrap", (r) =>
    r.fulfill({
      json: {
        gatewayToken: "fixture-token",
        agentNameMap: { main: "QA" },
        currentUser: { id: "qa", agentId: "main" },
      },
    }),
  );
  await page.routeWebSocket("**/fin-core/ws", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const f = JSON.parse(String(raw));
      const res = (payload: unknown) =>
        ws.send(JSON.stringify({ type: "res", id: f.id, ok: true, payload }));
      if (f.method === "connect") res({ type: "hello-ok", protocol: 3 });
      if (f.method === "models.list") res({ models: [] });
      if (f.method === "sessions.list") res({ sessions });
      if (f.method === "chat.history") res({ messages: history });
      if (f.method === "agent.wait") res({ status: "timeout" });
      if (f.method === "chat.abort")
        res({ ok: true, aborted: abort, runIds: abort ? [f.params.runId] : [] });
      if (f.method === "chat.send") sendCount++;
    });
    ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: {} }));
  });
  return {
    sent: () => sendCount,
    finish: () =>
      socket.send(
        JSON.stringify({
          type: "event",
          event: "chat",
          payload: {
            sessionKey: a,
            runId: "run-a",
            state: "final",
            seq: 10,
            message: { content: "后来确认完成" },
          },
        }),
      ),
  };
}
test("a pending new question is appended after existing history instead of taking over the previous round", async ({
  page,
}) => {
  await setup(
    page,
    [{ key: a, derivedTitle: "QA 现有会话" }],
    [
      { role: "user", content: "old question", timestamp: 10 },
      { role: "assistant", content: "上一轮完整答案", timestamp: 20 },
    ],
    [pending(a)],
  );
  await page.goto("/");
  await expect(page.locator(".user-message")).toHaveCount(2);
  await expect(page.locator(".user-message").last()).toHaveText("new question a");
  await expect(page.locator(".assistant-message").first()).toContainText("上一轮完整答案");
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
  await expect(page.locator(".assistant-message").first().locator(".answer-status")).toContainText(
    "研究完成",
  );
  await expect(page.locator(".assistant-message").last().locator(".answer-status")).toContainText(
    "已停止",
  );
});
test("two unfinished sessions missing from the backend list both restore their unsent drafts without sending", async ({
  page,
}) => {
  const fixture = await setup(page, [], [], [pending(a, "preparing"), pending(b, "preparing")]);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "研究问题" })).toHaveValue("new question a");
  await page.getByRole("button", { name: "new question b", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "研究问题" })).toHaveValue("new question b");
  expect(fixture.sent()).toBe(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("aurora-active-research-v1") || "[]"),
    ),
  ).toEqual([]);
});
test("an unconfirmed stop retains run tracking and accepts the eventual authoritative final response", async ({
  page,
}) => {
  const fixture = await setup(
    page,
    [{ key: a, derivedTitle: "QA 未确认停止" }],
    [],
    [pending(a)],
    false,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
  await expect(page.locator(".research-recovery-note")).toBeVisible();
  await expect(page.getByRole("button", { name: "停止研究", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("aurora-active-research-v1") || "[]").length,
    ),
  ).toBe(1);
  fixture.finish();
  await expect(page.locator(".assistant-message").last()).toContainText("后来确认完成");
  await expect(page.getByRole("button", { name: "发送研究问题" })).toBeVisible();
  expect(fixture.sent()).toBe(0);
});
