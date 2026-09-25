// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import { describe, expect, it } from "vitest";
import { ChatId } from "./chat.id";
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



function startMessage(roundId: RoundId, messageId: string, ts = 200): ChatOp {
  return { type: "message/start", roundId, messageId, timestamp: ts };
}



function endMessage(roundId: RoundId, messageId: string, ts = 300): ChatOp {
  return { type: "message/end", roundId, messageId, timestamp: ts };
}



// ── tool ────────────────────────────────────────────────────────────────

describe("tool ops", () => {
  it("tool/start + tool/result 应该正确流转 status", () => {
    const s0 = createInitialChatState();
    const s1 = applyOps(s0, [
      { type: "tool/start", toolCallId: "t1", toolName: "x" },
      { type: "tool/result", toolCallId: "t1", status: "success", result: { ok: true } },
    ]);
    expect(s1.toolCalls.get("t1")?.status).toBe("success");
    expect(s1.toolCalls.get("t1")?.result).toEqual({ ok: true });
  });

  it("tool/start 重复应短路", () => {
    const s0 = createInitialChatState();
    const s1 = chatReducer(s0, { type: "tool/start", toolCallId: "t1", toolName: "x" });
    const s2 = chatReducer(s1, { type: "tool/start", toolCallId: "t1", toolName: "x" });
    expect(s2).toBe(s1);
  });
});



// ── contribution rewrite ────────────────────────────────────────────────

describe("contribution immutability (P2 / §20.5)", () => {
  it("finalize 后 append-text 同 messageId → contribution 不变（引用相等）", () => {
    const s0 = createInitialChatState();
    const mid = ChatId.message("r0", 0);
    const s1 = applyOps(s0, [
      startRound("r0"),
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "old" },
      endMessage("r0", mid),
    ]);
    const before = firstRound(s1).contributions.get(mid);
    expect(before?.contentText).toBe("old");

    const s2 = chatReducer(s1, {
      type: "message/set-text",
      roundId: "r0",
      messageId: mid,
      fullText: "leak",
    });
    // pending 已删除，set-text 应短路；contribution 引用相等说明完全没动
    expect(firstRound(s2).contributions.get(mid)).toBe(before);
  });

  it("finalize 后再 message/end 同 messageId → contribution 不变", () => {
    const s0 = createInitialChatState();
    const mid = ChatId.message("r0", 0);
    const s1 = applyOps(s0, [
      startRound("r0"),
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "x" },
      endMessage("r0", mid),
    ]);
    const before = firstRound(s1).contributions.get(mid);
    const s2 = chatReducer(s1, endMessage("r0", mid, 999));
    expect(firstRound(s2).contributions.get(mid)).toBe(before);
  });

  it("finalize 后 record-tool 同 messageId → contribution 不变（pending 已删）", () => {
    const s0 = createInitialChatState();
    const mid = ChatId.message("r0", 0);
    const s1 = applyOps(s0, [
      startRound("r0"),
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "x" },
      endMessage("r0", mid),
    ]);
    const before = firstRound(s1).contributions.get(mid);
    const s2 = chatReducer(s1, {
      type: "message/record-tool",
      roundId: "r0",
      messageId: mid,
      toolName: "ghost",
      toolCallId: "t-late",
      isStructural: false,
    });
    expect(firstRound(s2).contributions.get(mid)).toBe(before);
  });
});



describe("contribution/rewrite-text", () => {
  it("应替换已 finalize 的 text contribution", () => {
    const s0 = createInitialChatState();
    const mid = ChatId.message("r0", 0);
    const s1 = applyOps(s0, [
      startRound("r0"),
      startMessage("r0", mid),
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "old" },
      endMessage("r0", mid),
      {
        type: "contribution/rewrite-text",
        roundId: "r0",
        messageId: mid,
        newText: "new",
        offsetMap: [],
      },
    ]);
    expect(firstRound(s1).contributions.get(mid)?.contentText).toBe("new");
  });
});



// ── S4.5-T phase-marker 合并启发式（mirror 老 segment-builder recordPhaseMarker） ───

describe("reduceSegmentAddPhaseMarker 合并启发式", () => {
  const rid = "r0";
  const mid = ChatId.message(rid, 0);

  function bootstrap(): ChatState {
    return applyOps(createInitialChatState(), [startRound(rid), startMessage(rid, mid, 200)]);
  }

  function emitMarker(
    state: ChatState,
    action: "create" | "complete" | "fail" | "skip" | "add",
    phaseIndex?: number,
    payload: Partial<{
      summaries: string[];
      addedPhases: string[];
      planPhaseCount: number;
      toolCallId: string;
    }> = {},
  ): ChatState {
    return applyOps(state, [
      {
        type: "segment/add-phase-marker",
        roundId: rid,
        messageId: mid,
        action,
        phaseIndex,
        payload: {
          summaries: payload.summaries,
          addedPhases: payload.addedPhases,
          planPhaseCount: payload.planPhaseCount,
          toolCallId: payload.toolCallId,
        },
      },
    ]);
  }

  it("case 1: 连续 same-action complete → 合并 phaseIndex=[0,1] 数组化", () => {
    let s = bootstrap();
    s = emitMarker(s, "complete", 0, { summaries: ["s0"] });
    s = emitMarker(s, "complete", 1, { summaries: ["s1"] });
    const segs = firstRound(s).segments.filter((seg) => seg.kind === "phase-marker");
    expect(segs.length).toBe(1);
    if (segs[0]?.kind !== "phase-marker") throw new Error("expected phase-marker");
    expect(segs[0].phaseIndex).toEqual([0, 1]);
    expect(segs[0].summaries).toEqual(["s0", "s1"]);
  });

  it("case 2: 跨 action（complete → fail）→ 不合并，2 段", () => {
    let s = bootstrap();
    s = emitMarker(s, "complete", 0);
    s = emitMarker(s, "fail", 1);
    const segs = firstRound(s).segments.filter((seg) => seg.kind === "phase-marker");
    expect(segs.length).toBe(2);
    if (segs[0]?.kind !== "phase-marker" || segs[1]?.kind !== "phase-marker")
      throw new Error("expected phase-marker");
    expect(segs[0].action).toBe("complete");
    expect(segs[1].action).toBe("fail");
  });

  it("case 3: 中间插 narration 阻断 → 不合并（last 非 phase-marker）", () => {
    // 先 emit 第一个 phase-marker
    let s = bootstrap();
    s = emitMarker(s, "complete", 0);
    // 插入一段 narration 直接派生（用 segment/append-narration op）
    s = applyOps(s, [
      { type: "segment/append-narration", roundId: rid, messageId: mid, text: "narration here" },
    ]);
    // 再 emit 同 action complete
    s = emitMarker(s, "complete", 1);
    const r = firstRound(s);
    const segs = r.segments.filter((seg) => seg.kind === "phase-marker");
    expect(segs.length).toBe(2); // 不合并
    expect(r.segments.length).toBe(3); // phase + narration + phase
  });

  it("case 4: action=create / action=add → isMergeable=false，不合并", () => {
    // create 连续 emit 不合并（虽然实际不会出现两个 create，单测以防万一）
    let s = bootstrap();
    s = emitMarker(s, "create", undefined, { planPhaseCount: 3 });
    s = emitMarker(s, "create", undefined, { planPhaseCount: 5 });
    expect(firstRound(s).segments.filter((seg) => seg.kind === "phase-marker").length).toBe(2);

    // add 连续 emit 不合并
    let s2 = bootstrap();
    s2 = emitMarker(s2, "add", undefined, { addedPhases: ["p1"] });
    s2 = emitMarker(s2, "add", undefined, { addedPhases: ["p2"] });
    expect(firstRound(s2).segments.filter((seg) => seg.kind === "phase-marker").length).toBe(2);
  });

  it("case 5: phaseIndex undefined → 不合并（safety guard，避免合并语义不明的段）", () => {
    let s = bootstrap();
    s = emitMarker(s, "complete", 0);
    s = emitMarker(s, "complete", undefined); // phaseIndex 缺失
    const segs = firstRound(s).segments.filter((seg) => seg.kind === "phase-marker");
    expect(segs.length).toBe(2);
  });

  it("case 6: 已 merge 后再来 same-action → 继续累加到同段", () => {
    let s = bootstrap();
    s = emitMarker(s, "complete", 0);
    s = emitMarker(s, "complete", 1);
    s = emitMarker(s, "complete", 2);
    const segs = firstRound(s).segments.filter((seg) => seg.kind === "phase-marker");
    expect(segs.length).toBe(1);
    if (segs[0]?.kind !== "phase-marker") throw new Error("expected phase-marker");
    expect(segs[0].phaseIndex).toEqual([0, 1, 2]);
  });

  it("case 7: phaseIndex 数组化去重 + 升序排序", () => {
    let s = bootstrap();
    // 故意乱序 emit + 重复一个
    s = emitMarker(s, "complete", 2);
    s = emitMarker(s, "complete", 0);
    s = emitMarker(s, "complete", 1);
    s = emitMarker(s, "complete", 2); // 重复，应去重
    const segs = firstRound(s).segments.filter((seg) => seg.kind === "phase-marker");
    expect(segs.length).toBe(1);
    if (segs[0]?.kind !== "phase-marker") throw new Error("expected phase-marker");
    expect(segs[0].phaseIndex).toEqual([0, 1, 2]); // 升序去重
  });
});



// ── 主 agent execute 期 thinking-fallback narration（mirror 老 segment-builder）────

describe("reduceMessageEnd 主 agent thinking-fallback narration", () => {
  // 构造一个已进入 execute 期的 round（任何 phaseStatuses 非全 pending）
  function setupExecuteRound(): ChatState {
    const plan: TaskPlan = {
      groups: [
        {
          id: "g1",
          title: "",
          type: "serial",
          steps: [
            { id: "phase-1", status: "running" } as never,
            { id: "phase-2", status: "pending" } as never,
          ],
        },
      ],
    };
    let s = applyOps(createInitialChatState(), [startRound("r0")]);
    s = applyOps(s, [{ type: "task/set-plan", roundId: "r0", plan }]);
    return s;
  }

  it("execute thinking-only message + 含 tool → 派生 narration with isThinkingFallback=true", () => {
    let s = setupExecuteRound();
    const mid = ChatId.message("r0", 0);
    s = applyOps(s, [
      startMessage("r0", mid, 200),
      {
        type: "message/set-thinking",
        roundId: "r0",
        messageId: mid,
        fullText: "Let me query metrics.",
      },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: mid,
        toolName: "fin_data",
        toolCallId: "t1",
        isStructural: false,
      },
      { type: "message/end", roundId: "r0", messageId: mid, timestamp: 300 },
    ]);
    const r = firstRound(s);
    const narrations = r.segments.filter((seg) => seg.kind === "narration");
    expect(narrations.length).toBe(1);
    if (narrations[0]?.kind !== "narration") throw new Error("expected narration");
    expect(narrations[0].isThinkingFallback).toBe(true);
    expect(narrations[0].text).toBe("Let me query metrics.");
    // 同 message 含 real-data tool → tool-batch 也应派生
    const batches = r.segments.filter((seg) => seg.kind === "tool-batch");
    expect(batches.length).toBe(1);
  });

  it("execute thinking + text → 不派生 fallback narration（textCls=right-narration 优先）", () => {
    let s = setupExecuteRound();
    const mid = ChatId.message("r0", 0);
    s = applyOps(s, [
      startMessage("r0", mid, 200),
      { type: "message/set-thinking", roundId: "r0", messageId: mid, fullText: "thinking" },
      { type: "message/set-text", roundId: "r0", messageId: mid, fullText: "narration text" },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: mid,
        toolName: "fin_data",
        toolCallId: "t1",
        isStructural: false,
      },
      { type: "message/end", roundId: "r0", messageId: mid, timestamp: 300 },
    ]);
    const r = firstRound(s);
    const narrations = r.segments.filter((seg) => seg.kind === "narration");
    expect(narrations.length).toBe(1);
    if (narrations[0]?.kind !== "narration") throw new Error("expected narration");
    // 是 right-narration（不是 thinking-fallback）
    expect(narrations[0].isThinkingFallback).toBeUndefined();
    expect(narrations[0].text).toBe("narration text");
  });

  it("execute thinking-only + 无 tool → 不派生 fallback（无意义的孤立 thinking）", () => {
    let s = setupExecuteRound();
    const mid = ChatId.message("r0", 0);
    s = applyOps(s, [
      startMessage("r0", mid, 200),
      {
        type: "message/set-thinking",
        roundId: "r0",
        messageId: mid,
        fullText: "isolated thinking",
      },
      { type: "message/end", roundId: "r0", messageId: mid, timestamp: 300 },
    ]);
    expect(firstRound(s).segments.filter((seg) => seg.kind === "narration").length).toBe(0);
  });
});



// ── 跨 message dedup（修 backend force-flush 越界推上一 message chat:delta 引发的 text 泄漏）─

describe("reduceSetText/Thinking 跨 message dedup（修法 N，2026-05）", () => {
  // 构造一个含已 finalized contribution 的 round（msg-0 task_create message 已 finalize）
  function setupWithFinalizedMsg(): { state: ChatState; finalizedText: string; mid1: string } {
    const rid = "r0";
    const mid0 = ChatId.message(rid, 0);
    const mid1 = ChatId.message(rid, 1);
    const finalizedText = "<plan>\n核心问题：xxx\n路径：调用 fin_data\n</plan>";
    let s = applyOps(createInitialChatState(), [
      startRound(rid),
      startMessage(rid, mid0, 100),
      { type: "message/set-text", roundId: rid, messageId: mid0, fullText: finalizedText },
      {
        type: "message/record-tool",
        roundId: rid,
        messageId: mid0,
        toolName: "task_create",
        toolCallId: "tc1",
        isStructural: true,
      },
      endMessage(rid, mid0, 200),
      // msg-1 开始（模拟 backend 推 message_start 切到 msg-1）
      startMessage(rid, mid1, 300),
    ]);
    return { state: s, finalizedText, mid1 };
  }

  it("force-flush 场景: set-text msg-1 fullText === msg-0 finalized contentText → 短路丢弃", () => {
    const { state, finalizedText, mid1 } = setupWithFinalizedMsg();
    // backend force-flush 越界推 msg-0 的 chat:delta，translator emit set-text msg-1 with finalizedText
    const next = applyOps(state, [
      { type: "message/set-text", roundId: "r0", messageId: mid1, fullText: finalizedText },
    ]);
    // 关键：msg-1 pending.contentText 仍为空（dedup 短路），不被错写入
    expect(firstRound(next).pending.get(mid1)?.contentText).toBe("");
  });

  it("不同内容 set-text 正常写入（不误伤）", () => {
    const { state, mid1 } = setupWithFinalizedMsg();
    const newText = "completely different message text";
    const next = applyOps(state, [
      { type: "message/set-text", roundId: "r0", messageId: mid1, fullText: newText },
    ]);
    expect(firstRound(next).pending.get(mid1)?.contentText).toBe(newText);
  });

  it("trailing whitespace 差异（实测 db93b797）→ trim 比对 dedup 命中", () => {
    // Real-world race: msg-0 contribution.contentText 被 mergeFullText rule 5 拼接
    // "\n\n" 分隔符；backend 边界后 force-flush 推到 msg-1 的 chat:delta fullText 没有
    // trailing "\n\n" → byte-equal 比对失败 → dedup 漏检 → msg-1 错写 plan 文本 → 派生
    // <plan> narration 错位。trim 比对吸收差异。
    const finalizedText = "<plan>\n**核心问题**：xxx\n</plan>\n\n"; // mergeFullText 拼接尾巴
    const flushedFullText = "<plan>\n**核心问题**：xxx\n</plan>"; // backend force-flush 无尾巴
    const rid = "r0";
    const mid0 = ChatId.message(rid, 0);
    const mid1 = ChatId.message(rid, 1);
    let s = applyOps(createInitialChatState(), [
      startRound(rid),
      startMessage(rid, mid0, 100),
      { type: "message/set-text", roundId: rid, messageId: mid0, fullText: finalizedText },
      {
        type: "message/record-tool",
        roundId: rid,
        messageId: mid0,
        toolName: "task_create",
        toolCallId: "tc1",
        isStructural: true,
      },
      endMessage(rid, mid0, 200),
      startMessage(rid, mid1, 300),
    ]);
    s = applyOps(s, [
      { type: "message/set-text", roundId: "r0", messageId: mid1, fullText: flushedFullText },
    ]);
    expect(firstRound(s).pending.get(mid1)?.contentText).toBe("");
  });

  it("流式 partial fullText（前缀关系）不误触发 dedup", () => {
    const { state, finalizedText, mid1 } = setupWithFinalizedMsg();
    // partial fullText 是 finalized 的前缀——不 exact equal，dedup 不触发
    const partial = finalizedText.slice(0, 20);
    const next = applyOps(state, [
      { type: "message/set-text", roundId: "r0", messageId: mid1, fullText: partial },
    ]);
    // partial 正常写入 pending
    expect(firstRound(next).pending.get(mid1)?.contentText).toBe(partial);
  });

  it("thinking 跨 message dedup 同款防御", () => {
    const rid = "r0";
    const mid0 = ChatId.message(rid, 0);
    const mid1 = ChatId.message(rid, 1);
    const thinkingText = "Let me think about this problem step by step";
    let s = applyOps(createInitialChatState(), [
      startRound(rid),
      startMessage(rid, mid0, 100),
      { type: "message/set-thinking", roundId: rid, messageId: mid0, fullText: thinkingText },
      {
        type: "message/record-tool",
        roundId: rid,
        messageId: mid0,
        toolName: "task_create",
        toolCallId: "tc1",
        isStructural: true,
      },
      endMessage(rid, mid0, 200),
      startMessage(rid, mid1, 300),
    ]);
    // backend force-flush 推 msg-0 thinking 给 msg-1
    s = applyOps(s, [
      { type: "message/set-thinking", roundId: rid, messageId: mid1, fullText: thinkingText },
    ]);
    // msg-1 pending.thinkingText 仍为空
    expect(firstRound(s).pending.get(mid1)?.thinkingText).toBe("");
  });
});



// ── 未知 op assertNever ─────────────────────────────────────────────────

describe("unknown op", () => {
  it("应抛错（assertNever）", () => {
    expect(() => chatReducer(createInitialChatState(), { type: "bogus" } as never)).toThrow(
      /Unhandled op/,
    );
  });
});
