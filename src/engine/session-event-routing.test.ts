// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import { describe, expect, it } from "vitest";
import { eventSessionKey, isEventForSession } from "./session-event-routing";

describe("session event routing", () => {
  it("accepts envelope and nested session keys", () => {
    expect(eventSessionKey({ sessionKey: "A" })).toBe("A");
    expect(
      eventSessionKey({ data: { sessionKey: "agent:main:A" } }),
    ).toBe("agent:main:A");
  });

  it("rejects a previous session's task update from the active view", () => {
    expect(
      isEventForSession(
        "agent",
        { sessionKey: "session-a", stream: "task_update", data: { plan: {} } },
        "session-b",
      ),
    ).toBe(false);
  });

  it("rejects unscoped chat and agent events instead of guessing ownership", () => {
    expect(isEventForSession("chat", { state: "delta" }, "session-a")).toBe(false);
    expect(isEventForSession("agent", { stream: "tool", data: {} }, "session-a")).toBe(false);
  });

  it("keeps unscoped system events available", () => {
    expect(isEventForSession("connect.challenge", { nonce: "x" }, "session-a")).toBe(true);
  });
});
