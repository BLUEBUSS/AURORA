import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  chatReducer,
  createInitialChatState,
  type ChatOp,
  type Round,
  type ToolCallData,
} from "../../engine";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { ResearchActivity } from "./ResearchActivity";
import { TaskPlanDetails } from "./TaskPlanDetails";
import { ToolCallDetails } from "./ToolCallDetails";

afterEach(cleanup);

function seedState() {
  return chatReducer(createInitialChatState(), {
    type: "round/start",
    roundId: "round-1",
    roundIndex: 0,
    sessionKey: "agent:main:research",
    timestamp: 1000,
    userMessage: { id: "user-1", role: "user", content: "研究芯片供需", timestamp: 1000 },
  });
}

describe("research process presentation", () => {
  it("replaces pre-token waiting with event-driven thinking and folds it on completion", () => {
    let state = seedState();
    const view = render(<ResearchActivity round={state.rounds[0]} />);
    expect(screen.getByRole("status", { name: "正在准备回复" })).toBeTruthy();
    const ops: ChatOp[] = [
      { type: "message/start", roundId: "round-1", messageId: "message-1", timestamp: 1100 },
      {
        type: "message/set-thinking",
        roundId: "round-1",
        messageId: "message-1",
        fullText: "先核对**产能证据**与财报。",
      },
    ];
    for (const op of ops) state = chatReducer(state, op);
    view.rerender(<ResearchActivity round={state.rounds[0]} />);
    expect(screen.queryByRole("status", { name: "正在准备回复" })).toBeNull();
    expect(screen.queryByText("产能证据")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "思考中…" }));
    expect(screen.getByText("产能证据")).toBeTruthy();
    expect(screen.getByText("思考中…")).toBeTruthy();

    state = chatReducer(state, {
      type: "message/end",
      roundId: "round-1",
      messageId: "message-1",
      timestamp: 1200,
    });
    state = chatReducer(state, {
      type: "round/complete",
      roundId: "round-1",
      status: "done",
      timestamp: 1300,
    });
    view.rerender(<ResearchActivity round={state.rounds[0]} />);
    const toggle = screen.getByRole("button", { name: "思考完成" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("产能证据")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("产能证据")).toBeTruthy();
  });

  it("keeps failed, skipped, and pending phases distinct from completed phases", () => {
    const round: Round = {
      ...seedState().rounds[0],
      status: "done",
      task: {
        title: "核验产业链",
        phases: ["需求", "供给", "估值", "风险"].map((description) => ({ description })),
      },
      phaseStatuses: ["done", "failed", "skipped", "pending"],
    };
    render(<TaskPlanDetails round={round} />);
    expect(screen.getByText("1/4 完成")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: /核验产业链/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByText("待执行")).toBeTruthy();
    expect(screen.getByText("已跳过")).toBeTruthy();
    expect(screen.getByText("失败")).toBeTruthy();
    expect(screen.queryByText("执行中")).toBeNull();
  });

  it("exposes only returned tool results and stops unfinished tools after abort", () => {
    const tool: ToolCallData = {
      callId: "tool-1",
      toolName: "financial_analysis",
      title: "核验财报",
      status: "running",
    };
    const view = render(<ToolCallDetails tool={tool} roundStatus="streaming" />);
    fireEvent.click(screen.getByRole("button", { name: /核验财报/ }));
    expect(screen.getByText("等待工具返回结果…")).toBeTruthy();
    view.rerender(<ToolCallDetails tool={tool} roundStatus="aborted" />);
    expect(screen.getByText("未收到结果")).toBeTruthy();
    expect(view.container.querySelector(".research-process-spin")).toBeNull();
    const returned = {
      ...tool,
      status: "success" as const,
      result: { content: [{ type: "text", text: "已取得**原始公告**。" }] },
    };
    view.rerender(<ToolCallDetails tool={returned} roundStatus="done" />);
    expect(screen.getByText("原始公告")).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
  });

  it("keeps tool failures visible while details are folded", () => {
    render(
      <ToolCallDetails
        tool={{
          callId: "tool-error",
          toolName: "web_search",
          status: "error",
          result: { error: "数据源请求超时" },
        }}
        roundStatus="done"
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("数据源请求超时");
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("错误详情")).toBeTruthy();
  });

  it("orders timeline records by event timestamps without mutating the round", () => {
    const round = seedState().rounds[0];
    round.segments = [
      { kind: "narration", id: "later", text: "后到阶段", startedAt: 2000, context: {} },
      { kind: "narration", id: "earlier", text: "先到阶段", startedAt: 1500, context: {} },
    ];
    const view = render(<ExecutionTimeline round={round} />);
    expect(
      [...view.container.querySelectorAll("[data-segment-id]")].map((node) =>
        node.getAttribute("data-segment-id"),
      ),
    ).toEqual(["earlier", "later"]);
    expect(round.segments.map((segment) => segment.id)).toEqual(["later", "earlier"]);
  });
});
