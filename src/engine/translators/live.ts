// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import { ChatId } from "../model/chat.id";
import type { ChatOp } from "../model/chat.ops";
import type { ChatState, MessageId, RoundId, SessionKey } from "../model/chat.types";
import { nextRoundIndexFor } from "../model/chat.types";
import { WsEvent } from "./live.common";
import { translateAgentAssistant, translateAgentLifecycle, translateAgentThinking, translateChatDelta, translateChatTerminal } from "./live.events";
import { translateAgentTool } from "./live.tools";
import { translateAgentTaskUpdate } from "./live.tasks";


// ── 主入口 ───────────────────────────────────────────────────────────────

/** WS 事件 → ChatOp[]。pure function：相同 (event, state) → 相同 ops。 */
export function liveToOps(evt: WsEvent, state: ChatState): ChatOp[] {
  const { event, payload } = evt;

  if (event === "chat") {
    const chatState = payload.state as string | undefined;
    switch (chatState) {
      case "delta":
        return translateChatDelta(state, payload);
      case "final":
        return translateChatTerminal(state, "done");
      case "error":
        return translateChatTerminal(state, "failed", (payload.error as string) || undefined);
      case "aborted":
        return translateChatTerminal(state, "aborted");
      default:
        return [];
    }
  }

  if (event === "agent") {
    const stream = payload.stream as string | undefined;
    const data = (payload.data ?? {}) as Record<string, unknown>;
    switch (stream) {
      case "lifecycle":
        return translateAgentLifecycle(state, data);
      case "assistant":
        return translateAgentAssistant(state, data);
      case "thinking":
        return translateAgentThinking(state, data);
      case "tool":
        return translateAgentTool(state, data);
      case "task_update":
        // backend sessionKey 路由的 task_update event（与老 chat-event-handler.ts:1179 对应）。
        // 携带完整 plan snapshot（含 step status）——这是 WS 重连后续推时 phase 状态的核心源头。
        // 之前漏处理 → execute 阶段刷新后 chatV2.phaseStatuses 永远 pending → 报告期错位。
        return translateAgentTaskUpdate(state, data);
      default:
        return []; // provenance_patch / usage 等：v1 不翻译
    }
  }

  return [];
}


/** 给定 sessionKey 派生新 round 的 op（onUserSend 时本地双发用）。 */
export function deriveRoundStartOp(
  state: ChatState,
  sessionKey: SessionKey,
  userMessage: import("../contracts/protocol").ChatMessage,
): ChatOp {
  const idx = nextRoundIndexFor(state, sessionKey);
  return {
    type: "round/start",
    roundId: ChatId.round(sessionKey, idx),
    userMessage,
    sessionKey,
    roundIndex: idx,
    timestamp: Date.now(),
  };
}


/** 给定 roundId 派生 round/complete 的 op（abort timeout fallback 用）。 */
export function deriveRoundCompleteOp(
  roundId: RoundId,
  status: "done" | "failed" | "aborted",
): ChatOp {
  return { type: "round/complete", roundId, status, timestamp: Date.now() };
}


/** 给定 messageId 显式 close（abort timeout 把 in-flight message 收尾用）。 */
export function deriveMessageEndOp(roundId: RoundId, messageId: MessageId): ChatOp {
  return { type: "message/end", roundId, messageId, timestamp: Date.now() };
}
export type { WsEvent } from "./live.common";
export { translateTaskUpdateArgs } from "./live.tasks";
