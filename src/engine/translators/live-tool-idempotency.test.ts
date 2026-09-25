// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import { describe, expect, it } from "vitest";
import { deriveRoundStartOp, liveToOps } from "./live";
import { ChatId } from "../model/chat.id";
import { applyOps } from "../model/chat.reducer";
import { createInitialChatState } from "../model/chat.types";

function stateWithMessage() {
  const initial = createInitialChatState();
  const withRound = applyOps(initial, [
    deriveRoundStartOp(initial, "session", {
      id: "user-1",
      role: "user",
      content: "test",
      timestamp: 1,
    }),
  ]);
  const round = withRound.rounds[0]!;
  const messageId = ChatId.message(round.id, 0);
  return {
    roundId: round.id,
    messageId,
    state: applyOps(withRound, [
      { type: "message/start", roundId: round.id, messageId, timestamp: 10 },
    ]),
  };
}

describe("live tool events use toolCallId as the idempotency boundary", () => {
  it("does not attach a known tool call to a later assistant message", () => {
    const setup = stateWithMessage();
    const started = applyOps(setup.state, [
      ...liveToOps(
        {
          event: "agent",
          payload: {
            stream: "tool",
            data: { toolCallId: "call-1", toolName: "fetch", args: { symbol: "BABA" } },
          },
        },
        setup.state,
      ),
      {
        type: "message/end",
        roundId: setup.roundId,
        messageId: setup.messageId,
        timestamp: 20,
      },
    ]);
    const nextMessageId = ChatId.message(setup.roundId, 1);
    const nextMessage = applyOps(started, [
      {
        type: "message/start",
        roundId: setup.roundId,
        messageId: nextMessageId,
        timestamp: 30,
      },
    ]);

    const resultOps = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: { toolCallId: "call-1", toolName: "fetch", result: { ok: true } },
        },
      },
      nextMessage,
    );

    expect(resultOps.map((op) => op.type)).toEqual(["tool/result"]);
  });

  it("ignores a replayed start for a toolCallId already loaded from history", () => {
    const setup = stateWithMessage();
    const known = applyOps(setup.state, [
      { type: "tool/start", toolCallId: "call-1", toolName: "fetch" },
      {
        type: "message/record-tool",
        roundId: setup.roundId,
        messageId: setup.messageId,
        toolName: "fetch",
        toolCallId: "call-1",
        isStructural: false,
      },
    ]);

    const replayOps = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: { toolCallId: "call-1", toolName: "fetch", args: { symbol: "BABA" } },
        },
      },
      known,
    );

    expect(replayOps).toEqual([]);
  });

  it("synthesizes a start when the backend sends a result-only event", () => {
    const setup = stateWithMessage();

    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            toolCallId: "result-only",
            toolName: "fetch",
            args: { symbol: "BABA" },
            result: { ok: true },
          },
        },
      },
      setup.state,
    );
    const next = applyOps(setup.state, ops);

    expect(ops.map((op) => op.type)).toEqual(["tool/start", "tool/result", "message/record-tool"]);
    expect(next.toolCalls.get("result-only")).toMatchObject({ status: "success" });
  });
});
