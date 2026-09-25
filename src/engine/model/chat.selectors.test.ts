// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * chat.selectors 单测：派生函数边缘行为。
 *
 * 测试基于 reducer apply 出真实 state，不构造手工 round 以减少测试-实现耦合。
 */

import { describe, expect, it } from "vitest";
import { ChatId } from "./chat.id";
import type { ChatOp } from "./chat.ops";
import { applyOps } from "./chat.reducer";
import {
  ChatSelect,
  selectActivePhase,
  selectAllPhasesDone,
  selectConclusionText,
  selectIsStreaming,
  selectLeftCards,
  selectPhase,
  selectPreplanThinkingText,
  selectReportThinkingText,
} from "./chat.selectors";
import { createInitialChatState } from "./chat.types";
import type { ChatMessage } from "../contracts/protocol";

const firstRound = (s: ReturnType<typeof createInitialChatState>) => {
  const r = s.rounds[0];
  if (!r) throw new Error("expected round[0]");
  return r;
};

const userMsg: ChatMessage = { id: "u-1", role: "user", content: "hi", timestamp: 1 };

const startRound = (rid = "r0", session = "s", ts = 100): ChatOp => ({
  type: "round/start",
  roundId: rid,
  userMessage: userMsg,
  sessionKey: session,
  roundIndex: 0,
  timestamp: ts,
});

const setRunningPlan = (rid = "r0"): ChatOp => ({
  type: "task/set-plan",
  roundId: rid,
  plan: {
    id: "p",
    groups: [
      {
        id: "g1",
        title: "g1",
        type: "serial",
        steps: [
          { id: "s1", status: "running" },
          { id: "s2", status: "pending" },
        ],
      },
    ],
  },
});

const setAllDonePlan = (rid = "r0"): ChatOp => ({
  type: "task/set-plan",
  roundId: rid,
  plan: {
    id: "p",
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
  },
});

function pushMessage(
  rid: string,
  mid: string,
  opts: {
    text?: string;
    thinking?: string;
    tools?: Array<{ name: string; id: string; structural?: boolean }>;
    end?: boolean;
    ts?: number;
  } = {},
): ChatOp[] {
  const ops: ChatOp[] = [
    { type: "message/start", roundId: rid, messageId: mid, timestamp: opts.ts ?? 200 },
  ];
  if (opts.thinking) {
    ops.push({
      type: "message/set-thinking",
      roundId: rid,
      messageId: mid,
      fullText: opts.thinking,
    });
  }
  if (opts.text) {
    ops.push({ type: "message/set-text", roundId: rid, messageId: mid, fullText: opts.text });
  }
  for (const t of opts.tools ?? []) {
    ops.push({
      type: "message/record-tool",
      roundId: rid,
      messageId: mid,
      toolName: t.name,
      toolCallId: t.id,
      isStructural: !!t.structural,
    });
  }
  if (opts.end !== false) {
    ops.push({
      type: "message/end",
      roundId: rid,
      messageId: mid,
      timestamp: (opts.ts ?? 200) + 50,
    });
  }
  return ops;
}

// ── selectPhase ─────────────────────────────────────────────────────────

describe("selectPhase", () => {
  it("无 task → pre-plan", () => {
    const s = applyOps(createInitialChatState(), [startRound()]);
    expect(selectPhase(firstRound(s))).toBe("pre-plan");
  });

  it("有 phase 且未全 done → execution", () => {
    const s = applyOps(createInitialChatState(), [startRound(), setRunningPlan()]);
    expect(selectPhase(firstRound(s))).toBe("execution");
  });

  it("所有 phase done → report", () => {
    const s = applyOps(createInitialChatState(), [startRound(), setAllDonePlan()]);
    expect(selectPhase(firstRound(s))).toBe("report");
  });
});

// ── 文本派生 ────────────────────────────────────────────────────────────

describe("conclusion text 派生", () => {
  it("空 round 返回空字符串", () => {
    const s = applyOps(createInitialChatState(), [startRound()]);
    expect(selectConclusionText(firstRound(s))).toBe("");
  });

  it("pre-plan content 应该进 conclusion", () => {
    const mid = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      ...pushMessage("r0", mid, { text: "Hello" }),
    ]);
    expect(selectConclusionText(firstRound(s))).toBe("Hello");
  });

  it("§3.2（2026-05-20 恢复）: execution + 无 tool 的 text → left-conclusion（进 conclusion 卡）", () => {
    const mid = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      setRunningPlan(),
      ...pushMessage("r0", mid, { text: "left side" }),
    ]);
    // 依据：finclaw agent loop 把 "无 tool" 当作终止信号 → execute 期 text + no tool
    //   必然是结论/确认输出 → 进左栏 conclusion 卡
    expect(selectConclusionText(firstRound(s))).toBe("left side");
  });

  it("simple-bubble 守门: 简单对话场景（无 task_create）pre-plan 后 conclusion 非空", () => {
    // 简单对话：无 task → pre-plan + text + no tool → preplan-content → 进 conclusion
    const mid = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      ...pushMessage("r0", mid, { text: "Hello, how can I help?" }),
    ]);
    expect(selectConclusionText(firstRound(s))).toBe("Hello, how can I help?");
  });

  it("deep-research execute 期 中间话术（有 tool）不污染 conclusion，无 tool message 进 conclusion", () => {
    // deep-research：execute 期含 tool 的 message text → right-narration（右栏过程话术，不进 conclusion）
    //   纯 text 无 tool 的 message → left-conclusion（终止/确认输出，进 conclusion）
    const mid1 = ChatId.message("r0", 0);
    const mid2 = ChatId.message("r0", 1);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      setRunningPlan(),
      // execute 期含 text + tool 的 message → 右栏 narration，不进 conclusion
      ...pushMessage("r0", mid1, { text: "我来分析数据", tools: [{ name: "fin_data", id: "t1" }] }),
      // execute 期纯 text 无 tool message → 进 conclusion
      ...pushMessage("r0", mid2, { text: "已获取关键数据" }),
    ]);
    expect(selectConclusionText(firstRound(s))).toBe("已获取关键数据");
  });

  it("execution + 有 tool 的 text → right-narration → 不进 conclusion", () => {
    const mid = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      setRunningPlan(),
      ...pushMessage("r0", mid, { text: "right side", tools: [{ name: "x", id: "t1" }] }),
    ]);
    expect(selectConclusionText(firstRound(s))).toBe("");
  });

  it("多条 contribution 按 finalizedAt 升序拼接（\\n\\n 分隔）", () => {
    const m0 = ChatId.message("r0", 0);
    const m1 = ChatId.message("r0", 1);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      ...pushMessage("r0", m0, { text: "first", ts: 100 }),
      ...pushMessage("r0", m1, { text: "second", ts: 200 }),
    ]);
    expect(selectConclusionText(firstRound(s))).toBe("first\n\nsecond");
  });
});

describe("preplan / report thinking 派生", () => {
  it("preplan thinking 累加", () => {
    const m0 = ChatId.message("r0", 0);
    const m1 = ChatId.message("r0", 1);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      ...pushMessage("r0", m0, { thinking: "T1", ts: 100 }),
      ...pushMessage("r0", m1, { thinking: "T2", ts: 200 }),
    ]);
    expect(selectPreplanThinkingText(firstRound(s))).toBe("T1\n\nT2");
  });

  it("report thinking 累加（在 report 阶段）", () => {
    const m0 = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      setAllDonePlan(),
      ...pushMessage("r0", m0, { thinking: "report think" }),
    ]);
    expect(selectReportThinkingText(firstRound(s))).toBe("report think");
  });

  it("execution thinking 应被丢弃 → preplan/report 都为空", () => {
    const mid = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      setRunningPlan(),
      ...pushMessage("r0", mid, { thinking: "ignored" }),
    ]);
    expect(selectPreplanThinkingText(firstRound(s))).toBe("");
    expect(selectReportThinkingText(firstRound(s))).toBe("");
  });
});

// ── selectLeftCards ─────────────────────────────────────────────────────

describe("selectLeftCards", () => {
  it("固定四 slot 顺序：preplan-thinking → task → report-thinking → conclusion", () => {
    const m0 = ChatId.message("r0", 0);
    const m1 = ChatId.message("r0", 1);
    // pre-plan thinking + content（在 set-plan 之前）
    // 然后 set-plan 进入 execution
    // execution 里手动把 phase 改成 done 进入 report，让 thinking 走 report-thinking
    const s = applyOps(createInitialChatState(), [
      startRound(),
      ...pushMessage("r0", m0, { thinking: "pre-think", text: "pre-text", ts: 100 }),
      setAllDonePlan(),
      ...pushMessage("r0", m1, { thinking: "rep-think", text: "rep-text", ts: 200 }),
    ]);
    const cards = selectLeftCards(firstRound(s));
    const kinds = cards.map((c) => c.kind);
    expect(kinds).toEqual(["preplan-thinking", "task", "report-thinking", "conclusion"]);
  });

  it("无内容则不出空卡", () => {
    const s = applyOps(createInitialChatState(), [startRound()]);
    expect(selectLeftCards(firstRound(s))).toEqual([]);
  });
});

// ── selectIsStreaming / Phase 辅助 ──────────────────────────────────────

describe("selectIsStreaming", () => {
  it("active round 是 streaming → true", () => {
    const s = applyOps(createInitialChatState(), [startRound()]);
    expect(selectIsStreaming(s)).toBe(true);
  });

  it("round 已 complete → false", () => {
    const s = applyOps(createInitialChatState(), [
      startRound(),
      { type: "round/complete", roundId: "r0", status: "done", timestamp: 999 },
    ]);
    expect(selectIsStreaming(s)).toBe(false);
  });
});

describe("selectAllPhasesDone / selectActivePhase", () => {
  it("无 phase → allDone false / active null", () => {
    const s = applyOps(createInitialChatState(), [startRound()]);
    expect(selectAllPhasesDone(firstRound(s))).toBe(false);
    expect(selectActivePhase(firstRound(s))).toBeNull();
  });

  it("有 running phase → 返回该 step", () => {
    const s = applyOps(createInitialChatState(), [startRound(), setRunningPlan()]);
    expect(selectActivePhase(firstRound(s))?.id).toBe("s1");
    expect(selectAllPhasesDone(firstRound(s))).toBe(false);
  });

  it("全部 done → allDone true", () => {
    const s = applyOps(createInitialChatState(), [startRound(), setAllDonePlan()]);
    expect(selectAllPhasesDone(firstRound(s))).toBe(true);
  });
});

describe("ChatSelect 命名空间", () => {
  it("应该聚合主要 selectors", () => {
    expect(typeof ChatSelect.phase).toBe("function");
    expect(typeof ChatSelect.conclusionText).toBe("function");
    expect(typeof ChatSelect.leftCards).toBe("function");
    expect(typeof ChatSelect.activeRound).toBe("function");
  });
});

// ── v1.3 §20.11: pre-plan 流式默认 thinking 样式 + report pending 可见 ────

describe("v1.3: selector pre-plan/report 流式 pending 行为", () => {
  it("phase=report + pending 有 textBlocks → selectConclusionText 包含 pending text", () => {
    const m0 = ChatId.message("r0", 0);
    // 先 set-plan + 把全部 phase 推 done → 进入 report 阶段
    // 再开新 message（phaseAtStart=report）+ append text，但不 message_end
    const s = applyOps(createInitialChatState(), [
      startRound(),
      setAllDonePlan(),
      { type: "message/start", roundId: "r0", messageId: m0, timestamp: 200 },
      { type: "message/set-text", roundId: "r0", messageId: m0, fullText: "stream..." },
    ]);
    expect(selectConclusionText(firstRound(s))).toBe("stream...");
  });

  it("phase=execution + pending 有 textBlocks → selectConclusionText 不读 pending", () => {
    const m0 = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      setRunningPlan(),
      { type: "message/start", roundId: "r0", messageId: m0, timestamp: 200 },
      { type: "message/set-text", roundId: "r0", messageId: m0, fullText: "stream..." },
    ]);
    // execution 阶段分类未定（要等 message_end 看是否含 tool），不能读 pending
    expect(selectConclusionText(firstRound(s))).toBe("");
  });

  it("v1.3: phase=pre-plan + pending text 流式中 → 不进 conclusion，进 preplan-thinking 流式可见", () => {
    // race condition 修法核心 case：text 已到、tool 还没到的窗口里
    // 老 v1.1 行为：text 进 conclusion → tool 到 + message_end → text 跳到 thinking（视觉跳变）
    // v1.3 行为：text 一直在 thinking 卡 live 显示，message_end 后维持 thinking 或升级 conclusion
    const m0 = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      { type: "message/start", roundId: "r0", messageId: m0, timestamp: 200 },
      { type: "message/set-text", roundId: "r0", messageId: m0, fullText: "hi " },
    ]);
    expect(selectConclusionText(firstRound(s))).toBe("");
    expect(selectPreplanThinkingText(firstRound(s))).toContain("hi ");
  });

  it("v1.3: pre-plan race window（text 先到 + tool 后到）→ 视觉无跳变", () => {
    const m0 = ChatId.message("r0", 0);
    // T1 chat:delta text 已到；T2 record-tool task_create 还没到
    const sBeforeTool = applyOps(createInitialChatState(), [
      startRound(),
      { type: "message/start", roundId: "r0", messageId: m0, timestamp: 200 },
      { type: "message/set-text", roundId: "r0", messageId: m0, fullText: "我来规划一下" },
    ]);
    // 关键：race window 内 conclusion 卡空白、thinking 卡显示——无 v1.1 那种黑色样式闪现
    expect(selectConclusionText(firstRound(sBeforeTool))).toBe("");
    expect(selectPreplanThinkingText(firstRound(sBeforeTool))).toContain("我来规划一下");

    // T3 record-tool 到达后，仍维持 thinking 卡显示（不跳变）
    const sAfterTool = applyOps(sBeforeTool, [
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: m0,
        toolName: "task_create",
        toolCallId: "tc1",
        isStructural: true,
      },
    ]);
    expect(selectConclusionText(firstRound(sAfterTool))).toBe("");
    expect(selectPreplanThinkingText(firstRound(sAfterTool))).toContain("我来规划一下");
  });

  it("v1.3: 简单对话场景——pre-plan + 无 tool message → message_end 后升级到 conclusion", () => {
    const m0 = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      { type: "message/start", roundId: "r0", messageId: m0, timestamp: 200 },
      { type: "message/set-text", roundId: "r0", messageId: m0, fullText: "Hello world" },
      { type: "message/end", roundId: "r0", messageId: m0, timestamp: 300 },
    ]);
    // message_end 后无 tool → classify 归 preplan-content → 进 conclusion
    expect(selectConclusionText(firstRound(s))).toBe("Hello world");
    // thinking 卡不再含该 text（pending 已清空，contribution 是 preplan-content 不是 preplan-thinking）
    expect(selectPreplanThinkingText(firstRound(s))).toBe("");
  });

  it("v1.5: pre-plan thinking 优先——pending 同时有 thinking + content 时只显 thinking", () => {
    // 用户反馈：原 selector 把 thinking + content 都拼接显示。期望规则与老路径
    // composeThinkingCardText 一致：有 thinking 就只用 thinking，无 thinking 才用 content。
    const m0 = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      { type: "message/start", roundId: "r0", messageId: m0, timestamp: 200 },
      { type: "message/set-text", roundId: "r0", messageId: m0, fullText: "我来规划一下" },
      { type: "message/set-thinking", roundId: "r0", messageId: m0, fullText: "思考: 用户想..." },
    ]);
    // 只显 thinking，content "我来规划一下" 不出现
    expect(selectPreplanThinkingText(firstRound(s))).toBe("思考: 用户想...");
  });

  it("v1.5: pre-plan thinking 优先——contribution 同时有 thinking + content 时只显 thinking", () => {
    // race window 后 message_end，含 tool → preplan-thinking 类，contribution 双字段非空
    const m0 = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      { type: "message/start", roundId: "r0", messageId: m0, timestamp: 200 },
      { type: "message/set-text", roundId: "r0", messageId: m0, fullText: "我先读文档" },
      {
        type: "message/set-thinking",
        roundId: "r0",
        messageId: m0,
        fullText: "思考: 需读 SKILL.md",
      },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: m0,
        toolName: "read",
        toolCallId: "rd1",
        isStructural: false,
      },
      { type: "message/end", roundId: "r0", messageId: m0, timestamp: 300 },
    ]);
    // contribution 同时有 thinkingText + contentText，但 selector 只取 thinkingText
    expect(selectPreplanThinkingText(firstRound(s))).toBe("思考: 需读 SKILL.md");
  });

  it("v1.5: pre-plan 无 thinking 有 content 时回退用 content（race + 简单对话兼容）", () => {
    const m0 = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      { type: "message/start", roundId: "r0", messageId: m0, timestamp: 200 },
      { type: "message/set-text", roundId: "r0", messageId: m0, fullText: "Hello" },
    ]);
    // 仅 contentText 时仍显示（保留 v1.3 §20.12 race 修复）
    expect(selectPreplanThinkingText(firstRound(s))).toBe("Hello");
  });

  it("v1.3: pre-plan + tool message → message_end 后 text 留 thinking 卡", () => {
    const m0 = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      { type: "message/start", roundId: "r0", messageId: m0, timestamp: 200 },
      { type: "message/set-text", roundId: "r0", messageId: m0, fullText: "我先读一下文档" },
      {
        type: "message/record-tool",
        roundId: "r0",
        messageId: m0,
        toolName: "read",
        toolCallId: "rd1",
        isStructural: false,
      },
      { type: "message/end", roundId: "r0", messageId: m0, timestamp: 300 },
    ]);
    expect(selectConclusionText(firstRound(s))).toBe("");
    expect(selectPreplanThinkingText(firstRound(s))).toContain("我先读一下文档");
  });

  it("phase=report + pending thinking → selectReportThinkingText 流式可见", () => {
    const m0 = ChatId.message("r0", 0);
    const s = applyOps(createInitialChatState(), [
      startRound(),
      setAllDonePlan(),
      { type: "message/start", roundId: "r0", messageId: m0, timestamp: 200 },
      { type: "message/set-thinking", roundId: "r0", messageId: m0, fullText: "report thinking" },
    ]);
    expect(selectReportThinkingText(firstRound(s))).toBe("report thinking");
  });
});
