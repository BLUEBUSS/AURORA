import type {
  Bootstrap,
  ChatAbortResult,
  ChatSendParams,
  ChatSendResult,
  GatewayEventListener,
  GatewayOptions,
  GatewayStatus,
  GatewayStatusListener,
  HistoryResult,
  ModelsResult,
  SessionsResult,
  WebUser,
} from "./contracts";

export class GatewayError extends Error {
  readonly code?: string;
  readonly status?: number;
  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message);
    this.name = "GatewayError";
    this.code = options.code;
    this.status = options.status;
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Connection = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorFrom(value: unknown, fallback: string): GatewayError {
  const error = record(value);
  return new GatewayError(typeof error?.message === "string" ? error.message : fallback, {
    code: typeof error?.code === "string" ? error.code : undefined,
  });
}

/** Read visible text only; tool arguments and reasoning blocks are not chat prose. */
export function extractMessageText(message: unknown): string {
  if (typeof message === "string") return message;
  const item = record(message);
  if (!item) return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  return item.content
    .flatMap((block: unknown) => {
      const part = record(block);
      return part?.type === "text" && typeof part.text === "string" ? [part.text] : [];
    })
    .join("\n");
}

/** Same-origin ANLYST protocol transport. No token persistence or automatic send retries. */
export class GatewayClient {
  private readonly options: GatewayOptions;
  private status: GatewayStatus = "idle";
  private token = "";
  private bootstrapData: Bootstrap | null = null;
  private socket: WebSocket | null = null;
  private connection: Connection | null = null;
  private sequence = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<GatewayEventListener>();
  private readonly statusListeners = new Set<GatewayStatusListener>();

  constructor(options: GatewayOptions = {}) {
    this.options = options;
  }

  getStatus(): GatewayStatus {
    return this.status;
  }

  subscribe(listener: GatewayEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeStatus(listener: GatewayStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  async bootstrap(): Promise<Bootstrap> {
    try {
      let bootstrap: unknown;
      try {
        bootstrap = await this.http("/api/bootstrap");
      } catch (error) {
        if (!(error instanceof GatewayError) || error.code !== "LOCAL_SESSION_REQUIRED") throw error;
        await this.http("/api/local-session", { method: "POST", body: "{}" });
        bootstrap = await this.http("/api/bootstrap");
      }
      const raw = record(bootstrap);
      if (!raw || !record(raw.agentNameMap)) throw new GatewayError("后端启动信息格式无效");
      if (record(raw.runtime)?.kind === "aurora" && record(raw.runtime)?.researchReady === false) {
        this.clearAuth();
        throw new GatewayError("AURORA 本机服务已启动，研究引擎接入尚未完成。", { code: "RESEARCH_NOT_READY" });
      }
      const user = record(raw.currentUser);
      if (user && typeof user.id !== "string") throw new GatewayError("后端用户信息格式无效");
      const nextUser: WebUser | null = user
        ? {
            id: user.id as string,
            username: typeof user.username === "string" ? user.username : undefined,
            role: typeof user.role === "string" ? user.role : undefined,
            agentId: typeof user.agentId === "string" ? user.agentId : undefined,
            allowedAgents: Array.isArray(user.allowedAgents)
              ? user.allowedAgents.filter((id): id is string => typeof id === "string")
              : undefined,
          }
        : null;
      if (this.bootstrapData && this.bootstrapData.currentUser?.id !== nextUser?.id)
        this.disconnect();
      this.token = typeof raw.gatewayToken === "string" ? raw.gatewayToken : "";
      this.bootstrapData = {
        agentNameMap: Object.fromEntries(
          Object.entries(raw.agentNameMap as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
        currentUser: nextUser,
      };
      return this.bootstrapData;
    } catch (error) {
      if (error instanceof GatewayError && error.status === 401) this.clearAuth();
      throw error;
    }
  }

  async login(username: string, password: string): Promise<Bootstrap> {
    this.clearAuth();
    await this.http("/backend/auth/login-password", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    return this.bootstrap();
  }

  async logout(): Promise<void> {
    try {
      await this.http("/backend/auth/logout", { method: "POST", body: "{}" });
    } finally {
      this.clearAuth();
    }
  }

  connect(): Promise<void> {
    if (this.status === "connected" && this.socket?.readyState === 1) return Promise.resolve();
    if (this.connection) return this.connection.promise;
    if (!this.bootstrapData)
      return Promise.reject(new GatewayError("请先连接后端或登录", { code: "BOOTSTRAP_REQUIRED" }));

    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const attempt: Connection = { promise, resolve, reject };
    this.connection = attempt;
    this.setStatus("connecting");
    attempt.timer = setTimeout(() => {
      if (this.connection === attempt)
        this.closeConnection(
          new GatewayError("后端连接超时", { code: "CONNECT_TIMEOUT" }),
          "error",
        );
    }, this.options.connectTimeoutMs ?? 12_000);

    try {
      const origin = this.options.origin?.() ?? window.location.origin;
      const url = new URL("/fin-core/ws", origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket =
        this.options.createWebSocket?.(url.toString()) ?? new WebSocket(url.toString());
      this.socket = socket;
      let handshakeStarted = false;
      socket.onmessage = (event) => {
        if (this.socket !== socket || typeof event.data !== "string") return;
        let frame: Record<string, unknown> | null;
        try {
          frame = record(JSON.parse(event.data));
        } catch {
          return;
        }
        if (!frame) return;
        if (frame.type === "res" && typeof frame.id === "string") {
          const waiting = this.pending.get(frame.id);
          if (!waiting) return;
          clearTimeout(waiting.timer);
          this.pending.delete(frame.id);
          if (frame.ok === true) waiting.resolve(frame.payload);
          else waiting.reject(errorFrom(frame.error, "后端请求失败"));
          return;
        }
        if (frame.type !== "event" || typeof frame.event !== "string") return;
        if (frame.event === "connect.challenge") {
          if (handshakeStarted || this.connection !== attempt) return;
          handshakeStarted = true;
          void this.sendRaw("connect", {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: "webchat",
              displayName: "AURORA",
              version: "0.1.0",
              platform: "web",
              mode: "webchat",
            },
            caps: ["tool-events"],
            role: "operator",
            scopes: ["operator.admin", "operator.read", "operator.write"],
            auth: this.token ? { token: this.token } : {},
          })
            .then((payload) => {
              if (this.socket !== socket || this.connection !== attempt) return;
              const hello = record(payload);
              if (hello?.type !== "hello-ok" || hello.protocol !== 3)
                throw new GatewayError("后端协议版本不兼容");
              clearTimeout(attempt.timer);
              this.connection = null;
              this.setStatus("connected");
              attempt.resolve();
            })
            .catch((error: unknown) => {
              if (this.socket === socket)
                this.closeConnection(
                  error instanceof Error ? error : new GatewayError("握手失败"),
                  "error",
                );
            });
          return;
        }
        if (this.status !== "connected") return;
        for (const listener of this.listeners) {
          try {
            listener(frame.event, record(frame.payload) ?? {});
          } catch {
            /* One UI listener cannot interrupt the transport. */
          }
        }
      };
      socket.onerror = () => {
        if (this.socket === socket)
          this.closeConnection(
            new GatewayError("无法连接研究后端", { code: "CONNECTION_ERROR" }),
            "error",
          );
      };
      socket.onclose = () => {
        if (this.socket === socket)
          this.closeConnection(
            new GatewayError("后端连接已关闭", { code: "CONNECTION_CLOSED" }),
            "disconnected",
          );
      };
    } catch (error) {
      this.closeConnection(
        error instanceof Error ? error : new GatewayError("无法建立连接"),
        "error",
      );
    }
    return promise;
  }

  disconnect(): void {
    this.closeConnection(
      new GatewayError("后端连接已关闭", { code: "CONNECTION_CLOSED" }),
      "disconnected",
    );
  }

  async request<T>(method: string, params: object = {}): Promise<T> {
    if (method === "connect") throw new GatewayError("请通过 connect() 建立连接");
    await this.connect();
    return this.sendRaw(method, params) as Promise<T>;
  }

  listSessions(agentId = this.bootstrapData?.currentUser?.agentId): Promise<SessionsResult> {
    return this.request("sessions.list", {
      ...(agentId ? { agentId } : {}),
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 100,
    });
  }

  history(sessionKey: string, limit = 100): Promise<HistoryResult> {
    return this.request("chat.history", {
      sessionKey,
      limit: Math.min(1000, Math.max(1, Math.floor(limit))),
    });
  }

  listModels(): Promise<ModelsResult> {
    return this.request("models.list", {});
  }
  sendMessage(params: ChatSendParams): Promise<ChatSendResult> {
    return this.request("chat.send", params);
  }
  abort(sessionKey: string, runId?: string): Promise<ChatAbortResult> {
    return this.request("chat.abort", { sessionKey, ...(runId ? { runId } : {}) });
  }

  private sendRaw(method: string, params: object): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== 1)
      return Promise.reject(new GatewayError("后端连接已关闭"));
    const socket = this.socket;
    const id = `aurora-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GatewayError(`后端请求超时（${method}）`, { code: "REQUEST_TIMEOUT" }));
      }, this.options.requestTimeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ type: "req", id, method, params }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new GatewayError("后端请求发送失败", { code: "SEND_FAILED" }));
      }
    });
  }

  private closeConnection(error: Error, status: GatewayStatus): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* A closed transport still needs local cleanup. */
      }
    }
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
    if (this.connection) {
      clearTimeout(this.connection.timer);
      this.connection.reject(error);
      this.connection = null;
    }
    this.setStatus(status);
  }

  private clearAuth(): void {
    this.token = "";
    this.bootstrapData = null;
    this.disconnect();
  }

  private setStatus(status: GatewayStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        /* UI errors do not break connection cleanup. */
      }
    }
  }

  private async http(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs ?? 30_000);
    try {
      const response = await (this.options.fetch ?? fetch)(`/fin-core${path}`, {
        ...init,
        credentials: "same-origin",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...init.headers },
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) {
        const details = record(body);
        const message =
          response.status === 401
            ? "请先登录后端账户"
            : typeof details?.message === "string"
              ? details.message
              : typeof details?.error === "string"
                ? details.error
                : `后端请求失败（${response.status}）`;
        throw new GatewayError(message, { status: response.status, code: typeof details?.code === "string" ? details.code : undefined });
      }
      return body;
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(controller.signal.aborted ? "后端请求超时" : "研究后端暂不可用", {
        code: controller.signal.aborted ? "HTTP_TIMEOUT" : "HTTP_UNAVAILABLE",
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export const gateway = new GatewayClient();
