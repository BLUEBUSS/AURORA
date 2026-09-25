// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import { describe, expect, it } from "vitest";
import { deriveRoundStartOp, liveToOps, translateTaskUpdateArgs } from "./live";
import { ChatId } from "../model/chat.id";
import type { ChatOp } from "../model/chat.ops";
import { applyOps } from "../model/chat.reducer";
import { type ChatState, createInitialChatState } from "../model/chat.types";
import type { ChatMessage } from "../contracts/protocol";



const userMsg: ChatMessage = { id: "u-1", role: "user", content: "hi", timestamp: 1 };



function bootstrapWithRound(): ChatState {
  const s0 = createInitialChatState();
  const startOp = deriveRoundStartOp(s0, "s", userMsg);
  return applyOps(s0, [startOp]);
}



function bootstrapWithMessage(): { state: ChatState; rid: string; mid: string } {
  const s = bootstrapWithRound();
  const round = s.rounds[0];
  if (!round) throw new Error("setup failed");
  const mid = ChatId.message(round.id, 0);
  const next = applyOps(s, [
    { type: "message/start", roundId: round.id, messageId: mid, timestamp: 100 },
  ]);
  return { state: next, rid: round.id, mid };
}



describe("task_update phase 边界", () => {
  it("五阶段计划收到 phase_index=5 时，转成完整计划完成而不是任务 6", () => {
    const ops = translateTaskUpdateArgs(
      "r0",
      {
        action: "complete_phase",
        phase_index: 5,
        summary: "全部深度分析完成",
      },
      { messageId: "m1", toolCallId: "t1" },
      5,
    );

    expect(ops.some((op) => op.type === "task/update-phase")).toBe(false);
    expect(ops.some((op) => op.type === "task/complete-all")).toBe(true);
    const marker = ops.find((op) => op.type === "segment/add-phase-marker");
    expect(marker?.type === "segment/add-phase-marker" && marker.phaseIndex).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("越界的失败上报不会误把整个计划标记为完成", () => {
    const ops = translateTaskUpdateArgs(
      "r0",
      { action: "fail_phase", phase_index: 5, reason: "failed" },
      { messageId: "m1", toolCallId: "t1" },
      5,
    );
    expect(ops).toEqual([]);
  });
});



// ── deriveRoundStartOp ──────────────────────────────────────────────────

describe("deriveRoundStartOp", () => {
  it("空 state → roundIndex 0", () => {
    const s0 = createInitialChatState();
    const op = deriveRoundStartOp(s0, "s", userMsg);
    expect(op.type === "round/start" && op.roundIndex).toBe(0);
    expect(op.type === "round/start" && op.roundId).toBe(ChatId.round("s", 0));
  });

  it("已有 N 条同 sessionKey rounds → roundIndex N", () => {
    let s = createInitialChatState();
    s = applyOps(s, [deriveRoundStartOp(s, "s", userMsg)]);
    s = applyOps(s, [deriveRoundStartOp(s, "s", userMsg)]);
    const op = deriveRoundStartOp(s, "s", userMsg);
    expect(op.type === "round/start" && op.roundIndex).toBe(2);
  });

  it("不同 sessionKey 不互相干扰", () => {
    let s = createInitialChatState();
    s = applyOps(s, [deriveRoundStartOp(s, "s1", userMsg)]);
    const op = deriveRoundStartOp(s, "s2", userMsg);
    expect(op.type === "round/start" && op.roundIndex).toBe(0);
  });
});



// ── chat:delta ──────────────────────────────────────────────────────────

describe("translate chat:delta", () => {
  it("无活跃 round → 返回空 ops", () => {
    const s = createInitialChatState();
    const ops = liveToOps(
      { event: "chat", payload: { state: "delta", message: { text: "hi" } } },
      s,
    );
    expect(ops).toEqual([]);
  });

  it("有活跃 round 但无 active message → 严格丢弃 stray delta（修 task_create text race）", () => {
    // race 修法（2026-05）：activeMessageId null 时 chat:delta 是 stray（backend 在切下一
    // message 后 force-flush 上一 message 的 fullText / 或 message_start 边界 race）。
    // 旧行为：隐式开 messageId 派 message/start——让 task_create text 流到下一 message pending
    // → classify 错归 right-narration → narration 重复显示。
    // 新行为：丢弃 → 等下一帧 backend message_start + chat:delta 一起来再正确写入。
    const s = bootstrapWithRound();
    const ops = liveToOps(
      { event: "chat", payload: { state: "delta", message: { text: "hello" } } },
      s,
    );
    expect(ops).toEqual([]);
  });

  it("v1.4: 有 active message + 累积全量更新 → set 覆盖（无 delta 派生）", () => {
    const { state, rid, mid } = bootstrapWithMessage();
    const s = applyOps(state, [
      { type: "message/set-text", roundId: rid, messageId: mid, fullText: "hello" } as ChatOp,
    ]);
    const ops = liveToOps(
      { event: "chat", payload: { state: "delta", message: { text: "hello world" } } },
      s,
    );
    expect(ops.length).toBe(1);
    const op = ops[0];
    expect(op?.type === "message/set-text" && op.fullText).toBe("hello world");
  });

  it("v1.4: 累积文本 === 前次值 → reducer 内幂等短路", () => {
    const { state, rid, mid } = bootstrapWithMessage();
    const s = applyOps(state, [
      { type: "message/set-text", roundId: rid, messageId: mid, fullText: "abc" } as ChatOp,
    ]);
    const ops = liveToOps(
      { event: "chat", payload: { state: "delta", message: { text: "abc" } } },
      s,
    );
    // translator 仍会 emit set-text，reducer 检测 contentText === fullText 短路
    expect(ops.length).toBe(1);
    expect(ops[0]?.type === "message/set-text" && ops[0].fullText).toBe("abc");
  });

  it("v1.4: 散度场景（新 fullText 不以 prev 开头）→ set 覆盖（修复重复 bug）", () => {
    const { state, rid, mid } = bootstrapWithMessage();
    const s = applyOps(state, [
      { type: "message/set-text", roundId: rid, messageId: mid, fullText: "abc" } as ChatOp,
    ]);
    const ops = liveToOps(
      { event: "chat", payload: { state: "delta", message: { text: "xyz" } } },
      s,
    );
    expect(ops.length).toBe(1);
    expect(ops[0]?.type === "message/set-text" && ops[0].fullText).toBe("xyz");
  });
});



// ── chat:final / error / aborted ────────────────────────────────────────

describe("translate chat terminal", () => {
  it("chat:final 有 active message → emit message/end + round/complete done", () => {
    const { state } = bootstrapWithMessage();
    const ops = liveToOps({ event: "chat", payload: { state: "final" } }, state);
    expect(ops.map((o) => o.type)).toEqual(["message/end", "round/complete"]);
    const completeOp = ops[1];
    expect(completeOp?.type === "round/complete" && completeOp.status).toBe("done");
  });

  it("chat:error → round/complete failed", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps({ event: "chat", payload: { state: "error" } }, s);
    const completeOp = ops[ops.length - 1];
    expect(completeOp?.type === "round/complete" && completeOp.status).toBe("failed");
  });

  it("chat:aborted → round/complete aborted", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps({ event: "chat", payload: { state: "aborted" } }, s);
    const completeOp = ops[ops.length - 1];
    expect(completeOp?.type === "round/complete" && completeOp.status).toBe("aborted");
  });
});



// ── agent:assistant message_start ───────────────────────────────────────

describe("translate agent:assistant message_start", () => {
  it("有上一条活跃 message → emit message/end + message/start", () => {
    const { state } = bootstrapWithMessage();
    const ops = liveToOps(
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      state,
    );
    expect(ops.map((o) => o.type)).toEqual(["message/end", "message/start"]);
  });

  it("无上一条活跃 message → 仅 emit message/start", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps(
      { event: "agent", payload: { stream: "assistant", data: { phase: "message_start" } } },
      s,
    );
    expect(ops.map((o) => o.type)).toEqual(["message/start"]);
  });

  it("subagent message_start → ensureSpawn + subagent/message-start（S4.5-T）", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps(
      {
        event: "agent",
        payload: { stream: "assistant", data: { phase: "message_start", subagentId: "sub1" } },
      },
      s,
    );
    expect(ops.map((o) => o.type)).toEqual(["subagent/spawn", "subagent/message-start"]);
  });
});



// ── agent:lifecycle subagent ────────────────────────────────────────────

describe("translate agent:lifecycle subagent", () => {
  it("subagent start → subagent/spawn", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "lifecycle",
          data: { phase: "start", subagentId: "sub1", subagentLabel: "research" },
        },
      },
      s,
    );
    expect(ops.length).toBe(1);
    const spawnOp = ops[0];
    expect(spawnOp?.type === "subagent/spawn" && spawnOp.label).toBe("research");
  });

  it("subagent end → subagent/lifecycle-end status=done", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps(
      {
        event: "agent",
        payload: { stream: "lifecycle", data: { phase: "end", subagentId: "sub1" } },
      },
      s,
    );
    expect(ops.length).toBe(1);
    const endOp = ops[0];
    expect(endOp?.type === "subagent/lifecycle-end" && endOp.status).toBe("done");
  });

  it("subagent error → status=failed", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps(
      {
        event: "agent",
        payload: { stream: "lifecycle", data: { phase: "error", subagentId: "sub1" } },
      },
      s,
    );
    const endOp = ops[0];
    expect(endOp?.type === "subagent/lifecycle-end" && endOp.status).toBe("failed");
  });
});



// ── agent:tool ──────────────────────────────────────────────────────────

describe("translate agent:tool", () => {
  it("tool 开始 → tool/start + message/record-tool（有活跃 message 时）", () => {
    const { state } = bootstrapWithMessage();
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: { phase: "tool_use", toolCallId: "t1", toolName: "x", args: { q: 1 } },
        },
      },
      state,
    );
    expect(ops.map((o) => o.type)).toEqual(["tool/start", "message/record-tool"]);
  });

  it("S4.x-T: task_checkpoint args → task/checkpoint + round/checkpoint-silence", () => {
    const { state } = bootstrapWithMessage();
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            toolCallId: "ck1",
            toolName: "task_checkpoint",
            args: {
              type: "confirm",
              message: "继续？",
              options: ["是", "否"],
            },
          },
        },
      },
      state,
    );
    const types = ops.map((o) => o.type);
    expect(types).toContain("task/checkpoint");
    expect(types).toContain("round/checkpoint-silence");
  });

  it("S4.x-T: task_checkpoint 缺 message → 不发 op", () => {
    const { state } = bootstrapWithMessage();
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: { toolCallId: "ck2", toolName: "task_checkpoint", args: { type: "suggest" } },
        },
      },
      state,
    );
    expect(ops.find((o) => o.type === "task/checkpoint")).toBeUndefined();
  });

  it("S4.x-T: task_create with phases-only → normalizePlan 后 emit task/set-plan with groups", () => {
    const { state } = bootstrapWithMessage();
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            phase: "tool_use",
            toolCallId: "tc1",
            toolName: "task_create",
            args: { plan: { id: "p", phases: [{ description: "查询" }] } },
          },
        },
      },
      state,
    );
    const setPlanOp = ops.find((o) => o.type === "task/set-plan");
    expect(setPlanOp).toBeDefined();
    if (setPlanOp?.type === "task/set-plan") {
      expect(setPlanOp.plan.groups?.[0]?.steps[0]?.id).toBe("phase-1");
      expect(setPlanOp.plan.groups?.[0]?.steps[0]?.status).toBe("pending");
      expect(setPlanOp.plan.phases).toEqual([{ description: "查询" }]);
    }
  });

  it("v1.8 兜底: task_update args+result 同帧发 → result 分支补 emit task/update-phase（修 execute 阶段刷新后 phaseStatuses 不推进 bug）", () => {
    const { state } = bootstrapWithMessage();
    // 模拟 backend 合帧发：data 同时含 args 和 result（WS 重连后续推可能合帧）
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            toolCallId: "tu1",
            toolName: "task_update",
            args: { action: "complete_phase", phase_index: 2, summary: "done" },
            result: { ok: true },
          },
        },
      },
      state,
    );
    // 走 isToolResult 分支（hasResult=true），但应仍 emit task/update-phase
    const updateOp = ops.find(
      (o): o is Extract<typeof o, { type: "task/update-phase" }> => o.type === "task/update-phase",
    );
    expect(updateOp).toBeDefined();
    expect(updateOp?.phaseIndex).toBe(2);
    expect(updateOp?.status).toBe("done");
  });

  it("S4.4-T: task_create args → emit task/set-plan + segment/add-phase-marker(create)", () => {
    const { state } = bootstrapWithMessage();
    const ops = liveToOps(
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
                phases: [{ description: "a" }, { description: "b" }],
              },
            },
          },
        },
      },
      state,
    );
    const markerOp = ops.find(
      (o): o is Extract<typeof o, { type: "segment/add-phase-marker" }> =>
        o.type === "segment/add-phase-marker",
    );
    expect(markerOp).toBeDefined();
    expect(markerOp?.action).toBe("create");
    expect(markerOp?.payload.planPhaseCount).toBe(2);
    expect(markerOp?.payload.toolCallId).toBe("tc1");
  });

  it("S4.4-T: task_update.complete_phase args → emit task/update-phase + segment/add-phase-marker(complete)", () => {
    const { state } = bootstrapWithMessage();
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            phase: "tool_use",
            toolCallId: "tu1",
            toolName: "task_update",
            args: { action: "complete_phase", phase_index: 1, summary: "done" },
          },
        },
      },
      state,
    );
    const markerOp = ops.find(
      (o): o is Extract<typeof o, { type: "segment/add-phase-marker" }> =>
        o.type === "segment/add-phase-marker",
    );
    expect(markerOp).toBeDefined();
    expect(markerOp?.action).toBe("complete");
    expect(markerOp?.phaseIndex).toBe(1);
    expect(markerOp?.payload.summaries).toEqual(["done"]);
    expect(markerOp?.payload.toolCallId).toBe("tu1");
  });

  it("S4.4-T: task_update.add_phases → emit task/add-phases + segment/add-phase-marker(add)", () => {
    const { state } = bootstrapWithMessage();
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            phase: "tool_use",
            toolCallId: "tu2",
            toolName: "task_update",
            args: {
              action: "add_phases",
              new_phases: [{ description: "new1" }, { description: "new2" }],
            },
          },
        },
      },
      state,
    );
    const markerOp = ops.find(
      (o): o is Extract<typeof o, { type: "segment/add-phase-marker" }> =>
        o.type === "segment/add-phase-marker",
    );
    expect(markerOp).toBeDefined();
    expect(markerOp?.action).toBe("add");
    expect(markerOp?.payload.addedPhases).toEqual(["new1", "new2"]);
  });

  it("v1.5 §20.14 实施备忘: wrapped Reasoning thinking 多帧 cumulative → strip 后不堆叠（修 indexed thinking append bug）", () => {
    // backend stream:thinking 推 `Reasoning:\n_<content>_` wrapper：closing _ 浮动。
    // 修法前：未 strip 时 mergeFullText prefix 比较失败 → rule 5 误判独立 block → 反复 append。
    const { state: state0 } = bootstrapWithMessage();
    const events = [
      { event: "agent", payload: { stream: "thinking", data: { text: "Reasoning:\n_Let _" } } },
      {
        event: "agent",
        payload: { stream: "thinking", data: { text: "Reasoning:\n_Let me first_" } },
      },
      {
        event: "agent",
        payload: {
          stream: "thinking",
          data: { text: "Reasoning:\n_Let me first read the SKILL.md_" },
        },
      },
    ];
    let state = state0;
    for (const evt of events) {
      const ops = liveToOps(evt, state);
      state = applyOps(state, ops);
    }
    const round = state.rounds[0];
    if (!round) throw new Error("expected round");
    const msgId = round.activeMessageId;
    if (!msgId) throw new Error("expected active message");
    const pending = round.pending.get(msgId);
    // strip 后是 cumulative growth → 最终 thinkingText 仅含最后一帧的内容（不堆叠）
    expect(pending?.thinkingText).toBe("Let me first read the SKILL.md");
  });

  it("v1.8 关键修法: agent stream:task_update 携带 plan snapshot → 翻译为 task/set-plan + 各 phase task/update-phase", () => {
    // backend sessionKey 路由的 task_update event（chat-event-handler.ts:1179 老路径对应）
    // execute 阶段刷新后 WS 续推必经此路径推 phase 状态，之前 chatV2 漏处理
    const { state } = bootstrapWithMessage();
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "task_update",
          data: {
            name: "task_update",
            plan: {
              id: "p",
              phases: [{ description: "p1" }, { description: "p2" }, { description: "p3" }],
              groups: [
                {
                  id: "g1",
                  title: "g1",
                  type: "serial",
                  steps: [
                    { id: "phase-1", status: "done", output_summary: "ok1" },
                    { id: "phase-2", status: "running" },
                    { id: "phase-3", status: "pending" },
                  ],
                },
              ],
            },
          },
        },
      },
      state,
    );
    // 应有 task/set-plan + 2 条 task/update-phase（pending 不 emit）
    const setPlanOps = ops.filter((o) => o.type === "task/set-plan");
    const updatePhaseOps = ops.filter(
      (o): o is Extract<typeof o, { type: "task/update-phase" }> => o.type === "task/update-phase",
    );
    expect(setPlanOps.length).toBe(1);
    expect(updatePhaseOps.length).toBe(2);
    expect(updatePhaseOps[0]?.phaseIndex).toBe(0);
    expect(updatePhaseOps[0]?.status).toBe("done");
    expect(updatePhaseOps[0]?.result).toBe("ok1");
    expect(updatePhaseOps[1]?.phaseIndex).toBe(1);
    expect(updatePhaseOps[1]?.status).toBe("running");
  });

  it("v1.8 task_update stream: 无 plan 字段 → 不 emit ops", () => {
    const { state } = bootstrapWithMessage();
    const ops = liveToOps(
      {
        event: "agent",
        payload: { stream: "task_update", data: { name: "task_update" } },
      },
      state,
    );
    expect(ops).toEqual([]);
  });

  it("result-only 工具事件 → 合成 start，再写 result 和 record-tool", () => {
    const { state } = bootstrapWithMessage();
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: { phase: "tool_result", toolCallId: "t1", toolName: "x", result: { ok: true } },
        },
      },
      state,
    );
    expect(ops.map((o) => o.type)).toEqual(["tool/start", "tool/result", "message/record-tool"]);
    const resOp = ops[1];
    expect(resOp?.type === "tool/result" && resOp.status).toBe("success");
  });
});



// ── 2026-05 race 修法：translator 严格化（不再隐式创建 messageId） ─────────

describe("S4.final race 修法: translator 严格依赖 message_start 边界", () => {
  it("chat:delta 到达时 activeMessageId === null → 不 emit op，且不 throw", () => {
    const s = bootstrapWithRound();
    expect(s.rounds[0]?.activeMessageId).toBeNull();
    const ops = liveToOps(
      { event: "chat", payload: { state: "delta", message: { text: "stray text" } } },
      s,
    );
    expect(ops).toEqual([]);
  });

  it("agent:assistant text（无 phase）activeMessageId null → 不 emit op", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps(
      { event: "agent", payload: { stream: "assistant", data: { text: "stray" } } },
      s,
    );
    expect(ops).toEqual([]);
  });

  it("agent:thinking 主 agent activeMessageId null → 不 emit op", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps(
      { event: "agent", payload: { stream: "thinking", data: { text: "stray thinking" } } },
      s,
    );
    expect(ops).toEqual([]);
  });

  it("message_start 之后再来 chat:delta → 正常 emit set-text 到当前 activeMessageId", () => {
    const { state, mid } = bootstrapWithMessage();
    expect(state.rounds[0]?.activeMessageId).toBe(mid);
    const ops = liveToOps(
      { event: "chat", payload: { state: "delta", message: { text: "hello" } } },
      state,
    );
    expect(ops.length).toBe(1);
    const op = ops[0];
    if (!op || op.type !== "message/set-text") throw new Error("expected set-text");
    expect(op.messageId).toBe(mid);
    expect(op.fullText).toBe("hello");
  });

  it("force-flush 越界 delta: translator 仍 emit set-text on activeMessageId，**但 reducer 跨 message dedup 短路丢弃**", () => {
    // race scenario：backend 在 message-2 message_start 后仍 force-flush message-1 的累积 fullText
    //
    // translator 行为：不变——仍 emit set-text on 当前 activeMessageId（translator 无从识别 delta
    // 属于哪个 message，backend 协议契约是 chat:delta 跟着最近 message_start）
    //
    // reducer 行为（修法 N，2026-05）：reduceSetText 检查 op.fullText === 同 round 任一 finalized
    // contribution.contentText → 短路丢弃。修 c3e05245 dump 实证的 `<plan>...` text 跨 message
    // 泄漏 bug（msg-3/4 错位归 right-narration → 右栏 narration 重复显示规划话术）。
    const s0 = bootstrapWithRound();
    const round = s0.rounds[0]!;
    const mid1 = ChatId.message(round.id, 0);
    const mid2 = ChatId.message(round.id, 1);
    let s = applyOps(s0, [
      { type: "message/start", roundId: round.id, messageId: mid1, timestamp: 100 },
      { type: "message/set-text", roundId: round.id, messageId: mid1, fullText: "<plan>A</plan>" },
      { type: "message/end", roundId: round.id, messageId: mid1, timestamp: 200 },
      { type: "message/start", roundId: round.id, messageId: mid2, timestamp: 300 },
    ]);
    expect(s.rounds[0]?.activeMessageId).toBe(mid2);
    // backend force-flush 仍推 msg-1 的 chat:delta with fullText "<plan>A</plan>"
    const ops = liveToOps(
      { event: "chat", payload: { state: "delta", message: { text: "<plan>A</plan>" } } },
      s,
    );
    // translator 仍 emit set-text on mid2（不变行为）
    expect(ops.length).toBe(1);
    const op = ops[0];
    if (!op || op.type !== "message/set-text") throw new Error("expected set-text");
    expect(op.messageId).toBe(mid2);
    s = applyOps(s, ops);
    // mid1 已 finalize contribution 保留
    expect(s.rounds[0]?.contributions.get(mid1)?.contentText).toBe("<plan>A</plan>");
    // **修法 N 关键**：reducer dedup 短路——mid2 pending.contentText 仍为空，不被错写入
    expect(s.rounds[0]?.pending.get(mid2)?.contentText).toBe("");
  });
});
