// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * S4.1 verify-1: live-flow byte-equal verification。
 *
 * 老路径在生产里走的是 chat-event-handler.ts 喂老 store；新路径走 liveToOps + applyOps
 * 喂 chatV2。S4.1 切渲染层依赖 chatV2 在 live 流式期间的 conclusion 文本跟老路径一致。
 *
 * 这个测试不模拟全套 chat-event-handler（太重）；而是对一条假定的"理想 live 路径"出 op：
 * 用户期待 phase 推进 → conclusion 累加。如果 v1 translator 漏了关键事件类型
 * （task_create / task_update plan 提取），新路径会停留在 pre-plan，post-plan 文本
 * 全部走 preplan-content → 跟老路径在 deep-research 场景下不一致。
 */

import { describe, expect, it } from "vitest";
import { type WsEvent, liveToOps } from "./live";
import { ChatId } from "../model/chat.id";
import { applyOps, phaseOfRound } from "../model/chat.reducer";
import { selectConclusionText } from "../model/chat.selectors";
import { type ChatState, createInitialChatState } from "../model/chat.types";
import type { ChatMessage } from "../contracts/protocol";

const sk = "agent:main:session:liveeq";
const userMessage: ChatMessage = { id: "u-1", role: "user", content: "q", timestamp: 1 };

function bootstrapRound(): ChatState {
  return applyOps(createInitialChatState(), [
    {
      type: "round/start",
      roundId: ChatId.round(sk, 0),
      userMessage,
      sessionKey: sk,
      roundIndex: 0,
      timestamp: 100,
    },
  ]);
}

function feedEvents(state: ChatState, events: WsEvent[]): ChatState {
  let s = state;
  for (const evt of events) {
    s = applyOps(s, liveToOps(evt, s));
  }
  return s;
}

describe("S2.5 verify-1: live-flow phase 推进 + post-plan delta 路由", () => {
  it("含 task_create tool 事件 → chatV2 应进入 execution 阶段", () => {
    const events: WsEvent[] = [
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      { event: "chat", payload: { state: "delta", message: { text: "我来规划" } } },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            phase: "tool_use",
            toolCallId: "tc1",
            toolName: "task_create",
            args: {
              plan: {
                id: "p",
                groups: [
                  { id: "g", title: "g", type: "serial", steps: [{ id: "s1", status: "pending" }] },
                ],
              },
            },
          },
        },
      },
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      { event: "chat", payload: { state: "delta", message: { text: "执行中文本" } } },
    ];
    let state = bootstrapRound();
    state = feedEvents(state, events);
    const round = state.rounds[0];
    if (!round) throw new Error("expected round");
    // 期待：进入 execution 阶段（task 已被 set）
    expect(phaseOfRound(round)).toBe("execution");
  });

  it("task_update.complete_phase → phase status 推进 done", () => {
    const events: WsEvent[] = [
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            phase: "tool_use",
            toolCallId: "tc1",
            toolName: "task_create",
            args: {
              groups: [
                {
                  id: "g",
                  title: "g",
                  type: "serial",
                  steps: [
                    { id: "s1", status: "running" },
                    { id: "s2", status: "pending" },
                  ],
                },
              ],
            },
          },
        },
      },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            phase: "tool_use",
            toolCallId: "tu1",
            toolName: "task_update",
            args: { action: "complete_phase", phase_index: 0, summary: "ok" },
          },
        },
      },
    ];
    let state = bootstrapRound();
    state = feedEvents(state, events);
    const round = state.rounds[0];
    if (!round) throw new Error("expected round");
    const step = round.task?.groups?.[0]?.steps?.[0];
    expect(step?.status).toBe("done");
  });

  it("task_update.add_phases → 新 phase 追加进 task plan", () => {
    const events: WsEvent[] = [
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            phase: "tool_use",
            toolCallId: "tc1",
            toolName: "task_create",
            args: {
              groups: [
                { id: "g", title: "g", type: "serial", steps: [{ id: "s1", status: "running" }] },
              ],
            },
          },
        },
      },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            phase: "tool_use",
            toolCallId: "tu1",
            toolName: "task_update",
            args: {
              action: "add_phases",
              new_phases: [{ description: "newly added phase" }],
            },
          },
        },
      },
    ];
    let state = bootstrapRound();
    state = feedEvents(state, events);
    const round = state.rounds[0];
    if (!round) throw new Error("expected round");
    expect(round.task?.groups?.[0]?.steps.length).toBe(2);
  });

  it("§3.2（2026-05-20 恢复）: post-plan text + 无 tool → left-conclusion（进 conclusion）", () => {
    const events: WsEvent[] = [
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            phase: "tool_use",
            toolCallId: "tc1",
            toolName: "task_create",
            args: {
              plan: {
                id: "p",
                groups: [
                  { id: "g", title: "g", type: "serial", steps: [{ id: "s1", status: "running" }] },
                ],
              },
            },
          },
        },
      },
      // post-plan 纯 text 无 tool：model 终止 / 给结论
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      { event: "chat", payload: { state: "delta", message: { text: "最终报告" } } },
      { event: "chat", payload: { state: "final" } },
    ];
    let state = bootstrapRound();
    state = feedEvents(state, events);
    const round = state.rounds[0];
    if (!round) throw new Error("expected round");
    // 依据：execute + text + no tool → left-conclusion（model 输出无 tool = 终止信号）
    expect(selectConclusionText(round)).toBe("最终报告");
  });

  it("hotfix: execution + chat:delta text + task_update.args → text 不进 conclusion（归 right-narration）", () => {
    // 复现 manual QA 报的 bug：
    //   message #N: text="数据采集基本完成，现在汇总关键数据并更新阶段进度。"
    //   message #N: task_update.complete_phase
    //   → 老路径正确：text 留右栏；
    //   → S2.5 修前：translator emit task_update phase op 但漏 record-tool，
    //     classify 看不到 toolNamesSeen → text 归 left-conclusion 错漏。
    const events: WsEvent[] = [
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      // task_create + result：进入 execution 阶段
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            toolCallId: "tc1",
            toolName: "task_create",
            args: {
              groups: [
                {
                  id: "g",
                  title: "g",
                  type: "serial",
                  steps: [
                    { id: "s1", status: "running" },
                    { id: "s2", status: "pending" },
                  ],
                },
              ],
            },
          },
        },
      },
      // 新 message：含 chat:delta text + task_update.args（同 message_id 内）
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      {
        event: "chat",
        payload: {
          state: "delta",
          message: { text: "数据采集基本完成，现在汇总关键数据并更新阶段进度。" },
        },
      },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            toolCallId: "tu1",
            toolName: "task_update",
            args: { action: "complete_phase", phase_index: 0, summary: "数据采集完成" },
          },
        },
      },
      { event: "chat", payload: { state: "final" } },
    ];
    let state = bootstrapRound();
    state = feedEvents(state, events);
    const round = state.rounds[0];
    if (!round) throw new Error("expected round");
    // 关键断言：execution + text + 含 task_update tool → right-narration，不进 conclusion
    expect(selectConclusionText(round)).toBe("");
  });
});
