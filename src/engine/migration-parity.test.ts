import { describe, expect, it } from "vitest";
import {
  applyOps,
  createInitialChatState,
  deriveRoundStartOp,
  historyToOps,
  liveToOps,
  selectConclusionText,
  selectPreplanThinkingText,
  type ChatMessage,
  type ChatState,
  type HistoryMessage,
  type WsEvent,
} from "./index";

const sessionKey = "agent:research:webuser:qa:aurora-parity";
const user: ChatMessage = { id: "user-1", role: "user", content: "核对 NVDA 需求", timestamp: 1000 };

function feed(state: ChatState, events: WsEvent[]) {
  return events.reduce((current, event) => applyOps(current, liveToOps(event, current)), state);
}

function snapshot(state: ChatState) {
  return state.rounds.map((round) => ({
    id: round.id,
    index: round.index,
    status: round.status,
    thinking: selectPreplanThinkingText(round),
    conclusion: selectConclusionText(round),
    toolIds: [...state.toolCalls.keys()],
  }));
}

describe("standalone engine migration contract", () => {
  it("reconstructs the same research round from live events and history with thinking and tools", () => {
    const initial = createInitialChatState();
    const started = applyOps(initial, [deriveRoundStartOp(initial, sessionKey, user)]);
    const live = feed(started, [
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      { event: "agent", payload: { stream: "thinking", data: { text: "Reasoning:\n_先核对公告_" } } },
      { event: "chat", payload: { state: "delta", message: { text: "核对来源。" } } },
      { event: "agent", payload: { stream: "tool", data: { phase: "tool_use", toolCallId: "lookup-1", toolName: "web_search", args: { query: "NVDA" } } } },
      { event: "agent", payload: { stream: "tool", data: { phase: "tool_result", toolCallId: "lookup-1", toolName: "web_search", result: { text: "公告已核验" } } } },
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      { event: "chat", payload: { state: "delta", message: { text: "确认需求并核验估值。" } } },
      { event: "chat", payload: { state: "final" } },
    ]);
    const transcript: HistoryMessage[] = [
      user,
      { role: "assistant", timestamp: 1100, content: [
        { type: "thinking", thinking: "先核对公告" },
        { type: "text", text: "核对来源。" },
        { type: "tool_use", id: "lookup-1", name: "web_search", input: { query: "NVDA" } },
      ] },
      { role: "tool", tool_call_id: "lookup-1", name: "web_search", result: { text: "公告已核验" }, timestamp: 1200 },
      { role: "assistant", content: "确认需求并核验估值。", timestamp: 1300 },
    ];
    const restored = applyOps(createInitialChatState(), historyToOps(transcript, sessionKey));
    expect(snapshot(restored)).toEqual(snapshot(live));
    expect(selectConclusionText(restored.rounds[0]!)).toBe("确认需求并核验估值。");
    expect(restored.toolCalls.get("lookup-1")?.status).toBe("success");
  });

  it("does not reuse a restored round id when hidden system messages left index gaps", () => {
    const history: HistoryMessage[] = [
      user,
      { role: "assistant", content: "第一轮结果", timestamp: 1100 },
      { role: "user", content: "[Task Steering] internal continuation", timestamp: 1200 },
      { id: "user-2", role: "user", content: "第二轮问题", timestamp: 1300 },
      { role: "assistant", content: "第二轮结果", timestamp: 1400 },
    ];
    const restored = applyOps(createInitialChatState(), historyToOps(history, sessionKey));
    expect(restored.rounds.map((round) => round.index)).toEqual([0, 2]);
    const continued = applyOps(restored, [deriveRoundStartOp(restored, sessionKey, {
      id: "user-3", role: "user", content: "第三轮问题", timestamp: 1500,
    })]);
    expect(continued.rounds).toHaveLength(3);
    expect(new Set(continued.rounds.map((round) => round.id)).size).toBe(3);
    expect(continued.rounds.at(-1)?.index).toBe(3);
    expect(selectConclusionText(continued.rounds[1]!)).toBe("第二轮结果");
  });

  it("preserves the accumulated response after an abort or failure", () => {
    for (const terminal of ["aborted", "error"]) {
      const initial = createInitialChatState();
      const state = feed(applyOps(initial, [deriveRoundStartOp(initial, sessionKey, user)]), [
        { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
        { event: "chat", payload: { state: "delta", message: { text: "已经得到的部分结果" } } },
        { event: "chat", payload: { state: terminal, error: "source unavailable" } },
      ]);
      expect(selectConclusionText(state.rounds[0]!)).toBe("已经得到的部分结果");
      expect(state.rounds[0]?.status).toBe(terminal === "error" ? "failed" : "aborted");
      expect(state.rounds[0]?.pending.size).toBe(0);
    }
  });
});
