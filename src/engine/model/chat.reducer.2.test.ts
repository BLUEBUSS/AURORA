// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import { describe, expect, it } from "vitest";
import type { ChatOp } from "./chat.ops";
import { applyOps, chatReducer } from "./chat.reducer";
import { type ChatState, type Round, type RoundId, createInitialChatState } from "./chat.types";
import type { ChatMessage, TaskPlan } from "../contracts/protocol";



const firstRound = (s: ChatState): Round => {
  const r = s.rounds.at(0);
  if (!r) throw new Error("expected round[0]");
  return r;
};



// ── Test helpers ────────────────────────────────────────────────────────

const userMsg = (id = "u-1"): ChatMessage => ({
  id,
  role: "user",
  content: "hi",
  timestamp: 1,
});



function startRound(roundId: RoundId, sessionKey = "s", roundIndex = 0): ChatOp {
  return {
    type: "round/start",
    roundId,
    userMessage: userMsg(),
    sessionKey,
    roundIndex,
    timestamp: 100,
  };
}


const planWithRunningPhase: TaskPlan = {
  id: "p",
  title: "x",
  groups: [
    {
      id: "g1",
      title: "g1",
      type: "serial",
      steps: [{ id: "s1", status: "running" }],
    },
  ],
};


const planAllDone: TaskPlan = {
  id: "p",
  title: "x",
  groups: [
    {
      id: "g1",
      title: "g1",
      type: "serial",
      steps: [
        { id: "s1", status: "done" },
        { id: "s2", status: "done" },
      ],
    },
  ],
};



const planWithFivePhases: TaskPlan = {
  id: "five-phases",
  groups: [
    {
      id: "g1",
      title: "研究计划",
      type: "serial",
      steps: Array.from({ length: 5 }, (_, i) => ({
        id: `phase-${i + 1}`,
        status: "pending" as const,
      })),
    },
  ],
};



// ── task ────────────────────────────────────────────────────────────────

describe("task ops", () => {
  it("set-plan 应该写入 task；相同 plan 短路", () => {
    const s0 = createInitialChatState();
    const s1 = applyOps(s0, [
      startRound("r0"),
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
    ]);
    expect(firstRound(s1).task).toEqual(planWithRunningPhase);

    const s2 = chatReducer(s1, {
      type: "task/set-plan",
      roundId: "r0",
      plan: planWithRunningPhase,
    });
    expect(firstRound(s2)).toBe(firstRound(s1));
  });

  it("update-phase 应该改 step status", () => {
    const s0 = createInitialChatState();
    const s1 = applyOps(s0, [
      startRound("r0"),
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      { type: "task/update-phase", roundId: "r0", phaseIndex: 0, status: "done", result: "ok" },
    ]);
    const step = firstRound(s1).task?.groups?.[0]?.steps?.[0];
    expect(step?.status).toBe("done");
    expect(step?.output_summary).toBe("ok");
  });

  it("S4.x-T: set-plan 同步初始化 phaseStatuses（按 plan 提供的 status）", () => {
    const s = applyOps(createInitialChatState(), [
      startRound("r0"),
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
    ]);
    const r = firstRound(s);
    expect(r.phaseStatuses).toEqual(["running"]);
  });

  it("S4.x-T: set-plan 已推进 status 永不被覆盖（即使 plan 重发同 length）", () => {
    const s = applyOps(createInitialChatState(), [
      startRound("r0"),
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      { type: "task/update-phase", roundId: "r0", phaseIndex: 0, status: "done", result: "ok" },
      // 重发同 plan（plan.steps[0].status="running" 但 phaseStatuses[0]="done"）→ 保留 done
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
    ]);
    expect(firstRound(s).phaseStatuses).toEqual(["done"]);
  });

  it("S4.x-T: set-plan length 增大 → 扩展 phaseStatuses（保留前 N 个）", () => {
    const planWith2 = {
      id: "p",
      groups: [
        {
          id: "g1",
          title: "g1",
          type: "serial" as const,
          steps: [
            { id: "s1", status: "done" as const },
            { id: "s2", status: "pending" as const },
          ],
        },
      ],
    };
    const s = applyOps(createInitialChatState(), [
      startRound("r0"),
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase }, // length 1
      { type: "task/update-phase", roundId: "r0", phaseIndex: 0, status: "done", result: "ok" },
      { type: "task/set-plan", roundId: "r0", plan: planWith2 }, // length 2
    ]);
    expect(firstRound(s).phaseStatuses).toEqual(["done", "pending"]);
  });

  it("S4.x-T: set-plan length 缩短 → 不缩短 phaseStatuses（保留已推进）", () => {
    const planEmpty = {
      id: "p",
      groups: [{ id: "g1", title: "g1", type: "serial" as const, steps: [] }],
    };
    const s = applyOps(createInitialChatState(), [
      startRound("r0"),
      { type: "task/set-plan", roundId: "r0", plan: planAllDone }, // length 2 done done
      // 异常 plan 重发：groups 含空 steps（v1.7 撤回时此场景让 phaseStatuses 被清空）
      { type: "task/set-plan", roundId: "r0", plan: planEmpty },
    ]);
    // 不缩短：保留 [done, done]
    expect(firstRound(s).phaseStatuses).toEqual(["done", "done"]);
  });

  it("S4.x-T: update-phase 写 phaseStatuses + 同步 plan.groups[].steps[].status", () => {
    const s = applyOps(createInitialChatState(), [
      startRound("r0"),
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      { type: "task/update-phase", roundId: "r0", phaseIndex: 0, status: "done", result: "ok" },
    ]);
    const r = firstRound(s);
    expect(r.phaseStatuses).toEqual(["done"]);
    expect(r.task?.groups?.[0]?.steps[0]?.status).toBe("done");
    expect(r.task?.groups?.[0]?.steps[0]?.output_summary).toBe("ok");
  });

  it("越界 phase update 不应扩展状态数组或制造第六个阶段", () => {
    const s = applyOps(createInitialChatState(), [
      startRound("r0"),
      { type: "task/set-plan", roundId: "r0", plan: planWithFivePhases },
      { type: "task/update-phase", roundId: "r0", phaseIndex: 0, status: "done" },
      // 后端实际会拒绝这个 0-based 越界下标；前端必须丢弃，而不是扩成 index=5。
      { type: "task/update-phase", roundId: "r0", phaseIndex: 5, status: "done" },
    ]);
    const r = firstRound(s);
    expect(r.phaseStatuses).toEqual(["done", "pending", "pending", "pending", "pending"]);
    expect(r.task?.groups?.[0]?.steps).toHaveLength(5);
  });

  it("显式完成计划时，将未回报的阶段收敛为 done", () => {
    const s = applyOps(createInitialChatState(), [
      startRound("r0"),
      { type: "task/set-plan", roundId: "r0", plan: planWithFivePhases },
      { type: "task/update-phase", roundId: "r0", phaseIndex: 0, status: "done" },
      { type: "task/complete-all", roundId: "r0" },
    ]);
    const r = firstRound(s);
    expect(r.phaseStatuses).toEqual(["done", "done", "done", "done", "done"]);
    expect(r.task?.groups?.[0]?.steps.every((step) => step.status === "done")).toBe(true);
  });

  it("S4.x-T: checkpoint 路径 1（已有 task）→ 写 task.checkpoint + checkpointData", () => {
    const s = applyOps(createInitialChatState(), [
      startRound("r0"),
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      {
        type: "task/checkpoint",
        roundId: "r0",
        phaseIndex: 0,
        data: { type: "confirm", message: "继续？", options: ["是", "否"] },
      },
    ]);
    const r = firstRound(s);
    expect(r.task?.checkpoint).toBe("继续？");
    expect(r.checkpointData?.type).toBe("confirm");
    expect(r.checkpointData?.message).toBe("继续？");
    expect(r.checkpointData?.options).toEqual(["是", "否"]);
  });

  it("S4.x-T: checkpoint 路径 2（无 task）→ 创建 placeholder + checkpointData", () => {
    const s = applyOps(createInitialChatState(), [
      startRound("r0"),
      {
        type: "task/checkpoint",
        roundId: "r0",
        phaseIndex: 0,
        data: { type: "suggest", message: "请确认范围" },
      },
    ]);
    const r = firstRound(s);
    expect(r.task?.title).toBe("需求澄清");
    expect(r.task?.groups).toEqual([]);
    expect(r.task?.checkpoint).toBe("请确认范围");
    expect(r.checkpointData?.type).toBe("suggest");
    expect(r.phaseStatuses).toEqual([]);
  });

  it("add-phases 在已有最后 group 内追加", () => {
    const s0 = createInitialChatState();
    const s1 = applyOps(s0, [
      startRound("r0"),
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      {
        type: "task/add-phases",
        roundId: "r0",
        addedPhases: [{ id: "s2", status: "pending" }],
      },
    ]);
    expect(firstRound(s1).task?.groups?.[0]?.steps.length).toBe(2);
  });
});



// ── subagent ────────────────────────────────────────────────────────────

describe("subagent ops", () => {
  it("spawn 创建记录；同 id 重复 spawn（无新信息）短路", () => {
    const s0 = createInitialChatState();
    const s1 = applyOps(s0, [
      startRound("r0"),
      {
        type: "subagent/spawn",
        parentRoundId: "r0",
        subagentId: "sub1",
        label: "sub",
        timestamp: 1,
      },
    ]);
    expect(s1.subagents.get("sub1")?.label).toBe("sub");
    const s2 = chatReducer(s1, {
      type: "subagent/spawn",
      parentRoundId: "r0",
      subagentId: "sub1",
      label: "ignored",
      timestamp: 2,
    });
    expect(s2).toBe(s1);
  });

  it("spawn upsert：record 缺 childSessionKey 时，后续 spawn 携带 childSessionKey → 补全", () => {
    // 实测场景：tool/start 走 ensureSubagentSpawnOps fallback 创建 record（label=payload.subagentLabel
    // 但 childSessionKey 在 tool/start payload 里通常没有，所以是 undefined）；后续 lifecycle.start
    // event 携带 childSessionKey 重新 dispatch spawn → upsert 补全 childSessionKey 让 drill-down 正常。
    const subId = "agent:research:session:abc";
    const s1 = applyOps(createInitialChatState(), [
      startRound("r0"),
      {
        type: "subagent/spawn",
        parentRoundId: "r0",
        subagentId: subId,
        label: "earnings-research",
        timestamp: 1,
      },
    ]);
    expect(s1.subagents.get(subId)?.childSessionKey).toBeUndefined();
    const s2 = chatReducer(s1, {
      type: "subagent/spawn",
      parentRoundId: "r0",
      subagentId: subId,
      label: "earnings-research",
      childSessionKey: "agent:research:session:child-1",
      timestamp: 2,
    });
    expect(s2.subagents.get(subId)?.childSessionKey).toBe("agent:research:session:child-1");
    expect(s2.subagents.get(subId)?.label).toBe("earnings-research");
  });

  it("spawn 单调合并：label first-seen wins（不被后到 op 覆盖）", () => {
    // Reducer 不依赖 fallback pattern 启发式判断"label 是否假"——一旦写入就锁定。
    // 上游应该保证调用方 emit spawn 时携带正确 label（如 broadcast payload 含 subagentLabel）。
    // 反向 race（pure spawn label 后到、stale spawn label 先到）下保留 first-seen 比依赖
    // 启发式判断哪个是"对"的更稳健。
    const subId = "agent:research:session:abcdef12";
    const s1 = applyOps(createInitialChatState(), [
      startRound("r0"),
      {
        type: "subagent/spawn",
        parentRoundId: "r0",
        subagentId: subId,
        label: "first-label",
        childSessionKey: "csk-1",
        timestamp: 1,
      },
    ]);
    const s2 = chatReducer(s1, {
      type: "subagent/spawn",
      parentRoundId: "r0",
      subagentId: subId,
      label: "second-label",
      timestamp: 2,
    });
    // label / childSessionKey 都不被覆盖
    expect(s2.subagents.get(subId)?.label).toBe("first-label");
    expect(s2.subagents.get(subId)?.childSessionKey).toBe("csk-1");
  });

  it("reset-state：清空 segments + activeMessageIndex + segmentSeqByKind，保留 spawn 元数据", () => {
    // Drill-down lazy load 用：history 翻译是权威重建，需先清空 live 累积的瞬时 state。
    const subId = "sub-x";
    const s1 = applyOps(createInitialChatState(), [
      startRound("r0"),
      {
        type: "subagent/spawn",
        parentRoundId: "r0",
        subagentId: subId,
        label: "research",
        childSessionKey: "child-csk",
        timestamp: 100,
      },
      // 模拟 live 累积一些 message_start + segments
      { type: "subagent/message-start", subagentId: subId, timestamp: 200 },
      { type: "subagent/message-start", subagentId: subId, timestamp: 300 },
      {
        type: "subagent/append-segment",
        subagentId: subId,
        segment: {
          kind: "narration",
          id: `${subId}:2:narration:0`,
          text: "live narration",
          startedAt: 250,
          context: { phaseIndex: undefined, subagentId: subId },
        },
      },
    ]);
    expect(s1.subagents.get(subId)?.activeMessageIndex).toBe(2);
    expect(s1.subagents.get(subId)?.segments.length).toBe(1);
    // reset
    const s2 = chatReducer(s1, { type: "subagent/reset-state", subagentId: subId });
    const rec = s2.subagents.get(subId);
    expect(rec?.activeMessageIndex).toBe(0);
    expect(rec?.segments.length).toBe(0);
    expect(rec?.segmentSeqByKind.size).toBe(0);
    expect(rec?.openBatchId).toBeNull();
    // spawn 元数据保留
    expect(rec?.label).toBe("research");
    expect(rec?.childSessionKey).toBe("child-csk");
    expect(rec?.parentRoundId).toBe("r0");
    expect(rec?.startedAt).toBe(100);
  });

  it("reset-state 后 apply history ops：reducer state 反映 history 末态，跟 live 累积无关", () => {
    const subId = "sub-x";
    // live 累积 activeMessageIndex = 5
    let s = applyOps(createInitialChatState(), [
      startRound("r0"),
      {
        type: "subagent/spawn",
        parentRoundId: "r0",
        subagentId: subId,
        label: "x",
        timestamp: 100,
      },
      { type: "subagent/message-start", subagentId: subId, timestamp: 200 },
      { type: "subagent/message-start", subagentId: subId, timestamp: 300 },
      { type: "subagent/message-start", subagentId: subId, timestamp: 400 },
      { type: "subagent/message-start", subagentId: subId, timestamp: 500 },
      { type: "subagent/message-start", subagentId: subId, timestamp: 600 },
    ]);
    expect(s.subagents.get(subId)?.activeMessageIndex).toBe(5);
    // reset + history apply 3 个 message-start → reducer state activeMessageIndex = 3（不是 5+3）
    s = applyOps(s, [
      { type: "subagent/reset-state", subagentId: subId },
      { type: "subagent/message-start", subagentId: subId, timestamp: 1000 },
      { type: "subagent/message-start", subagentId: subId, timestamp: 1100 },
      { type: "subagent/message-start", subagentId: subId, timestamp: 1200 },
    ]);
    expect(s.subagents.get(subId)?.activeMessageIndex).toBe(3);
  });

  it("spawn upsert：已有 childSessionKey 不被覆盖（不丢已设字段）", () => {
    const subId = "sub-x";
    const s1 = applyOps(createInitialChatState(), [
      startRound("r0"),
      {
        type: "subagent/spawn",
        parentRoundId: "r0",
        subagentId: subId,
        label: "real-label",
        childSessionKey: "csk-1",
        timestamp: 1,
      },
    ]);
    const s2 = chatReducer(s1, {
      type: "subagent/spawn",
      parentRoundId: "r0",
      subagentId: subId,
      label: "real-label",
      childSessionKey: "csk-2",
      timestamp: 2,
    });
    // 已设 childSessionKey 不被覆盖（避免 race 把后到的脏数据覆盖正确数据）
    expect(s2.subagents.get(subId)?.childSessionKey).toBe("csk-1");
  });

  it("append-segment merge by id（同 id 替换，不重复）", () => {
    const s0 = applyOps(createInitialChatState(), [
      startRound("r0"),
      {
        type: "subagent/spawn",
        parentRoundId: "r0",
        subagentId: "sub1",
        label: "x",
        timestamp: 1,
      },
    ]);
    const seg = {
      kind: "narration" as const,
      id: "seg-1",
      text: "v1",
      startedAt: 1,
      context: { phaseIndex: undefined, subagentId: "sub1" },
    };
    const s1 = applyOps(s0, [
      { type: "subagent/append-segment", subagentId: "sub1", segment: seg },
      {
        type: "subagent/append-segment",
        subagentId: "sub1",
        segment: { ...seg, text: "v2" },
      },
    ]);
    const segments = s1.subagents.get("sub1")?.segments ?? [];
    expect(segments.length).toBe(1);
    const first = segments[0];
    if (!first || first.kind !== "narration") throw new Error("expected narration segment");
    expect(first.text).toBe("v2");
  });

  // ── S4.5-T: 新增 op 行为 ─────────────────────────────────────────────
  it("spawn 初始化 activeMessageIndex=0 / segmentSeqByKind 空 / openBatchId=null", () => {
    const s = applyOps(createInitialChatState(), [
      startRound("r0"),
      {
        type: "subagent/spawn",
        parentRoundId: "r0",
        subagentId: "sub1",
        label: "x",
        timestamp: 1,
      },
    ]);
    const rec = s.subagents.get("sub1");
    expect(rec?.activeMessageIndex).toBe(0);
    expect(rec?.segmentSeqByKind.size).toBe(0);
    expect(rec?.openBatchId).toBeNull();
    expect(rec?.pendingThinking).toBeUndefined();
  });

  it("subagent/message-start: activeMessageIndex++ + 清空 seq + 关 openBatchId", () => {
    const s0 = applyOps(createInitialChatState(), [
      startRound("r0"),
      {
        type: "subagent/spawn",
        parentRoundId: "r0",
        subagentId: "sub1",
        label: "x",
        timestamp: 1,
      },
      // 先 push 一段 tool-batch，让 seq + openBatchId 有值
      {
        type: "subagent/append-segment",
        subagentId: "sub1",
        segment: {
          kind: "tool-batch",
          id: "sub1:0:tool-batch:0",
          toolCallIds: ["t1"],
          startedAt: 1,
          context: { phaseIndex: undefined, subagentId: "sub1" },
        },
      },
    ]);
    expect(s0.subagents.get("sub1")?.openBatchId).toBe("sub1:0:tool-batch:0");
    expect(s0.subagents.get("sub1")?.segmentSeqByKind.get("tool-batch")).toBe(1);
    const s1 = applyOps(s0, [{ type: "subagent/message-start", subagentId: "sub1", timestamp: 2 }]);
    const rec = s1.subagents.get("sub1");
    expect(rec?.activeMessageIndex).toBe(1);
    expect(rec?.openBatchId).toBeNull();
    expect(rec?.segmentSeqByKind.size).toBe(0);
    // segments 不动
    expect(rec?.segments.length).toBe(1);
  });

  it("subagent/pending-thinking: set / clear / flush 三 action", () => {
    const s0 = applyOps(createInitialChatState(), [
      startRound("r0"),
      {
        type: "subagent/spawn",
        parentRoundId: "r0",
        subagentId: "sub1",
        label: "x",
        timestamp: 1,
      },
    ]);
    // set
    const s1 = applyOps(s0, [
      { type: "subagent/pending-thinking", subagentId: "sub1", action: "set", text: "thinking…" },
    ]);
    expect(s1.subagents.get("sub1")?.pendingThinking).toBe("thinking…");

    // clear
    const s2 = applyOps(s1, [
      { type: "subagent/pending-thinking", subagentId: "sub1", action: "clear" },
    ]);
    expect(s2.subagents.get("sub1")?.pendingThinking).toBeUndefined();

    // flush 空 pending → noop
    const s3 = applyOps(s2, [
      { type: "subagent/pending-thinking", subagentId: "sub1", action: "flush", timestamp: 5 },
    ]);
    expect(s3).toBe(s2);

    // set 再 flush → 派生 thinking-fallback narration
    const s4 = applyOps(s2, [
      { type: "subagent/pending-thinking", subagentId: "sub1", action: "set", text: "ponder" },
      { type: "subagent/pending-thinking", subagentId: "sub1", action: "flush", timestamp: 6 },
    ]);
    const segments = s4.subagents.get("sub1")?.segments ?? [];
    expect(segments.length).toBe(1);
    const seg = segments[0];
    if (!seg || seg.kind !== "narration") throw new Error("expected narration");
    expect(seg.isThinkingFallback).toBe(true);
    expect(seg.text).toBe("ponder");
    expect(seg.id).toBe("sub1:0:narration:0");
    // flush 后 pending 清空 + seq bump + openBatchId=null
    expect(s4.subagents.get("sub1")?.pendingThinking).toBeUndefined();
    expect(s4.subagents.get("sub1")?.segmentSeqByKind.get("narration")).toBe(1);
    expect(s4.subagents.get("sub1")?.openBatchId).toBeNull();
  });

  it("append-segment 新 push 维护 openBatchId + bump seq", () => {
    const s0 = applyOps(createInitialChatState(), [
      startRound("r0"),
      {
        type: "subagent/spawn",
        parentRoundId: "r0",
        subagentId: "sub1",
        label: "x",
        timestamp: 1,
      },
    ]);
    // push tool-batch → openBatchId 设为该 segment id
    const batchSeg = {
      kind: "tool-batch" as const,
      id: "sub1:0:tool-batch:0",
      toolCallIds: ["t1"],
      startedAt: 1,
      context: { phaseIndex: undefined, subagentId: "sub1" },
    };
    const s1 = applyOps(s0, [
      { type: "subagent/append-segment", subagentId: "sub1", segment: batchSeg },
    ]);
    expect(s1.subagents.get("sub1")?.openBatchId).toBe("sub1:0:tool-batch:0");
    expect(s1.subagents.get("sub1")?.segmentSeqByKind.get("tool-batch")).toBe(1);

    // push narration → openBatchId 清掉
    const narrSeg = {
      kind: "narration" as const,
      id: "sub1:0:narration:0",
      text: "hello",
      startedAt: 2,
      context: { phaseIndex: undefined, subagentId: "sub1" },
    };
    const s2 = applyOps(s1, [
      { type: "subagent/append-segment", subagentId: "sub1", segment: narrSeg },
    ]);
    expect(s2.subagents.get("sub1")?.openBatchId).toBeNull();
    expect(s2.subagents.get("sub1")?.segmentSeqByKind.get("narration")).toBe(1);

    // patch（同 id 重写）— seq 不动 / openBatchId 不动
    const s3 = applyOps(s2, [
      {
        type: "subagent/append-segment",
        subagentId: "sub1",
        segment: { ...narrSeg, text: "hello world" },
      },
    ]);
    expect(s3.subagents.get("sub1")?.segmentSeqByKind.get("narration")).toBe(1); // 不变
    expect(s3.subagents.get("sub1")?.segments.length).toBe(2); // 仍 2 段（patch 不增加）
  });
});
