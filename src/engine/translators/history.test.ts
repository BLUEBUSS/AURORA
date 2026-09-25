// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * History translator 单测：覆盖 v1 翻译规则。
 *
 * 关键不变性：
 *  - system-injected user 不开新 round，但 roundIndex ++（§20.4）
 *  - assistant text/thinking → message lifecycle + append-* 序列
 *  - assistant tool_use → record-tool + tool/start
 *  - tool result → tool/result（且 task_create/update result 含 plan 时再发 task/set-plan）
 *  - 末尾自动收尾 round/complete done
 */

import { describe, expect, it } from "vitest";
import {
  type HistoryMessage,
  historyToOps,
  historyToSubagentOps,
} from "./history";
import { ChatId } from "../model/chat.id";
import { applyOps } from "../model/chat.reducer";
import { selectConclusionText } from "../model/chat.selectors";
import { createInitialChatState } from "../model/chat.types";

const sk = "agent:main:session:test";

function userMsg(content: string, opts: Partial<HistoryMessage> = {}): HistoryMessage {
  return { role: "user", content, timestamp: opts.timestamp ?? 1, ...opts };
}

function asstMsg(text: string, opts: Partial<HistoryMessage> = {}): HistoryMessage {
  return { role: "assistant", content: text, timestamp: opts.timestamp ?? 2, ...opts };
}

describe("historyToOps - 基础", () => {
  it("空 messages → 空 ops", () => {
    expect(historyToOps([], sk)).toEqual([]);
  });

  it("单 user → round/start + 末尾 round/complete", () => {
    const ops = historyToOps([userMsg("hi")], sk);
    expect(ops.map((o) => o.type)).toEqual(["round/start", "round/complete"]);
    const startOp = ops[0];
    expect(startOp?.type === "round/start" && startOp.roundId).toBe(ChatId.round(sk, 0));
  });

  it("user + assistant text → 完整 message lifecycle", () => {
    const ops = historyToOps([userMsg("q"), asstMsg("answer")], sk);
    const types = ops.map((o) => o.type);
    expect(types).toEqual([
      "round/start",
      "message/start",
      "message/set-text",
      "message/end",
      "round/complete",
    ]);
  });

  it("两条 user → 两个 round；roundIndex 递增", () => {
    const ops = historyToOps([userMsg("q1"), asstMsg("a1"), userMsg("q2")], sk);
    const starts = ops.filter(
      (o): o is Extract<typeof o, { type: "round/start" }> => o.type === "round/start",
    );
    expect(starts.length).toBe(2);
    expect(starts[0]?.roundIndex).toBe(0);
    expect(starts[1]?.roundIndex).toBe(1);
  });
});

// ── system-injected user §20.4 ──────────────────────────────────────────

describe("historyToOps - system-injected user", () => {
  it("subagent announce 不开新 round，但 roundIndex ++", () => {
    const announce = '[System Message] A subagent task "research" just completed successfully';
    const ops = historyToOps(
      [userMsg("real q1"), asstMsg("ack"), userMsg(announce), asstMsg("continue")],
      sk,
    );
    const starts = ops.filter(
      (o): o is Extract<typeof o, { type: "round/start" }> => o.type === "round/start",
    );
    expect(starts.length).toBe(1);
    // §20.4 dealbreaker：system-injected 跳过后，下一个真实 user 的 index 不是 1，是 2
    expect(starts[0]?.roundIndex).toBe(0);
  });

  it("Task Steering 注入 → 同样跳过", () => {
    const ops = historyToOps(
      [userMsg("real"), userMsg("[Task Steering] 当前任务有 3 个阶段未完成")],
      sk,
    );
    const starts = ops.filter((o) => o.type === "round/start");
    expect(starts.length).toBe(1);
  });

  it("两条系统注入夹一条真 user → 真 user 的 roundIndex = 2（计数推进过两次）", () => {
    const announce = '[System Message] A subagent task "x" just completed successfully';
    const steering = "[Task Steering] foo";
    const ops = historyToOps([userMsg(announce), userMsg(steering), userMsg("real")], sk);
    const starts = ops.filter(
      (o): o is Extract<typeof o, { type: "round/start" }> => o.type === "round/start",
    );
    expect(starts.length).toBe(1);
    expect(starts[0]?.roundIndex).toBe(2);
    expect(starts[0]?.roundId).toBe(ChatId.round(sk, 2));
  });
});

// ── tool 翻译 ────────────────────────────────────────────────────────────

describe("historyToOps - tool", () => {
  it("assistant 含 tool_use → record-tool + tool/start；tool result → tool/result", () => {
    const ops = historyToOps(
      [
        userMsg("q"),
        {
          role: "assistant",
          content: [
            { type: "text", text: "calling..." },
            { type: "tool_use", id: "t1", name: "search", input: { q: "x" } },
          ],
          timestamp: 2,
        },
        { role: "tool", tool_call_id: "t1", result: { ok: true }, timestamp: 3 },
      ],
      sk,
    );
    const types = ops.map((o) => o.type);
    expect(types).toContain("message/record-tool");
    expect(types).toContain("tool/start");
    expect(types).toContain("tool/result");
  });

  it("task_create tool_use → 同时发 task/set-plan（含 phase steps）", () => {
    const plan = {
      id: "p",
      groups: [
        {
          id: "g",
          title: "g",
          type: "serial" as const,
          steps: [{ id: "phase-1", status: "pending" as const }],
        },
      ],
    };
    const ops = historyToOps(
      [
        userMsg("q"),
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "tc", name: "task_create", input: { plan } }],
          timestamp: 2,
        },
      ],
      sk,
    );
    const setPlanOp = ops.find(
      (o): o is Extract<typeof o, { type: "task/set-plan" }> => o.type === "task/set-plan",
    );
    expect(setPlanOp?.plan).toEqual(plan);
  });

  it("v1.8 §3.2 + S4.x-T 核心 verification gate: complete_phase(LAST) message + 紧跟报告 message → 报告 message contribution = report-conclusion", () => {
    // 钉子 2 op 顺序不变量：history translator emit 顺序保证下一条 message 的 phaseAtStart
    // 反映 task_update.complete_phase(LAST) 之后的 phase 状态（全 done → report）。
    const planWithSinglePhase = {
      id: "p",
      phases: [{ description: "p1" }],
    };
    const ops = historyToOps(
      [
        userMsg("q"),
        // msg-N: 含 task_create + task_update.complete_phase(0) tool（最后一个 phase done）
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tc1",
              name: "task_create",
              input: { plan: planWithSinglePhase },
            },
            {
              type: "tool_use",
              id: "tu1",
              name: "task_update",
              input: { action: "complete_phase", phase_index: 0 },
            },
          ],
          timestamp: 2,
        },
        // msg-N+1: 报告 message（pure text）
        {
          role: "assistant",
          content: [{ type: "text", text: "最终报告内容" }],
          timestamp: 3,
        },
      ],
      sk,
    );
    // 验证 op 顺序：msg-N message_end 后 → task/set-plan + task/update-phase →
    //                  msg-N+1 message_start（此时 phaseStatuses[0]=done → phaseOfRound=report）
    const opTypes = ops.map((o) => o.type);
    const msgEndCount = opTypes.filter((t) => t === "message/end").length;
    expect(msgEndCount).toBe(2); // 两条 assistant message 各一个 message_end

    // 应用 ops 到初始 state，断言 contributions 分类正确
    const stateAfter = applyOps(createInitialChatState(), ops);
    const round = stateAfter.rounds[0];
    if (!round) throw new Error("expected round");
    // 报告 message 是第二条 assistant message，messageId 对应 round 的 message index 1
    const reportMsgId = ChatId.message(round.id, 1);
    const contrib = round.contributions.get(reportMsgId);
    // 关键断言：报告 message 必须归 report-conclusion（不是 right-narration / left-conclusion）
    expect(contrib?.classification).toBe("report-conclusion");
    expect(contrib?.contentText).toBe("最终报告内容");
    // 报告 message 进 conclusion 卡
    expect(selectConclusionText(round)).toBe("最终报告内容");
  });

  it("越界的最终 complete_phase 在历史回放中收敛整个计划，且不产生任务 6", () => {
    const plan = {
      id: "five-phases",
      phases: Array.from({ length: 5 }, (_, i) => ({ description: `阶段 ${i + 1}` })),
    };
    const ops = historyToOps(
      [
        userMsg("q"),
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tc1",
              name: "task_create",
              input: { plan },
            },
          ],
          timestamp: 2,
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tu1",
              name: "task_update",
              input: {
                action: "complete_phase",
                phase_index: 5,
                summary: "全部深度分析完成",
              },
            },
          ],
          timestamp: 3,
        },
        asstMsg("最终综合研究报告", { timestamp: 4 }),
      ],
      sk,
    );
    const state = applyOps(createInitialChatState(), ops);
    const round = state.rounds[0];
    if (!round) throw new Error("expected round");

    expect(round.phaseStatuses).toEqual(["done", "done", "done", "done", "done"]);
    expect(
      round.segments.some(
        (segment) =>
          segment.kind === "phase-marker" &&
          (Array.isArray(segment.phaseIndex)
            ? segment.phaseIndex.includes(5)
            : segment.phaseIndex === 5),
      ),
    ).toBe(false);
    const report = [...round.contributions.values()].find((contribution) =>
      contribution.contentText.includes("最终综合研究报告"),
    );
    expect(report?.classification).toBe("report-conclusion");
  });

  it("§3.2（2026-05-20 恢复）: execute 期 message text + no tool → left-conclusion（进 conclusion）", () => {
    // 依据：finclaw agent loop 把 "assistant message 无 toolCall" 当作稳定终止信号——execute
    //   期 text + no tool 必然是给用户看的最终输出（结论 / 询问），归左栏 conclusion 卡。
    const planWithPhases = {
      id: "p",
      phases: [{ description: "p1" }, { description: "p2" }],
    };
    const ops = historyToOps(
      [
        userMsg("q"),
        // task_create message
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tc1",
              name: "task_create",
              input: { plan: planWithPhases },
            },
          ],
          timestamp: 2,
        },
        // execute 期 model 自判够了 / 询问用户：仅 text 无 tool
        {
          role: "assistant",
          content: [{ type: "text", text: "已获取关键数据，请确认是否要补充其他指标？" }],
          timestamp: 3,
        },
      ],
      sk,
    );
    const stateAfter = applyOps(createInitialChatState(), ops);
    const round = stateAfter.rounds[0];
    if (!round) throw new Error("expected round");
    const midMsgId = ChatId.message(round.id, 1);
    const contrib = round.contributions.get(midMsgId);
    expect(contrib?.classification).toBe("left-conclusion");
    expect(selectConclusionText(round)).toBe("已获取关键数据，请确认是否要补充其他指标？");
  });

  it("sessions_spawn 仅在 toolResult 翻译时 emit subagent/spawn（runId + childSessionKey）；assistant message 阶段不 emit 占位 spawn", () => {
    // 修法依据：阶段 1 用 callId 占位 + 阶段 2 用 runId emit 会让 reducer 同 sub-agent 留两条
    // SubagentRecord（callId / runId），导致：
    //   1. 主视图右栏派生两个 subagent-card segment（一个无 label / 一个真 label）
    //   2. SubagentDrillDown 读 callId record 报"缺少 childSessionKey"
    // 修法：跟 live 路径对齐，仅在 toolResult 翻译用真实 runId emit 一次 spawn。
    const ops = historyToOps(
      [
        userMsg("q"),
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "spawn-1",
              name: "sessions_spawn",
              input: { label: "research" },
            },
          ],
          timestamp: 2,
        },
        {
          role: "tool",
          tool_call_id: "spawn-1",
          // 实测 jsonl schema：runId / childSessionKey / label 平铺在 result 顶层
          result: { runId: "real-run-id", label: "research", childSessionKey: "child-sk" },
          timestamp: 3,
        },
      ],
      sk,
    );
    const spawns = ops.filter(
      (o): o is Extract<typeof o, { type: "subagent/spawn" }> => o.type === "subagent/spawn",
    );
    expect(spawns.length).toBe(1);
    expect(spawns[0]?.subagentId).toBe("real-run-id");
    expect(spawns[0]?.childSessionKey).toBe("child-sk");
    expect(spawns[0]?.label).toBe("research");
  });
});

// ── 集成：apply 后 selectConclusionText 应符合预期 ───────────────────────

describe("historyToOps - applied state", () => {
  it("简单对话：单 user + 单 assistant text → conclusion 文本就是 assistant text", () => {
    const ops = historyToOps([userMsg("q"), asstMsg("hello world")], sk);
    const state = applyOps(createInitialChatState(), ops);
    const round = state.rounds[0];
    if (!round) throw new Error("expected round[0]");
    expect(selectConclusionText(round)).toBe("hello world");
  });

  it("多轮对话：roundId 各自正确派生", () => {
    const ops = historyToOps([userMsg("q1"), asstMsg("a1"), userMsg("q2"), asstMsg("a2")], sk);
    const state = applyOps(createInitialChatState(), ops);
    expect(state.rounds.map((r) => r.id)).toEqual([ChatId.round(sk, 0), ChatId.round(sk, 1)]);
    expect(state.rounds.map((r) => r.status)).toEqual(["done", "done"]);
  });

  it("system-injected user 不创建新 round；后续 user 的 id 跟老 store rounds.length 派生对齐", () => {
    const announce = '[System Message] A subagent task "x" just completed successfully';
    const ops = historyToOps([userMsg("q1"), asstMsg("a1"), userMsg(announce), userMsg("q2")], sk);
    const state = applyOps(createInitialChatState(), ops);
    expect(state.rounds.length).toBe(2);
    // 老 store 派生 q2 的 id 时 rounds.length=2 → -round-2
    expect(state.rounds[1]?.id).toBe(ChatId.round(sk, 2));
  });

  it("防御 partial-flushed task_create.args.phases (string) 不抛错且不阻断后续翻译", () => {
    // 实证 jsonl b1c39537 #12：args.phases 是截断 JSON 字符串
    const partialTaskCreate: HistoryMessage = {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-partial-12",
          name: "task_create",
          input: {
            matched_skill: "earnings-research",
            phases: '[{"description": "采集..."},...截断', // ← string，不是 array
          },
        } as unknown as Record<string, unknown>,
      ],
      timestamp: 12,
    };
    const validTaskCreate: HistoryMessage = {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-valid-14",
          name: "task_create",
          input: {
            phases: [{ description: "P0" }, { description: "P1" }],
          },
        } as unknown as Record<string, unknown>,
      ],
      timestamp: 14,
    };
    const reportMsg: HistoryMessage = {
      role: "assistant",
      content: "# 最终报告内容",
      timestamp: 33,
    };

    // 整批不能抛错（Defense 3：try/catch 兜底）
    let ops: ReturnType<typeof historyToOps> | undefined;
    expect(() => {
      ops = historyToOps([userMsg("q"), partialTaskCreate, validTaskCreate, reportMsg], sk);
    }).not.toThrow();
    expect(ops).toBeDefined();

    // partial 不应 emit task/set-plan（normalizePlan 静默 reject 返回 null）
    // 但 valid 应 emit
    const setPlanOps = ops!.filter((o) => o.type === "task/set-plan");
    expect(setPlanOps.length).toBeGreaterThanOrEqual(1); // valid task_create 至少 emit 1 次

    // 后续 reportMsg 仍被翻译 → state 应有 contributions
    const state = applyOps(createInitialChatState(), ops!);
    const round = state.rounds[0];
    if (!round) throw new Error("expected round[0]");
    // report message 应进 conclusion 文本（具体文本因 phaseAtStart 推断而异，但起码非空）
    expect(round.contributions.size).toBeGreaterThan(0);
  });
});

// ── S4.5-T: historyToSubagentOps ─────────────────────────────────────────

describe("historyToSubagentOps", () => {
  const subId = "sub-test-1";
  const parentRid = "parent-round-0";

  it("空 messages → 仅 spawn 兜底", () => {
    const ops = historyToSubagentOps([], subId, parentRid);
    expect(ops.map((o) => o.type)).toEqual(["subagent/spawn"]);
  });

  it("每条 assistant message 都 emit subagent/message-start op（同步 reducer activeMessageIndex + 重置 segmentSeqByKind）", () => {
    // 修法依据：historyToSubagentOps 不 emit message-start op 时，reducer 内
    //   segmentSeqByKind 跨 message 累积——后续 live 流式 narration 派生 segmentId
    //   读累积值，跟 history 翻译 segmentId 命名空间错位 → patch 路径找不到 lastSeg
    //   → 同一段报告反复"新段"渲染（用户实测重复 3 次的 root cause）。
    const msgs: HistoryMessage[] = [
      { role: "assistant", content: "first", timestamp: 1 },
      { role: "assistant", content: "second", timestamp: 2 },
      { role: "assistant", content: "third", timestamp: 3 },
    ];
    const ops = historyToSubagentOps(msgs, subId, parentRid);
    const messageStartOps = ops.filter((o) => o.type === "subagent/message-start");
    expect(messageStartOps.length).toBe(3);
    expect(messageStartOps.every((o) => o.subagentId === subId)).toBe(true);
  });

  it("assistant text → narration 段，stable id `${subId}:1:narration:0`（首条 assistant 也 bump）", () => {
    const msgs: HistoryMessage[] = [{ role: "assistant", content: "hello", timestamp: 1 }];
    const ops = historyToSubagentOps(msgs, subId, parentRid);
    const seg = ops.find((o) => o.type === "subagent/append-segment");
    if (!seg || seg.type !== "subagent/append-segment" || seg.segment.kind !== "narration") {
      throw new Error("expected narration");
    }
    // mirror live: spawn (msgIdx=0) → first message_start (msgIdx=1) → text
    expect(seg.segment.id).toBe(`${subId}:1:narration:0`);
    expect(seg.segment.text).toBe("hello");
  });

  it("assistant thinking only + 后续 tool_use → flush 派生 thinking-fallback narration", () => {
    const msgs: HistoryMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "ponder…" },
          { type: "tool_use", id: "t1", name: "fetch", input: { q: 1 } },
        ],
        timestamp: 1,
      },
    ];
    const ops = historyToSubagentOps(msgs, subId, parentRid);
    const segs = ops.filter((o) => o.type === "subagent/append-segment");
    const fallback = segs.find(
      (o) =>
        o.type === "subagent/append-segment" &&
        o.segment.kind === "narration" &&
        o.segment.isThinkingFallback,
    );
    expect(fallback).toBeDefined();
    const batch = segs.find(
      (o) => o.type === "subagent/append-segment" && o.segment.kind === "tool-batch",
    );
    expect(batch).toBeDefined();
  });

  it("两条 assistant → activeMessageIndex 各自 1 / 2，narration id 含 :1: 和 :2:", () => {
    const msgs: HistoryMessage[] = [
      { role: "assistant", content: "first", timestamp: 1 },
      { role: "assistant", content: "second", timestamp: 2 },
    ];
    const ops = historyToSubagentOps(msgs, subId, parentRid);
    const segs = ops.filter(
      (o) => o.type === "subagent/append-segment" && o.segment.kind === "narration",
    );
    expect(segs.length).toBe(2);
    if (
      segs[0]?.type === "subagent/append-segment" &&
      segs[1]?.type === "subagent/append-segment"
    ) {
      expect(segs[0].segment.id).toBe(`${subId}:1:narration:0`);
      expect(segs[1].segment.id).toBe(`${subId}:2:narration:0`);
    }
  });

  it("应用后 reducer 正确累积 segments（merge by id 不重复）", () => {
    const msgs: HistoryMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "narration text" },
          { type: "tool_use", id: "t1", name: "fetch", input: {} },
        ],
        timestamp: 1,
      },
      { role: "tool", toolCallId: "t1", content: "result", timestamp: 2 },
    ];
    const ops = historyToSubagentOps(msgs, subId, parentRid);
    const state = applyOps(createInitialChatState(), ops);
    const segs = state.subagents.get(subId)?.segments ?? [];
    // 1 narration + 1 tool-batch
    expect(segs.length).toBe(2);
    expect(segs[0]?.kind).toBe("narration");
    expect(segs[1]?.kind).toBe("tool-batch");
    // 重复应用 → merge by id，不重复（Bug 1a 修法）
    const stateRetry = applyOps(state, ops);
    expect(stateRetry.subagents.get(subId)?.segments.length).toBe(2);
  });
});
