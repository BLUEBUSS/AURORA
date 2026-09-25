// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * chat.types 单测：factory 构造与 isPhaseStep 守卫。
 * 类型本身由 tsc 守护，本测仅覆盖运行时部分。
 */

import { describe, expect, it } from "vitest";
import { createInitialChatState, isPhaseStep } from "./chat.types";

describe("createInitialChatState", () => {
  it("应该返回全空集合 + null 活跃指针", () => {
    const s = createInitialChatState();
    expect(s.rounds).toEqual([]);
    expect(s.roundsById.size).toBe(0);
    expect(s.subagents.size).toBe(0);
    expect(s.toolCalls.size).toBe(0);
    expect(s.activeRoundId).toBeNull();
    expect(s.activeMessageId).toBeNull();
    expect(s.currentSessionKey).toBeNull();
    expect(s.pendingChildSessionKeyByRunId.size).toBe(0);
  });

  it("两次调用应该返回独立实例（factory 不共享引用）", () => {
    const a = createInitialChatState();
    const b = createInitialChatState();
    a.rounds.push({} as never);
    expect(b.rounds).toEqual([]);
    expect(a.roundsById).not.toBe(b.roundsById);
  });
});

describe("isPhaseStep", () => {
  it("有 status 的 step 是 phase", () => {
    expect(isPhaseStep({ id: "p1", status: "pending" })).toBe(true);
    expect(isPhaseStep({ id: "p1", status: "running" })).toBe(true);
    expect(isPhaseStep({ id: "p1", status: "done" })).toBe(true);
  });

  it("无 status 的 step 不是 phase", () => {
    expect(isPhaseStep({ id: "p1" })).toBe(false);
  });
});
