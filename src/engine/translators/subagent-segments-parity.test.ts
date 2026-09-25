// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * S4.5-T 步骤 3b: segmentId 一致性 byte-equal verify（live ≡ history 不变性）。
 *
 * 不变性：对同一 subagent 逻辑事件流，
 *   live 路径   = liveToOps emit ops chain → reducer → state.subagents.get(id).segments
 *   history 路径 = historyToSubagentOps(messages) → reducer → state.subagents.get(id).segments
 * 两边 segments 数组应当 byte-equal（id + kind + text + 顺序）。
 *
 * **byte-equal 保证 lazy-load merge by id 自然去重**：当 live 已写入某 segmentId 后，
 * lazy-load 用同款 historyToSubagentOps 写入相同 segmentId → reducer findIndex 命中 → patch
 * 而非新 push（修 Bug 1a 整桶替换 race 的 root mechanism）。
 *
 * 这是 **合成 fixture** —— 真实 deep-research with subagent fixture 录制需要 dev 跑（按
 * plan §15.4 + handoff §5 录制流程）。本测试覆盖 5 类典型场景：
 *   1. 单 message text-only
 *   2. text 流式累积（live 多次 patch / history 一次写入）
 *   3. 多 message（msgIdx bump）
 *   4. thinking-fallback（thinking → tool start flush）
 *   5. tool batch（同 message 多 tool）
 *   6. phase-marker（task_create / task_update.complete_phase）
 */

import { describe, expect, it } from "vitest";
import type { Segment } from "../contracts/cards";
import { type HistoryMessage, historyToSubagentOps } from "./history";
import { liveToOps, type WsEvent } from "./live";
import { applyOps } from "../model/chat.reducer";
import {
  type ChatState,
  createInitialChatState,
  type RoundId,
  type SubagentId,
} from "../model/chat.types";
import type { ChatMessage } from "../contracts/protocol";

const sk = "agent:main:session:parity-sub";
const userMsg: ChatMessage = { id: "u-1", role: "user", content: "go", timestamp: 1 };

function bootstrapWithRound(): { state: ChatState; rid: RoundId } {
  const rid = `r-${sk}-0` as RoundId;
  const state = applyOps(createInitialChatState(), [
    {
      type: "round/start",
      roundId: rid,
      userMessage: userMsg,
      sessionKey: sk,
      roundIndex: 0,
      timestamp: 100,
    },
    {
      type: "subagent/spawn",
      parentRoundId: rid,
      subagentId: "sub1" as SubagentId,
      label: "research",
      timestamp: 100,
    },
  ]);
  return { state, rid };
}

/** 把 ws 事件序列喂 liveToOps + reducer，返回最终 state。 */
function runLive(events: WsEvent[]): ChatState {
  let state = bootstrapWithRound().state;
  for (const evt of events) {
    state = applyOps(state, liveToOps(evt, state));
  }
  return state;
}

/** 把 history transcript 喂 historyToSubagentOps + reducer。 */
function runHistory(messages: HistoryMessage[], subId: SubagentId, parentRid: RoundId): ChatState {
  const { state } = bootstrapWithRound();
  return applyOps(state, historyToSubagentOps(messages, subId, parentRid));
}

/** segments 比对：忽略 startedAt（live/history 用 Date.now() 不同），其他全 byte-equal。 */
function compareSegments(live: Segment[], hist: Segment[]) {
  expect(hist.length).toBe(live.length);
  for (let i = 0; i < live.length; i++) {
    const l = live[i]!;
    const h = hist[i]!;
    expect(h.kind).toBe(l.kind);
    expect(h.id).toBe(l.id);
    if (l.kind === "narration" && h.kind === "narration") {
      expect(h.text).toBe(l.text);
      expect(!!h.isThinkingFallback).toBe(!!l.isThinkingFallback);
    }
    if (l.kind === "tool-batch" && h.kind === "tool-batch") {
      expect(h.toolCallIds).toEqual(l.toolCallIds);
    }
    if (l.kind === "phase-marker" && h.kind === "phase-marker") {
      expect(h.action).toBe(l.action);
      expect(h.phaseIndex).toEqual(l.phaseIndex);
      expect(h.summaries).toEqual(l.summaries);
      expect(h.addedPhases).toEqual(l.addedPhases);
      expect(h.planPhaseCount).toBe(l.planPhaseCount);
    }
  }
}

describe("S4.5-T step 3b: subagent segmentId live ≡ history byte-equal", () => {
  it("场景 1: 单 message text-only → narration id 一致", () => {
    const liveState = runLive([
      // backend 推 message_start 边界 → live 派 subagent/message-start
      {
        event: "agent",
        payload: { stream: "assistant", data: { phase: "message_start", subagentId: "sub1" } },
      },
      // backend 推 fullText 一次（一帧到位）
      {
        event: "agent",
        payload: { stream: "assistant", data: { subagentId: "sub1", text: "hello world" } },
      },
    ]);

    const histState = runHistory(
      [{ role: "assistant", content: "hello world", timestamp: 1 }],
      "sub1" as SubagentId,
      `r-${sk}-0` as RoundId,
    );

    const liveSegs = liveState.subagents.get("sub1")!.segments;
    const histSegs = histState.subagents.get("sub1")!.segments;
    expect(liveSegs.length).toBe(1);
    expect(liveSegs[0]?.id).toBe("sub1:1:narration:0");
    compareSegments(liveSegs, histSegs);
  });

  it("场景 2: text 流式累积（live 3 次 patch）→ 终态 id + text 跟 history 一次写入一致", () => {
    const liveState = runLive([
      {
        event: "agent",
        payload: { stream: "assistant", data: { phase: "message_start", subagentId: "sub1" } },
      },
      // 流式 3 帧累积全量
      { event: "agent", payload: { stream: "assistant", data: { subagentId: "sub1", text: "h" } } },
      {
        event: "agent",
        payload: { stream: "assistant", data: { subagentId: "sub1", text: "hello" } },
      },
      {
        event: "agent",
        payload: { stream: "assistant", data: { subagentId: "sub1", text: "hello world" } },
      },
    ]);

    const histState = runHistory(
      [{ role: "assistant", content: "hello world", timestamp: 1 }],
      "sub1" as SubagentId,
      `r-${sk}-0` as RoundId,
    );

    // 流式 3 次 patch 后只剩 1 段（mirror 老 startsWith patch）
    expect(liveState.subagents.get("sub1")!.segments.length).toBe(1);
    compareSegments(
      liveState.subagents.get("sub1")!.segments,
      histState.subagents.get("sub1")!.segments,
    );
  });

  it("场景 3: 两条 message（msgIdx bump）→ 各自 segmentId 跟 history 对齐", () => {
    const liveState = runLive([
      {
        event: "agent",
        payload: { stream: "assistant", data: { phase: "message_start", subagentId: "sub1" } },
      },
      {
        event: "agent",
        payload: { stream: "assistant", data: { subagentId: "sub1", text: "first" } },
      },
      {
        event: "agent",
        payload: { stream: "assistant", data: { phase: "message_start", subagentId: "sub1" } },
      },
      {
        event: "agent",
        payload: { stream: "assistant", data: { subagentId: "sub1", text: "second" } },
      },
    ]);

    const histState = runHistory(
      [
        { role: "assistant", content: "first", timestamp: 1 },
        { role: "assistant", content: "second", timestamp: 2 },
      ],
      "sub1" as SubagentId,
      `r-${sk}-0` as RoundId,
    );

    const liveSegs = liveState.subagents.get("sub1")!.segments;
    expect(liveSegs.map((s) => s.id)).toEqual(["sub1:1:narration:0", "sub1:2:narration:0"]);
    compareSegments(liveSegs, histState.subagents.get("sub1")!.segments);
  });

  it("场景 4: thinking-fallback（无 text + tool start flush）→ id 跟 kind 跟 history 对齐", () => {
    const liveState = runLive([
      {
        event: "agent",
        payload: { stream: "assistant", data: { phase: "message_start", subagentId: "sub1" } },
      },
      // 仅 thinking，没 text
      {
        event: "agent",
        payload: { stream: "thinking", data: { subagentId: "sub1", text: "ponder…" } },
      },
      // tool start 触发 flush → 派生 thinking-fallback narration + tool-batch
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: { subagentId: "sub1", toolCallId: "t1", toolName: "fetch", args: { q: 1 } },
        },
      },
    ]);

    const histState = runHistory(
      [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "ponder…" },
            { type: "tool_use", id: "t1", name: "fetch", input: { q: 1 } },
          ],
          timestamp: 1,
        },
      ],
      "sub1" as SubagentId,
      `r-${sk}-0` as RoundId,
    );

    const liveSegs = liveState.subagents.get("sub1")!.segments;
    // 顺序：thinking-fallback narration → tool-batch
    expect(liveSegs.map((s) => s.kind)).toEqual(["narration", "tool-batch"]);
    expect(liveSegs[0]?.id).toBe("sub1:1:narration:0");
    expect(liveSegs[1]?.id).toBe("sub1:1:tool-batch:0");
    compareSegments(liveSegs, histState.subagents.get("sub1")!.segments);
  });

  it("场景 5: tool batch 同 message 内合并多 tool", () => {
    const liveState = runLive([
      {
        event: "agent",
        payload: { stream: "assistant", data: { phase: "message_start", subagentId: "sub1" } },
      },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: { subagentId: "sub1", toolCallId: "t1", toolName: "fetch", args: {} },
        },
      },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: { subagentId: "sub1", toolCallId: "t2", toolName: "fetch", args: {} },
        },
      },
    ]);

    const histState = runHistory(
      [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "fetch", input: {} },
            { type: "tool_use", id: "t2", name: "fetch", input: {} },
          ],
          timestamp: 1,
        },
      ],
      "sub1" as SubagentId,
      `r-${sk}-0` as RoundId,
    );

    const liveSegs = liveState.subagents.get("sub1")!.segments;
    expect(liveSegs.length).toBe(1);
    expect(liveSegs[0]?.kind).toBe("tool-batch");
    if (liveSegs[0]?.kind !== "tool-batch") throw new Error("expected tool-batch");
    expect(liveSegs[0].toolCallIds).toEqual(["t1", "t2"]);
    expect(liveSegs[0].id).toBe("sub1:1:tool-batch:0");
    compareSegments(liveSegs, histState.subagents.get("sub1")!.segments);
  });

  it("场景 6: phase-marker（task_create + task_update.complete_phase）id 一致", () => {
    const liveState = runLive([
      {
        event: "agent",
        payload: { stream: "assistant", data: { phase: "message_start", subagentId: "sub1" } },
      },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            subagentId: "sub1",
            toolCallId: "tc-create",
            toolName: "task_create",
            args: { phases: [{ description: "p0" }, { description: "p1" }] },
          },
        },
      },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            subagentId: "sub1",
            toolCallId: "tc-up",
            toolName: "task_update",
            args: { action: "complete_phase", phase_index: 0, summary: "ok" },
          },
        },
      },
    ]);

    const histState = runHistory(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tc-create",
              name: "task_create",
              input: { phases: [{ description: "p0" }, { description: "p1" }] },
            },
            {
              type: "tool_use",
              id: "tc-up",
              name: "task_update",
              input: { action: "complete_phase", phase_index: 0, summary: "ok" },
            },
          ],
          timestamp: 1,
        },
      ],
      "sub1" as SubagentId,
      `r-${sk}-0` as RoundId,
    );

    const liveSegs = liveState.subagents.get("sub1")!.segments;
    expect(liveSegs.length).toBe(2);
    expect(liveSegs.map((s) => s.kind)).toEqual(["phase-marker", "phase-marker"]);
    expect(liveSegs[0]?.id).toBe("sub1:1:phase-marker:0");
    expect(liveSegs[1]?.id).toBe("sub1:1:phase-marker:1");
    compareSegments(liveSegs, histState.subagents.get("sub1")!.segments);
  });

  it("Bug 1a 修法验证: live 已写 segments 后再 apply history ops → merge by id 不重复", () => {
    // 步 1: live 流写入 1 段 narration + 1 段 tool-batch
    let state = runLive([
      {
        event: "agent",
        payload: { stream: "assistant", data: { phase: "message_start", subagentId: "sub1" } },
      },
      {
        event: "agent",
        payload: { stream: "assistant", data: { subagentId: "sub1", text: "live text" } },
      },
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: { subagentId: "sub1", toolCallId: "t1", toolName: "fetch", args: {} },
        },
      },
    ]);
    const liveSegCount = state.subagents.get("sub1")!.segments.length;
    expect(liveSegCount).toBe(2);

    // 步 2: lazy load 模拟——同款 transcript 喂 historyToSubagentOps，应用到已含 live segments 的 state
    const ops = historyToSubagentOps(
      [
        {
          role: "assistant",
          content: [
            { type: "text", text: "live text" },
            { type: "tool_use", id: "t1", name: "fetch", input: {} },
          ],
          timestamp: 1,
        },
      ],
      "sub1" as SubagentId,
      `r-${sk}-0` as RoundId,
    );
    state = applyOps(state, ops);

    // 步 3: segmentId 命中 → reducer patch 而非 append → 长度仍 2
    expect(state.subagents.get("sub1")!.segments.length).toBe(2);
  });
});
