import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayClient, extractMessageText } from "./gateway";

class MockSocket {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  sent: Array<{ type: string; id: string; method: string; params: Record<string, unknown> }> = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  receive(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  challenge() {
    this.receive({ type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
  }
  accept() {
    const frame = this.sent.find((item) => item.method === "connect");
    if (!frame) throw new Error("Handshake missing");
    this.receive({
      type: "res",
      id: frame.id,
      ok: true,
      payload: { type: "hello-ok", protocol: 3 },
    });
  }
}

function setup() {
  const sockets: MockSocket[] = [];
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        gatewayToken: "private-test-token",
        agentNameMap: { main: "Research" },
        currentUser: { id: "user-1", agentId: "main", allowedAgents: ["main"] },
      }),
      { status: 200 },
    ),
  );
  const client = new GatewayClient({
    fetch: fetchMock,
    origin: () => "http://127.0.0.1:5184",
    requestTimeoutMs: 100,
    connectTimeoutMs: 100,
    createWebSocket: () => {
      const socket = new MockSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { client, sockets, fetchMock };
}

async function connect(client: GatewayClient, sockets: MockSocket[]) {
  await client.bootstrap();
  const pending = client.connect();
  const socket = sockets[sockets.length - 1];
  socket.open();
  socket.challenge();
  socket.accept();
  await pending;
  return socket;
}

afterEach(() => vi.useRealTimers());

describe("GatewayClient", () => {
  it("keeps credentials private and waits for protocol 3 handshake before business requests", async () => {
    const { client, sockets } = setup();
    const bootstrap = await client.bootstrap();
    expect(JSON.stringify(bootstrap)).not.toContain("private-test-token");
    const connection = client.connect();
    const request = client.listModels();
    const socket = sockets[0];
    socket.open();
    expect(socket.sent).toEqual([]);
    socket.challenge();
    expect(socket.sent[0]).toMatchObject({
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: "webchat", displayName: "AURORA" },
        auth: { token: "private-test-token" },
      },
    });
    expect(socket.sent).toHaveLength(1);
    socket.accept();
    await connection;
    await Promise.resolve();
    const modelFrame = socket.sent[1];
    expect(modelFrame).toMatchObject({ method: "models.list", params: {} });
    socket.receive({ type: "res", id: modelFrame.id, ok: true, payload: { models: [] } });
    await expect(request).resolves.toEqual({ models: [] });
    client.disconnect();
  });

  it("uses chat schemas without agentId and exposes abort acknowledgement", async () => {
    const { client, sockets } = setup();
    const socket = await connect(client, sockets);
    const sending = client.sendMessage({
      sessionKey: "agent:main:webuser:u:aurora-1",
      message: "hello",
      idempotencyKey: "run-1",
    });
    await Promise.resolve();
    const frame = socket.sent.at(-1)!;
    expect(frame.params).not.toHaveProperty("agentId");
    socket.receive({
      type: "res",
      id: frame.id,
      ok: true,
      payload: { runId: "run-1", status: "started" },
    });
    await sending;
    const aborting = client.abort("agent:main:webuser:u:aurora-1", "run-1");
    await Promise.resolve();
    const abortFrame = socket.sent.at(-1)!;
    expect(abortFrame).toMatchObject({
      method: "chat.abort",
      params: { sessionKey: "agent:main:webuser:u:aurora-1", runId: "run-1" },
    });
    socket.receive({
      type: "res",
      id: abortFrame.id,
      ok: true,
      payload: { ok: true, aborted: true, runIds: ["run-1"] },
    });
    await expect(aborting).resolves.toMatchObject({ aborted: true });
    client.disconnect();
  });

  it("rejects pending requests on close and supports explicit reconnect", async () => {
    const { client, sockets } = setup();
    const socket = await connect(client, sockets);
    const request = client.history("session-1");
    const rejected = expect(request).rejects.toThrow("连接已关闭");
    await Promise.resolve();
    socket.close();
    await rejected;
    expect(client.getStatus()).toBe("disconnected");
    const reconnect = client.connect();
    sockets[1].open();
    sockets[1].challenge();
    sockets[1].accept();
    await reconnect;
    expect(client.getStatus()).toBe("connected");
    client.disconnect();
  });

  it("times out requests and handshake without leaving a connected state", async () => {
    vi.useFakeTimers();
    const { client, sockets } = setup();
    await connect(client, sockets);
    const request = client.history("session-1");
    const rejected = expect(request).rejects.toThrow("请求超时");
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    client.disconnect();
    const connecting = client.connect();
    const failed = expect(connecting).rejects.toThrow("连接超时");
    await vi.advanceTimersByTimeAsync(101);
    await failed;
    expect(client.getStatus()).toBe("error");
  });

  it("rejects denied handshake and never sends queued business requests", async () => {
    const { client, sockets } = setup();
    await client.bootstrap();
    const connecting = client.connect();
    const failed = expect(connecting).rejects.toThrow("登录状态已失效");
    sockets[0].open();
    sockets[0].challenge();
    const id = sockets[0].sent[0].id;
    sockets[0].receive({
      type: "res",
      id,
      ok: false,
      error: { code: "AUTH_FAILED", message: "登录状态已失效" },
    });
    await failed;
    expect(client.getStatus()).toBe("error");
  });

  it("keeps HTTP errors distinct from demo mode and drops state on logout", async () => {
    const { client, sockets, fetchMock } = setup();
    await connect(client, sockets);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await client.logout();
    expect(client.getStatus()).toBe("disconnected");
    await expect(client.connect()).rejects.toThrow("请先连接后端或登录");
    fetchMock.mockResolvedValueOnce(new Response('{"error":"login required"}', { status: 401 }));
    await expect(client.bootstrap()).rejects.toMatchObject({ status: 401 });
  });

  it("subscribes and unsubscribes to chat events", async () => {
    const { client, sockets } = setup();
    const socket = await connect(client, sockets);
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    socket.receive({
      type: "event",
      event: "chat",
      payload: { state: "aborted", runId: "r", sessionKey: "s", seq: 1 },
    });
    expect(listener).toHaveBeenCalledWith("chat", expect.objectContaining({ state: "aborted" }));
    unsubscribe();
    socket.receive({ type: "event", event: "tick", payload: {} });
    expect(listener).toHaveBeenCalledTimes(1);
    client.disconnect();
  });
});

describe("extractMessageText", () => {
  it("reads message text and text blocks without exposing thinking or tool arguments", () => {
    expect(
      extractMessageText({
        content: [
          { type: "thinking", thinking: "private" },
          { type: "text", text: "Hello" },
          { type: "text", text: "World" },
        ],
      }),
    ).toBe("Hello\nWorld");
    expect(extractMessageText({ text: "Cumulative delta" })).toBe("Cumulative delta");
    expect(extractMessageText(null)).toBe("");
  });
});
