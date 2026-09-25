import { expect, it, vi } from "vitest";
import { GatewayClient } from "./gateway";

it("establishes the new runtime's local cookie session and reports an unavailable engine honestly", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: "LOCAL_SESSION_REQUIRED" }), { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ agentNameMap: { main: "AURORA" }, runtime: { kind: "aurora", researchReady: false } })));
  const socket = vi.fn();
  const client = new GatewayClient({ fetch: fetchMock, createWebSocket: socket });
  await expect(client.bootstrap()).rejects.toMatchObject({ code: "RESEARCH_NOT_READY" });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "/fin-core/api/bootstrap", "/fin-core/api/local-session", "/fin-core/api/bootstrap",
  ]);
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "same-origin" });
  expect(socket).not.toHaveBeenCalled();
});

it("does not turn a legacy account's 401 into local authentication", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 401 }));
  const client = new GatewayClient({ fetch: fetchMock });
  await expect(client.bootstrap()).rejects.toMatchObject({ status: 401 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
