export type GatewayStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface WebUser {
  id: string;
  username?: string;
  role?: string;
  agentId?: string;
  allowedAgents?: string[];
}

// The backend token belongs to the transport, never to UI state or persistence.
export interface Bootstrap {
  agentNameMap: Record<string, string>;
  currentUser: WebUser | null;
  runtime?: { kind: "aurora"; researchReady: boolean; setupRequired: boolean };
}

export interface SessionRecord {
  key: string;
  archived?: boolean;
  sessionId?: string;
  displayName?: string;
  derivedTitle?: string;
  label?: string;
  updatedAt?: number;
  lastMessagePreview?: string;
  model?: string;
  modelProvider?: string;
  modelOverride?: string;
  providerOverride?: string;
  modelLocked?: boolean;
  channel?: string;
  lastChannel?: string;
}

export interface SessionsResult {
  sessions: SessionRecord[];
}
export interface HistoryResult {
  sessionKey?: string;
  sessionId?: string;
  messages: unknown[];
  thinkingLevel?: string;
  roundStates?: Array<{ runId: string; userTimestamp: number; status: "running" | "ok" | "error" | "aborted" }>;
  lastRun?: { runId: string; userTimestamp: number; status: "running" | "ok" | "error" | "aborted" };
}
export interface ModelRecord {
  id: string;
  name?: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
}
export interface ModelsResult {
  models: ModelRecord[];
  defaultModel?: { provider: string; model: string };
}

export interface ChatSendParams {
  sessionKey: string;
  message: string;
  idempotencyKey: string;
  thinking?: string;
  deliver?: boolean;
  attachments?: unknown[];
  timeoutMs?: number;
}
export interface ChatSendResult {
  runId: string;
  status: "started" | "in_flight" | "ok";
}
export interface ChatAbortResult {
  ok: boolean;
  aborted: boolean;
  runIds: string[];
}
export interface ChatEvent {
  runId: string;
  sessionKey: string;
  seq: number;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
}

export type GatewayEventListener = (event: string, payload: Record<string, unknown>) => void;
export type GatewayStatusListener = (status: GatewayStatus) => void;

export interface GatewayOptions {
  fetch?: typeof fetch;
  createWebSocket?: (url: string) => WebSocket;
  origin?: () => string;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
}
