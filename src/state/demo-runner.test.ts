import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companies, sampleReport, sampleSources } from "../data/demo";
import { selectConclusionText, selectPreplanThinkingText } from "../engine";
import { runDemo, stopDemo, failDemo, stopAllDemo } from "./demo-runner";
import { clearCore, getCore } from "./research-core";
import { useWorkspace } from "./workspace";

beforeEach(() => {
  vi.useFakeTimers();
  clearCore();
  localStorage.clear();
  useWorkspace.setState({ mode: "demo", currentSessionId: "demo-test", files: [], drafts: {}, sessions: [{
    id: "demo-test", title: "示例研究", messages: [], origin: "demo", company: companies[0], updatedAt: 1,
  }] });
});
afterEach(() => { stopAllDemo(); clearCore(); vi.useRealTimers(); });

function start() {
  const { sessionId, messageId } = useWorkspace.getState().beginRound("NVDA 研究", [], "demo-test");
  runDemo(sessionId, messageId);
  return { sessionId, messageId };
}
function answer() {
  return useWorkspace.getState().sessions.find((session) => session.id === "demo-test")!.messages.findLast((message) => message.role === "assistant")!;
}

describe("demo event replay", () => {
  it("uses engine thinking, tool and report events, then finishes with the preset file in about four seconds", () => {
    const { messageId } = start();
    expect(getCore("demo-test").rounds[0].status).toBe("streaming");
    expect(answer().text).toBe("");
    vi.advanceTimersByTime(240);
    const planned = getCore("demo-test").rounds[0];
    expect(selectPreplanThinkingText(planned)).toContain("示例思考");
    expect(planned.task?.title).toContain("交互演示");
    vi.advanceTimersByTime(480);
    const reporting = getCore("demo-test").rounds[0];
    expect(reporting.pending.get(reporting.activeMessageId!)?.phaseAtStart).toBe("report");
    expect(answer().text.length).toBeGreaterThan(0);
    expect(answer().text).toBe(selectConclusionText(reporting));
    expect(answer().text).not.toContain("示例思考");
    useWorkspace.getState().setDraft("完成后保留的草稿");
    vi.advanceTimersByTime(3360);
    const completed = getCore("demo-test").rounds[0];
    expect(completed.status).toBe("done");
    expect(completed.phaseStatuses).toEqual(["done", "done", "done"]);
    expect(answer()).toMatchObject({ phase: "completed", text: sampleReport, sources: sampleSources, fileIds: [`report-${messageId}`] });
    expect(useWorkspace.getState().files.find((file) => file.id === `report-${messageId}`)?.content).toBe(sampleReport);
    expect(useWorkspace.getState().drafts["demo-test"].text).toBe("完成后保留的草稿");
    expect([...getCore("demo-test").toolCalls.values()].find((tool) => tool.toolName === "示例参考入口")?.result).toMatchObject({ demo: true });
  });

  it("stops the engine round without discarding partial output or the next draft", () => {
    start();
    vi.advanceTimersByTime(1500);
    const partial = answer().text;
    expect(partial.length).toBeGreaterThan(0);
    useWorkspace.getState().setDraft("接下来核验供给");
    stopDemo("demo-test");
    vi.advanceTimersByTime(10000);
    expect(getCore("demo-test").rounds[0].status).toBe("aborted");
    expect(answer()).toMatchObject({ phase: "stopped", text: partial });
    expect(useWorkspace.getState().drafts["demo-test"].text).toBe("接下来核验供给");
    expect(useWorkspace.getState().files).toHaveLength(0);
  });

  it("uses the core failure terminal and retains output and draft", () => {
    start();
    vi.advanceTimersByTime(1500);
    const partial = answer().text;
    useWorkspace.getState().setDraft("失败后保留");
    failDemo("demo-test");
    vi.advanceTimersByTime(10000);
    expect(getCore("demo-test").rounds[0].status).toBe("failed");
    expect(answer()).toMatchObject({ phase: "failed", text: partial });
    expect(answer().error).toContain("演示中断");
    expect(useWorkspace.getState().drafts["demo-test"].text).toBe("失败后保留");
  });

  it("rehydrates earlier demo messages before adding another engine round", () => {
    useWorkspace.setState((state) => ({ sessions: state.sessions.map((session) => ({ ...session, messages: [
      { id: "old-user", role: "user", text: "上次研究", time: 10 },
      { id: "old-answer", role: "assistant", text: "上次输出", time: 11, phase: "completed" },
    ] })) }));
    start();
    stopAllDemo();
    expect(getCore("demo-test").rounds).toHaveLength(2);
    expect(getCore("demo-test").rounds[1].status).toBe("aborted");
    expect(useWorkspace.getState().sessions[0].messages.map((message) => message.text)).toEqual(["上次研究", "上次输出", "NVDA 研究", ""]);
  });
});
