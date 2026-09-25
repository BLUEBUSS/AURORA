import { openWorkspacePage } from "./navigation";
import { test, expect } from "@playwright/test";
test("protocol fixture: read history, stream, stop with acknowledgement, ignore foreign and late events", async ({
  page,
}) => {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  await page.route("**/fin-core/api/bootstrap", (route) =>
    route.fulfill({
      json: {
        gatewayToken: "fixture-only-secret",
        agentNameMap: { main: "Research" },
        currentUser: { id: "qa", agentId: "main", allowedAgents: ["main"] },
      },
    }),
  );
  await page.routeWebSocket("**/fin-core/ws", (ws) => {
    ws.onMessage((message) => {
      const frame = JSON.parse(String(message)) as {
        id: string;
        method: string;
        params: Record<string, unknown>;
      };
      requests.push(frame);
      const respond = (payload: unknown) =>
        ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload }));
      if (frame.method === "connect") respond({ type: "hello-ok", protocol: 3 });
      if (frame.method === "sessions.list")
        respond({
          sessions: [
            { key: "agent:main:webuser:qa:antlyst-qa", derivedTitle: "QA 后端历史", updatedAt: 1 },
          ],
        });
      if (frame.method === "models.list")
        respond({ models: [{ id: "qa-model", name: "QA 模型", provider: "fixture" }] });
      if (frame.method === "chat.history")
        respond({
          messages: [
            { role: "user", content: "已有研究问题" },
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "# 后端历史回答\n\n这是协议夹具，不是线上研究。[[p_1a2b:营收]]",
                },
              ],
            },
          ],
        });
      if (frame.method === "chat.send") {
        respond({ runId: frame.params.idempotencyKey, status: "started" });
        ws.send(
          JSON.stringify({
            type: "event",
            event: "agent",
            payload: {
              sessionKey: frame.params.sessionKey,
              runId: frame.params.idempotencyKey,
              seq: 1,
              stream: "assistant",
              data: { phase: "message_start" },
            },
          }),
        );
        ws.send(
          JSON.stringify({
            type: "event",
            event: "chat",
            payload: {
              sessionKey: "foreign-session",
              runId: frame.params.idempotencyKey,
              seq: 90,
              state: "final",
              message: { content: "不应出现的跨会话内容" },
            },
          }),
        );
        ws.send(
          JSON.stringify({
            type: "event",
            event: "chat",
            payload: {
              sessionKey: frame.params.sessionKey,
              runId: frame.params.idempotencyKey,
              seq: 1,
              state: "delta",
              message: { content: "本轮已收到流式内容。" },
            },
          }),
        );
      }
      if (frame.method === "fin-core.provenance.resolve")
        respond({
          provenanceId: "p_1a2b",
          sessionKey: "agent:main:webuser:qa:antlyst-qa",
          toolName: "financial_data",
          toolCallId: "qa-tool",
          dataSource: "QA 验证公告",
          summary: {
            kind: "table",
            headers: ["期间", "营收"],
            rows: [["2026Q1", 100]],
            totalRows: 1,
          },
        });
      if (frame.method === "chat.abort") {
        respond({ ok: true, aborted: true, runIds: [frame.params.runId] });
        setTimeout(
          () =>
            ws.send(
              JSON.stringify({
                type: "event",
                event: "chat",
                payload: {
                  sessionKey: frame.params.sessionKey,
                  runId: frame.params.runId,
                  seq: 2,
                  state: "final",
                  message: { content: "不应覆盖的迟到内容" },
                },
              }),
            ),
          80,
        );
      }
    });
    ws.send(
      JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "fixture" } }),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "本地演示", exact: true }).click();
  await page.getByRole("button", { name: "连接现有后端" }).click();
  await expect(page.getByRole("button", { name: "已连接", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "QA 后端历史", exact: true }).click();
  await expect(page.getByRole("heading", { name: "后端历史回答" })).toBeVisible();
  await page.getByRole("button", { name: "查看来源 1" }).click();
  await expect(page.getByRole("dialog", { name: "来源详情" })).toContainText("QA 验证公告");
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await expect(page.getByRole("button", { name: "模型", exact: true })).toBeDisabled();
  const input = page.getByRole("textbox", { name: "研究问题" });
  await input.fill("QA 新问题");
  await input.press("Enter");
  await page.getByRole("button", { name: "思考中…" }).click();
  await expect(page.getByText("本轮已收到流式内容。", { exact: true })).toBeVisible();
  await input.fill("等待中的草稿");
  await page.getByRole("button", { name: "停止研究", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送研究问题" })).toBeVisible();
  await expect(input).toHaveValue("等待中的草稿");
  await expect(page.getByText("本轮已收到流式内容。", { exact: true })).toBeVisible();
  await expect(page.getByText("不应出现的跨会话内容")).toHaveCount(0);
  await expect(page.getByText("不应覆盖的迟到内容")).toHaveCount(0);
  expect(requests.filter((r) => r.method === "chat.send")).toHaveLength(1);
  expect(requests.find((r) => r.method === "chat.send")?.params).not.toHaveProperty("agentId");
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(storage).not.toContain("fixture-only-secret");
  expect(storage).not.toContain("后端历史回答");
  await openWorkspacePage(page, "文件");
  await expect(page.getByRole("heading", { name: "此页面尚未连接后端" })).toBeVisible();
});
