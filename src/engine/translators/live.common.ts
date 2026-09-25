// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import type { ChatState, Round } from "../model/chat.types";



/** WS 事件 envelope。后端帧 → handleWsEvent → 本 translator。 */
export interface WsEvent {
  event: "chat" | "agent" | string;
  payload: Record<string, unknown>;
}


// ── Helpers: 从 state 派生 ──────────────────────────────────────────────

export function activeRound(state: ChatState): Round | null {
  if (!state.activeRoundId) return null;
  const idx = state.roundsById.get(state.activeRoundId);
  if (idx === undefined) return null;
  return state.rounds[idx] ?? null;
}


// v1.4 §7.2: backend 推 fullText 用 set-text/set-thinking op 覆盖；不再做 delta 派生。
// 老的 deltaFromCumulative + joinedText 已删除——散度场景下整段当 delta 会导致重复。

// ── 文本提取（与 services/chat-event-helpers.extractText 同形语义） ────────

export function extractTextFromMessage(message: unknown): string {
  if (!message) return "";
  if (typeof message === "string") return message;
  if (typeof message !== "object") return "";
  const m = message as Record<string, unknown>;
  if (typeof m.text === "string") return m.text;
  if (Array.isArray(m.content)) {
    return m.content
      .filter(
        (b): b is { type: string; text: string } =>
          typeof b === "object" &&
          b !== null &&
          (b as Record<string, unknown>).type === "text" &&
          typeof (b as Record<string, unknown>).text === "string",
      )
      .map((b) => b.text)
      .join("");
  }
  if (typeof m.content === "string") return m.content;
  return "";
}
