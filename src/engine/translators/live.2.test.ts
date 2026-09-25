// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import { describe, expect, it } from "vitest";
import { deriveMessageEndOp, deriveRoundCompleteOp, deriveRoundStartOp, liveToOps } from "./live";
import { applyOps } from "../model/chat.reducer";
import { type ChatState, createInitialChatState } from "../model/chat.types";
import type { ChatMessage } from "../contracts/protocol";



const userMsg: ChatMessage = { id: "u-1", role: "user", content: "hi", timestamp: 1 };



function bootstrapWithRound(): ChatState {
  const s0 = createInitialChatState();
  const startOp = deriveRoundStartOp(s0, "s", userMsg);
  return applyOps(s0, [startOp]);
}



// ── 未识别事件 ─────────────────────────────────────────────────────────

describe("untranslated", () => {
  it("agent:usage v1 不翻译", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps({ event: "agent", payload: { stream: "usage", data: {} } }, s);
    expect(ops).toEqual([]);
  });

  it("未知 event 不翻译", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps({ event: "ping", payload: {} }, s);
    expect(ops).toEqual([]);
  });
});



// ── S4.5-T: subagent 内部翻译（text / thinking / tool / phase-marker）─

describe("S4.5-T translate agent:assistant subagent", () => {
  it("subagent text → spawn 兜底 + append-segment narration + clear pending-thinking", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps(
      {
        event: "agent",
        payload: { stream: "assistant", data: { subagentId: "sub1", text: "hello world" } },
      },
      s,
    );
    const types = ops.map((o) => o.type);
    expect(types).toEqual([
      "subagent/spawn",
      "subagent/append-segment",
      "subagent/pending-thinking",
    ]);
    const seg = ops[1];
    if (!seg || seg.type !== "subagent/append-segment" || seg.segment.kind !== "narration") {
      throw new Error("expected narration segment");
    }
    expect(seg.segment.id).toBe("sub1:0:narration:0");
    expect(seg.segment.text).toBe("hello world");
    const clearOp = ops[2];
    if (!clearOp || clearOp.type !== "subagent/pending-thinking") {
      throw new Error("expected pending-thinking op");
    }
    expect(clearOp.action).toBe("clear");
  });

  it("subagent thinking only → pending-thinking set（不直接 emit segment）", () => {
    const s = bootstrapWithRound();
    const ops = liveToOps(
      {
        event: "agent",
        payload: { stream: "thinking", data: { subagentId: "sub1", text: "ponder…" } },
      },
      s,
    );
    expect(ops.map((o) => o.type)).toEqual(["subagent/spawn", "subagent/pending-thinking"]);
    const op = ops[1];
    if (!op || op.type !== "subagent/pending-thinking") throw new Error("expected pending op");
    expect(op.action).toBe("set");
    expect(op.text).toBe("ponder…");
  });

  it("subagent text + lastSeg narration startsWith → patch 同 id", () => {
    let s = bootstrapWithRound();
    s = applyOps(
      s,
      liveToOps(
        {
          event: "agent",
          payload: { stream: "assistant", data: { subagentId: "sub1", text: "hello" } },
        },
        s,
      ),
    );
    // 第二次 fullText（startsWith 第一段）
    const ops = liveToOps(
      {
        event: "agent",
        payload: { stream: "assistant", data: { subagentId: "sub1", text: "hello world" } },
      },
      s,
    );
    // 应只 emit 1 op：append-segment 同 id（patch text）
    const appendOps = ops.filter((o) => o.type === "subagent/append-segment");
    expect(appendOps.length).toBe(1);
    const seg = appendOps[0];
    if (!seg || seg.type !== "subagent/append-segment" || seg.segment.kind !== "narration") {
      throw new Error("expected narration");
    }
    expect(seg.segment.id).toBe("sub1:0:narration:0"); // 同 id
    expect(seg.segment.text).toBe("hello world");
  });

  it("subagent message_start → ensureSpawn + subagent/message-start", () => {
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



describe("S4.5-T translate agent:tool subagent", () => {
  it("subagent 普通 tool start → tool/start + flush + tool-batch（无 pending → flush noop）", () => {
    let s = bootstrapWithRound();
    s = applyOps(s, [
      {
        type: "subagent/spawn",
        parentRoundId: s.rounds[0]!.id,
        subagentId: "sub1",
        label: "x",
        timestamp: 1,
      },
    ]);
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: { subagentId: "sub1", toolCallId: "t1", toolName: "fetch", args: {} },
        },
      },
      s,
    );
    const types = ops.map((o) => o.type);
    // tool/start + pending-thinking flush + append-segment(tool-batch)
    expect(types).toEqual(["tool/start", "subagent/pending-thinking", "subagent/append-segment"]);
    const seg = ops[2];
    if (!seg || seg.type !== "subagent/append-segment" || seg.segment.kind !== "tool-batch") {
      throw new Error("expected tool-batch");
    }
    expect(seg.segment.id).toBe("sub1:0:tool-batch:0");
    expect(seg.segment.toolCallIds).toEqual(["t1"]);
  });

  it("subagent task_create.args → phase-marker(create) 不 emit task/set-plan", () => {
    let s = bootstrapWithRound();
    s = applyOps(s, [
      {
        type: "subagent/spawn",
        parentRoundId: s.rounds[0]!.id,
        subagentId: "sub1",
        label: "x",
        timestamp: 1,
      },
    ]);
    const ops = liveToOps(
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
      s,
    );
    const types = ops.map((o) => o.type);
    // 子 agent 路径：tool/start + append-segment(phase-marker)，**不**写主 agent task/set-plan
    expect(types).toContain("tool/start");
    expect(types).toContain("subagent/append-segment");
    expect(types).not.toContain("task/set-plan");
    const marker = ops.find(
      (o) => o.type === "subagent/append-segment" && o.segment.kind === "phase-marker",
    );
    if (
      !marker ||
      marker.type !== "subagent/append-segment" ||
      marker.segment.kind !== "phase-marker"
    ) {
      throw new Error("expected phase-marker");
    }
    expect(marker.segment.action).toBe("create");
    expect(marker.segment.planPhaseCount).toBe(2);
  });

  it("subagent task_update.complete_phase → phase-marker(complete) 不 emit task/update-phase", () => {
    let s = bootstrapWithRound();
    s = applyOps(s, [
      {
        type: "subagent/spawn",
        parentRoundId: s.rounds[0]!.id,
        subagentId: "sub1",
        label: "x",
        timestamp: 1,
      },
    ]);
    const ops = liveToOps(
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
      s,
    );
    const types = ops.map((o) => o.type);
    expect(types).not.toContain("task/update-phase");
    const marker = ops.find(
      (o) => o.type === "subagent/append-segment" && o.segment.kind === "phase-marker",
    );
    if (
      !marker ||
      marker.type !== "subagent/append-segment" ||
      marker.segment.kind !== "phase-marker"
    ) {
      throw new Error("expected phase-marker");
    }
    expect(marker.segment.action).toBe("complete");
    expect(marker.segment.phaseIndex).toBe(0);
    expect(marker.segment.summaries).toEqual(["ok"]);
  });

  it("subagent tool result → tool/result（不动 segments）", () => {
    let s = bootstrapWithRound();
    s = applyOps(s, [
      {
        type: "subagent/spawn",
        parentRoundId: s.rounds[0]!.id,
        subagentId: "sub1",
        label: "x",
        timestamp: 1,
      },
    ]);
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: {
            subagentId: "sub1",
            toolCallId: "t1",
            toolName: "fetch",
            result: { ok: true },
          },
        },
      },
      s,
    );
    expect(ops.length).toBe(1);
    expect(ops[0]?.type).toBe("tool/result");
  });

  it("subagent tool start with pending thinking → flush emits thinking-fallback narration first", () => {
    let s = bootstrapWithRound();
    s = applyOps(s, [
      {
        type: "subagent/spawn",
        parentRoundId: s.rounds[0]!.id,
        subagentId: "sub1",
        label: "x",
        timestamp: 1,
      },
      {
        type: "subagent/pending-thinking",
        subagentId: "sub1",
        action: "set",
        text: "ponder",
      },
    ]);
    const ops = liveToOps(
      {
        event: "agent",
        payload: {
          stream: "tool",
          data: { subagentId: "sub1", toolCallId: "t1", toolName: "fetch", args: {} },
        },
      },
      s,
    );
    // ops 序列：tool/start → pending-thinking flush → append-segment(tool-batch)
    // reducer 应用 flush 时 detect pending → 派生 thinking-fallback narration
    const finalState = applyOps(s, ops);
    const segs = finalState.subagents.get("sub1")?.segments ?? [];
    const fallback = segs.find((g) => g.kind === "narration" && g.isThinkingFallback);
    expect(fallback).toBeDefined();
    if (fallback?.kind === "narration") expect(fallback.text).toBe("ponder");
    const batch = segs.find((g) => g.kind === "tool-batch");
    expect(batch).toBeDefined();
  });
});



// ── derive helpers ──────────────────────────────────────────────────────

describe("derive helpers", () => {
  it("deriveRoundCompleteOp 携带 status", () => {
    const op = deriveRoundCompleteOp("r0", "aborted");
    expect(op.type === "round/complete" && op.status).toBe("aborted");
  });

  it("deriveMessageEndOp 携带 messageId", () => {
    const op = deriveMessageEndOp("r0", "r0:msg-0");
    expect(op.type === "message/end" && op.messageId).toBe("r0:msg-0");
  });
});
