// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * chat.ops 单测：守卫函数与 union 静态保证（仅运行时部分）。
 */

import { describe, expect, it } from "vitest";
import { type ChatOp, assertNever, isContentSetOp, isRoundLifecycleOp } from "./chat.ops";

describe("isContentSetOp", () => {
  it("识别 set-text / set-thinking", () => {
    const a: ChatOp = { type: "message/set-text", roundId: "r", messageId: "m", fullText: "x" };
    const b: ChatOp = { type: "message/set-thinking", roundId: "r", messageId: "m", fullText: "x" };
    expect(isContentSetOp(a)).toBe(true);
    expect(isContentSetOp(b)).toBe(true);
  });

  it("拒绝 message/start 等边界 op", () => {
    const op: ChatOp = { type: "message/start", roundId: "r", messageId: "m", timestamp: 1 };
    expect(isContentSetOp(op)).toBe(false);
  });

  it("拒绝 record-tool / tool/start", () => {
    expect(
      isContentSetOp({
        type: "message/record-tool",
        roundId: "r",
        messageId: "m",
        toolName: "x",
        toolCallId: "c",
        isStructural: false,
      }),
    ).toBe(false);
    expect(isContentSetOp({ type: "tool/start", toolCallId: "c", toolName: "x" })).toBe(false);
  });
});

describe("isRoundLifecycleOp", () => {
  it("识别 round/start 与 round/complete", () => {
    expect(
      isRoundLifecycleOp({
        type: "round/start",
        roundId: "r",
        userMessage: { id: "u", role: "user", content: "", timestamp: 0 },
        sessionKey: "s",
        roundIndex: 0,
        timestamp: 1,
      }),
    ).toBe(true);
    expect(
      isRoundLifecycleOp({
        type: "round/complete",
        roundId: "r",
        status: "done",
        timestamp: 1,
      }),
    ).toBe(true);
  });

  it("拒绝 message lifecycle", () => {
    expect(
      isRoundLifecycleOp({ type: "message/start", roundId: "r", messageId: "m", timestamp: 1 }),
    ).toBe(false);
  });
});

describe("assertNever", () => {
  it("被动调用应抛错", () => {
    expect(() => assertNever("oops" as never)).toThrow(/Unhandled op/);
  });
});
