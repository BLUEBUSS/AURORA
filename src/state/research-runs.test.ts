import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useWorkspace } from "./workspace";
import { applyCoreEvent, clearCore, getCore, startCoreRound } from "./research-core";
import {
  activeRun,
  finishRun,
  ingestEvent,
  registerRun,
  rememberedRuns,
  resetRuns,
} from "./research-runs";
function start(sessionId: string, runId: string) {
  const user = {
    id: `u-${runId}`,
    role: "user" as const,
    text: `question-${runId}`,
    time: Date.now(),
  };
  useWorkspace.setState((s) => ({
    sessions: [
      ...s.sessions,
      { id: sessionId, title: user.text, messages: [], origin: "live", updatedAt: Date.now() },
    ],
  }));
  const roundId = startCoreRound(sessionId, user);
  registerRun({ runId, sessionId, roundId, startedAt: Date.now(), stage: "accepted" });
  return roundId;
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetRuns();
  clearCore();
  useWorkspace.setState({ mode: "live", sessions: [], drafts: {} });
});
afterEach(() => {
  resetRuns();
  vi.useRealTimers();
});
it("isolates sessions, ignores duplicate and late events, and preserves final canonical text", () => {
  start("a", "run-a");
  start("b", "run-b");
  ingestEvent("agent", {
    sessionKey: "a",
    runId: "run-a",
    stream: "assistant",
    seq: 1,
    data: { phase: "message_start" },
  });
  ingestEvent("chat", {
    sessionKey: "b",
    runId: "run-a",
    state: "delta",
    seq: 2,
    message: { content: "wrong" },
  });
  ingestEvent("chat", {
    sessionKey: "a",
    runId: "run-a",
    state: "delta",
    seq: 2,
    message: { content: "partial" },
  });
  ingestEvent("chat", {
    sessionKey: "a",
    runId: "run-a",
    state: "delta",
    seq: 2,
    message: { content: "duplicate wrong" },
  });
  ingestEvent("agent", {
    sessionKey: "a",
    runId: "run-a",
    stream: "lifecycle",
    seq: 3,
    data: { phase: "end" },
  });
  expect(activeRun("a")).toBeDefined();
  ingestEvent("chat", {
    sessionKey: "a",
    runId: "run-a",
    state: "final",
    seq: 4,
    message: { content: "canonical answer" },
  });
  ingestEvent("chat", {
    sessionKey: "a",
    runId: "run-a",
    state: "final",
    seq: 5,
    message: { content: "late wrong" },
  });
  expect(
    useWorkspace
      .getState()
      .sessions.find((s) => s.id === "a")
      ?.messages.at(-1)?.text,
  ).toBe("canonical answer");
  expect(getCore("b").rounds[0].pending.size).toBe(0);
});
it("does not erase another pending run while restoring the first session", () => {
  start("a", "run-a");
  start("b", "run-b");
  resetRuns(false);
  const saved = rememberedRuns();
  registerRun({ ...saved[0], roundId: getCore("a").rounds[0].id });
  expect(
    rememberedRuns()
      .map((r) => r.runId)
      .sort(),
  ).toEqual(["run-a", "run-b"]);
  finishRun("run-a", "aborted");
  expect(rememberedRuns().map((r) => r.runId)).toEqual(["run-b"]);
});
it("pending records preserve only the active question, and are removed at a confirmed terminal", () => {
  start("a", "run-a");
  expect(rememberedRuns()[0].userMessage?.text).toBe("question-run-a");
  applyCoreEvent("a", "agent", { stream: "assistant", data: { phase: "message_start" } });
  applyCoreEvent("a", "chat", { state: "delta", message: { content: "partial" } });
  useWorkspace.setState({ drafts: { a: { text: "next draft", attachments: [] } } });
  finishRun("run-a", "aborted");
  expect(rememberedRuns()).toEqual([]);
  expect(useWorkspace.getState().drafts.a.text).toBe("next draft");
});
