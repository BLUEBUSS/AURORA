// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import { describe, expect, it } from "vitest";
import { ChatId } from "./chat.id";
import type { ChatOp } from "./chat.ops";
import { applyOps, chatReducer, classify, phaseOfRound } from "./chat.reducer";
import { type ChatState, type Round, type RoundId, createInitialChatState, nextRoundIndexFor } from "./chat.types";
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



function startMessage(roundId: RoundId, messageId: string, ts = 200): ChatOp {
  return { type: "message/start", roundId, messageId, timestamp: ts };
}



function endMessage(roundId: RoundId, messageId: string, ts = 300): ChatOp {
  return { type: "message/end", roundId, messageId, timestamp: ts };
}



const planNoPhases: TaskPlan = { id: "p", title: "x" };


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



function buildRound(task?: TaskPlan): Round {
  return {
    id: "r",
    index: 0,
    userMessage: userMsg(),
    sessionKey: "s",
    status: "streaming",
    startedAt: 0,
    pending: new Map(),
    contributions: new Map(),
    segments: [],
    silencedAfterCheckpoint: false,
    nextMessageIndex: 0,
    activeMessageId: null,
    segmentSeqByKind: new Map(),
    task,
  };
}



// ── phaseOfRound ─────────────────────────────────────────────────────────

describe("phaseOfRound", () => {
  it("无 task → pre-plan", () => {
    expect(phaseOfRound(buildRound())).toBe("pre-plan");
  });

  it("有 task 但无 phase steps → execution", () => {
    expect(phaseOfRound(buildRound(planNoPhases))).toBe("execution");
  });

  it("有 phase 且未全部终态 → execution", () => {
    expect(phaseOfRound(buildRound(planWithRunningPhase))).toBe("execution");
  });

  it("所有 phase 均 done/failed/skipped → report", () => {
    expect(phaseOfRound(buildRound(planAllDone))).toBe("report");
  });
});



// ── classify 笛卡尔积（§15.1）─────────────────────────────────────────────

describe("classify 12 cases (v1.1: phaseAtStart 决定路由，不是当前派生 phase)", () => {
  const preplanNoTool = {
    toolCallIds: [],
    toolNamesSeen: new Set<string>(),
    phaseAtStart: "pre-plan" as const,
  };
  const preplanWithTool = {
    toolCallIds: ["t1"],
    toolNamesSeen: new Set(["search"]),
    phaseAtStart: "pre-plan" as const,
  };
  const execNoTool = {
    toolCallIds: [],
    toolNamesSeen: new Set<string>(),
    phaseAtStart: "execution" as const,
  };
  const execWithTool = {
    toolCallIds: ["t1"],
    toolNamesSeen: new Set(["search"]),
    phaseAtStart: "execution" as const,
  };
  const reportNoTool = {
    toolCallIds: [],
    toolNamesSeen: new Set<string>(),
    phaseAtStart: "report" as const,
  };
  const reportWithTool = {
    toolCallIds: ["t1"],
    toolNamesSeen: new Set(["search"]),
    phaseAtStart: "report" as const,
  };

  it("pre-plan + thinking → preplan-thinking", () => {
    expect(classify(buildRound(), preplanNoTool, "thinking")).toBe("preplan-thinking");
    expect(classify(buildRound(), preplanWithTool, "thinking")).toBe("preplan-thinking");
  });

  it("pre-plan + text + 无 tool → preplan-content", () => {
    expect(classify(buildRound(), preplanNoTool, "text")).toBe("preplan-content");
  });

  it("v1.2: pre-plan + text + 含任意 tool（如 read）→ preplan-thinking", () => {
    expect(classify(buildRound(), preplanWithTool, "text")).toBe("preplan-thinking");
  });

  it("v1.2: pre-plan + text + 含 task_create → preplan-thinking", () => {
    const withTaskCreate = {
      toolCallIds: ["tc1"],
      toolNamesSeen: new Set(["task_create"]),
      phaseAtStart: "pre-plan" as const,
    };
    expect(classify(buildRound(), withTaskCreate, "text")).toBe("preplan-thinking");
  });

  it("v1.2: pre-plan + text + 含多个 tool（task_create + 其他）→ preplan-thinking", () => {
    const dual = {
      toolCallIds: ["tc1", "t2"],
      toolNamesSeen: new Set(["task_create", "search"]),
      phaseAtStart: "pre-plan" as const,
    };
    expect(classify(buildRound(), dual, "text")).toBe("preplan-thinking");
  });

  it("execution + thinking → discarded（无视 tool）", () => {
    expect(classify(buildRound(planWithRunningPhase), execNoTool, "thinking")).toBe("discarded");
    expect(classify(buildRound(planWithRunningPhase), execWithTool, "thinking")).toBe("discarded");
  });

  it("execution + text + 有 tool → right-narration", () => {
    expect(classify(buildRound(planWithRunningPhase), execWithTool, "text")).toBe(
      "right-narration",
    );
  });

  it("§3.2 字面规则（2026-05-20 恢复）: execution + text + 无 tool → left-conclusion（model 终止/确认输出 → 进左栏）", () => {
    expect(classify(buildRound(planWithRunningPhase), execNoTool, "text")).toBe("left-conclusion");
  });

  it("report + thinking → report-thinking", () => {
    expect(classify(buildRound(planAllDone), reportNoTool, "thinking")).toBe("report-thinking");
    expect(classify(buildRound(planAllDone), reportWithTool, "thinking")).toBe("report-thinking");
  });

  it("report + text → report-conclusion", () => {
    expect(classify(buildRound(planAllDone), reportNoTool, "text")).toBe("report-conclusion");
    expect(classify(buildRound(planAllDone), reportWithTool, "text")).toBe("report-conclusion");
  });

  // v1.1 §3.4 / §20.10 关键不变性测试：phaseAtStart 锁定分类，不受 message 内 phase 翻转影响
  it("v1.1: phaseAtStart=execution + 后到的 task_update 让 round phase 翻 report → 仍归 right-narration", () => {
    // 模拟：message_start 时 phase=execution（pending.phaseAtStart 已 snapshot=execution）；
    // message 内 task_update.complete_phase(LAST) 让 round.task 全 done → selectPhase 现在派生 = "report"
    const round = buildRound(planAllDone); // round 现在派生 phase=report
    const pending = {
      toolCallIds: ["tu1"],
      toolNamesSeen: new Set(["task_update"]),
      phaseAtStart: "execution" as const, // 但 message_start 时是 execution
    };
    // 关键：classify 用 phaseAtStart=execution，不受 round 当前 phase=report 影响
    expect(classify(round, pending, "text")).toBe("right-narration");
  });
});



// ── round/start ─────────────────────────────────────────────────────────

describe("reduce round/start", () => {
  it("应该新建 round + 设置 active + 写入 roundsById", () => {
    const s0 = createInitialChatState();
    const s1 = chatReducer(s0, startRound("r0", "s", 0));
    expect(s1.rounds.length).toBe(1);
    expect(firstRound(s1).id).toBe("r0");
    expect(s1.activeRoundId).toBe("r0");
    expect(s1.currentSessionKey).toBe("s");
    expect(s1.roundsById.get("r0")).toBe(0);
  });

  it("nextRoundIndexFor 应该按 sessionKey 派生数组长度", () => {
    const s0 = createInitialChatState();
    expect(nextRoundIndexFor(s0, "s")).toBe(0);
    const s1 = chatReducer(s0, startRound("r0", "s", 0));
    expect(nextRoundIndexFor(s1, "s")).toBe(1);
    const s2 = chatReducer(s1, startRound("r1", "s", 1));
    expect(nextRoundIndexFor(s2, "s")).toBe(2);
    expect(nextRoundIndexFor(s2, "other")).toBe(0);
  });

  it("重复 dispatch 同 roundId 应短路（幂等）", () => {
    const s0 = createInitialChatState();
    const s1 = chatReducer(s0, startRound("r0"));
    const s2 = chatReducer(s1, startRound("r0"));
    expect(s2).toBe(s1);
  });
});



// ── message/start + append + end ────────────────────────────────────────

describe("message lifecycle", () => {
  function setup() {
    const s0 = createInitialChatState();
    const s1 = chatReducer(s0, startRound("r0"));
    const mid = ChatId.message("r0", 0);
    return { s1, mid };
  }

  it("message/start 应在 round.pending 创建条目并设置 activeMessageId", () => {
    const { s1, mid } = setup();
    const s2 = chatReducer(s1, startMessage("r0", mid));
    expect(s2.activeMessageId).toBe(mid);
    expect(firstRound(s2).pending.has(mid)).toBe(true);
    expect(firstRound(s2).activeMessageId).toBe(mid);
  });

  it("v1.5 §20.14: cumulative growth 用最新 fullText（next.startsWith(prev)）", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "hello" },
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "hello world" },
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "think" },
    ]);
    const p = firstRound(s2).pending.get(mid);
    // 第二次 set-text 是第一次的 cumulative 延续 → 取最新 fullText
    expect(p?.contentText).toBe("hello world");
    expect(p?.thinkingText).toBe("think");
  });

  it("v1.5 §20.14: 同段 buffer reset 重发幂等（prev.startsWith(next)）", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      startMessage("r0", mid),
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "完整想法 ABC" },
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "完整想法" },
    ]);
    // 老的更长且包含新的 → 短路保留老值（修复 v1.4 §20.13 buffer reset 重复 bug）
    expect(firstRound(s2).pending.get(mid)?.thinkingText).toBe("完整想法 ABC");
  });

  it("v1.5 §20.14: 独立 thinking_block 互不包含 → append 拼接（v1.4-A 修复）", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      startMessage("r0", mid),
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "想法 A" },
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "想法 B" },
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "想法 C" },
    ]);
    // 三段互不包含 → 全部 append（v1.4 set 覆盖会丢前两段）
    expect(firstRound(s2).pending.get(mid)?.thinkingText).toBe("想法 A\n\n想法 B\n\n想法 C");
  });

  it("v1.5 §20.14: text 同样 prefix-aware merge", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "段A" },
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "段A 续" },
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "段B" },
    ]);
    expect(firstRound(s2).pending.get(mid)?.contentText).toBe("段A 续\n\n段B");
  });

  it("v1.5 §20.14: 混合场景 cumulative 后接独立 block", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      startMessage("r0", mid),
      // 第一段流式累积
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "想" },
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "想法 A" },
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "想法 A 完整" },
      // message_start 缺失/race —— 第二段独立 thinking 进同 pending
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "想法 B" },
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "想法 B 完整" },
    ]);
    expect(firstRound(s2).pending.get(mid)?.thinkingText).toBe("想法 A 完整\n\n想法 B 完整");
  });

  it("v1.4: 空 fullText set 后 contentText 为空", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "" },
    ]);
    expect(firstRound(s2).pending.get(mid)?.contentText).toBe("");
  });

  it("message/end pre-plan + text → preplan-content contribution", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "hello" },
      endMessage("r0", mid),
    ]);
    const r = firstRound(s2);
    expect(r.pending.has(mid)).toBe(false);
    expect(r.activeMessageId).toBeNull();
    const c = r.contributions.get(mid);
    expect(c?.classification).toBe("preplan-content");
    expect(c?.contentText).toBe("hello");
  });

  it("S4.4-T 子步 2: execution + text + 含 tool → right-narration + 派生 narration + tool-batch 段", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "narrate" },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: mid,
        toolName: "x",
        toolCallId: "t1",
        isStructural: false,
      },
      endMessage("r0", mid),
    ]);
    const r = firstRound(s2);
    expect(r.contributions.get(mid)?.classification).toBe("right-narration");
    // 派生 2 段：narration + tool-batch
    expect(r.segments.length).toBe(2);
    const narrationSeg = r.segments.find((s) => s.kind === "narration");
    expect(narrationSeg).toBeDefined();
    if (narrationSeg?.kind !== "narration") throw new Error("expected narration");
    expect(narrationSeg.text).toBe("narrate");
    const batchSeg = r.segments.find((s) => s.kind === "tool-batch");
    expect(batchSeg).toBeDefined();
    if (batchSeg?.kind !== "tool-batch") throw new Error("expected tool-batch");
    expect(batchSeg.toolCallIds).toEqual(["t1"]);
  });

  it("Q4 4b verify: narration + tool-batch 派生用 pending.startedAt（不是 Date.now()）", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      // message_start ts=200，message_end ts=999 → narration/tool-batch.startedAt 应该是 200
      { type: "message/start", roundId: "r0", messageId: mid, timestamp: 200 },
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "n" },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: mid,
        toolName: "x",
        toolCallId: "t1",
        isStructural: false,
      },
      { type: "message/end", roundId: "r0", messageId: mid, timestamp: 999 },
    ]);
    const r = firstRound(s2);
    const narrationSeg = r.segments.find((s) => s.kind === "narration");
    const batchSeg = r.segments.find((s) => s.kind === "tool-batch");
    // 关键不变性：派生 segment 用 pending.startedAt（message_start 时刻）
    // 同 message 派生的 narration / tool-batch 必须有相同 startedAt，sort stable 保 push 顺序
    expect(narrationSeg?.startedAt).toBe(200);
    expect(batchSeg?.startedAt).toBe(200);
  });

  it("Q4 4b verify: thinking-fallback narration 派生也用 pending.startedAt", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      { type: "message/start", roundId: "r0", messageId: mid, timestamp: 300 },
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "thinking" },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: mid,
        toolName: "task_update",
        toolCallId: "tu1",
        isStructural: true,
      },
      { type: "message/end", roundId: "r0", messageId: mid, timestamp: 888 },
    ]);
    const r = firstRound(s2);
    const fallback = r.segments.find(
      (s) => s.kind === "narration" && s.isThinkingFallback === true,
    );
    expect(fallback?.startedAt).toBe(300);
  });

  it("S4.4-T 子步 2: structural-only message（仅含 task_update）→ 不派生 tool-batch（跟老路径对齐）", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "n" },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: mid,
        toolName: "task_update",
        toolCallId: "tu1",
        isStructural: true,
      },
      endMessage("r0", mid),
    ]);
    const r = firstRound(s2);
    const batchSegs = r.segments.filter((s) => s.kind === "tool-batch");
    // 全是 structural tool（task_update）→ 不派生 tool-batch
    expect(batchSegs.length).toBe(0);
  });

  it("S4.4-T 子步 2: 混合 message（task_update + read）→ 派生 tool-batch（含 real-data tool 即可）", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "n" },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: mid,
        toolName: "task_update",
        toolCallId: "tu1",
        isStructural: true,
      },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: mid,
        toolName: "read",
        toolCallId: "rd1",
        isStructural: false,
      },
      endMessage("r0", mid),
    ]);
    const r = firstRound(s2);
    const batchSegs = r.segments.filter((s) => s.kind === "tool-batch");
    expect(batchSegs.length).toBe(1);
    if (batchSegs[0]?.kind !== "tool-batch") throw new Error("expected tool-batch");
    // toolCallIds 含所有 tool（包括 structural 也保留——老路径 recordToolStart 也 append 所有）
    expect(batchSegs[0].toolCallIds).toEqual(["tu1", "rd1"]);
  });

  it("S4.4-T 子步 2: 单 message 多 real-data tool → 同一个 tool-batch 段含全部 toolCallIds", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "n" },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: mid,
        toolName: "read",
        toolCallId: "t1",
        isStructural: false,
      },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: mid,
        toolName: "exec",
        toolCallId: "t2",
        isStructural: false,
      },
      endMessage("r0", mid),
    ]);
    const r = firstRound(s2);
    const batchSegs = r.segments.filter((s) => s.kind === "tool-batch");
    expect(batchSegs.length).toBe(1);
    if (batchSegs[0]?.kind !== "tool-batch") throw new Error("expected tool-batch");
    expect(batchSegs[0].toolCallIds).toEqual(["t1", "t2"]);
  });

  it("execution + thinking 与 text 不同分类 → 拆成两条 contribution（thinking discarded / text 视有无 tool）", () => {
    const { s1, mid } = setup();
    // 无 tool：text → left-conclusion（§3.2 恢复后）
    const s2 = applyOps(s1, [
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      startMessage("r0", mid),
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "T" },
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "X" },
      endMessage("r0", mid),
    ]);
    const r = firstRound(s2);
    expect(r.contributions.get(`${mid}:thinking`)?.classification).toBe("discarded");
    expect(r.contributions.get(`${mid}:text`)?.classification).toBe("left-conclusion");
  });

  it("execution + thinking + text + has tool → text 走 right-narration（过程话术留右栏）", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      { type: "task/set-plan", roundId: "r0", plan: planWithRunningPhase },
      startMessage("r0", mid),
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "T" },
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "X" },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: mid,
        toolName: "fin_data",
        toolCallId: "t1",
        isStructural: false,
      },
      endMessage("r0", mid),
    ]);
    const r = firstRound(s2);
    expect(r.contributions.get(`${mid}:thinking`)?.classification).toBe("discarded");
    expect(r.contributions.get(`${mid}:text`)?.classification).toBe("right-narration");
  });

  it("空 message（无 text/thinking/tool）→ 不写 contribution", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [startMessage("r0", mid), endMessage("r0", mid)]);
    expect(firstRound(s2).contributions.size).toBe(0);
  });

  it("被 silencedAfterCheckpoint → 后续 set 被丢弃", () => {
    const { s1, mid } = setup();
    const s2 = applyOps(s1, [
      startMessage("r0", mid),
      { type: "round/checkpoint-silence", roundId: "r0" },
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "ignored" },
    ]);
    expect(firstRound(s2).pending.get(mid)?.contentText).toBe("");
  });
});



// ── round/complete ──────────────────────────────────────────────────────

describe("round/complete", () => {
  it("应该把 status 设为终态", () => {
    const s0 = createInitialChatState();
    const s1 = chatReducer(s0, startRound("r0"));
    const s2 = chatReducer(s1, {
      type: "round/complete",
      roundId: "r0",
      status: "done",
      timestamp: 999,
    });
    expect(firstRound(s2).status).toBe("done");
    expect(firstRound(s2).completedAt).toBe(999);
  });

  it("已终态再 complete 应短路", () => {
    const s0 = createInitialChatState();
    const s1 = applyOps(s0, [
      startRound("r0"),
      { type: "round/complete", roundId: "r0", status: "done", timestamp: 1 },
    ]);
    const s2 = chatReducer(s1, {
      type: "round/complete",
      roundId: "r0",
      status: "failed",
      timestamp: 2,
    });
    expect(firstRound(s2).status).toBe("done");
  });
});
