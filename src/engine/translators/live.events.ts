// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import { sanitizeNarrationText, stripReasoningFormat } from "./_text-normalize";
import { ChatId } from "../model/chat.id";
import type { ChatOp } from "../model/chat.ops";
import type { ChatState, SessionKey, SubagentId, SubagentRecord } from "../model/chat.types";
import { activeRound, extractTextFromMessage } from "./live.common";
import { ensureSubagentSpawnOps, translateSubagentNarrationText } from "./live.subagent";


// ── chat 事件 ────────────────────────────────────────────────────────────

export function translateChatDelta(state: ChatState, payload: Record<string, unknown>): ChatOp[] {
  const round = activeRound(state);
  if (!round) return []; // 无活跃 round：onUserSend 应该已 dispatch round/start，否则是 stray
  const text = extractTextFromMessage(payload.message);
  if (!text) return [];
  // **严格化（修 task_create text 跨 message 泄漏 race）**：activeMessageId null 时丢弃 stray
  // chat:delta，不再隐式创建 messageId。
  //
  // Root cause（dump 实证）：backend 在切下一 message 后 force-flush 仍推上一 message 的 chat:delta
  // → 旧逻辑隐式开新 messageId 派 set-text → task_create text 流到下一 message pending →
  // classify 按 phaseAtStart=execute 错归 right-narration → narration 重复显示 `<plan>...`。
  //
  // 严格化后 stray chat:delta 被丢弃；fullText 累积特性下偶发首帧丢失，下一帧 set-text 携带累积
  // 内容补回视觉延迟一帧——backend 协议契约：chat:delta 必须在对应 message_start 之后到达。
  if (!round.activeMessageId) return [];
  // v1.4: backend 推 fullText 直接 set 覆盖
  return [
    {
      type: "message/set-text",
      roundId: round.id,
      messageId: round.activeMessageId,
      fullText: text,
    },
  ];
}


export function translateChatTerminal(
  state: ChatState,
  status: "done" | "failed" | "aborted",
  reason?: string,
): ChatOp[] {
  const round = activeRound(state);
  if (!round) return [];
  const ops: ChatOp[] = [];
  if (round.activeMessageId) {
    ops.push({
      type: "message/end",
      roundId: round.id,
      messageId: round.activeMessageId,
      timestamp: Date.now(),
    });
  }
  ops.push({
    type: "round/complete",
    roundId: round.id,
    status,
    reason,
    timestamp: Date.now(),
  });
  return ops;
}


// mergePhaseIndexValues / isMergeablePhaseAction 抽到 stores/chat.merge-helpers.ts
// 共享给主 agent reducer 用——避免双份维护漂移。

// ── agent 事件 ──────────────────────────────────────────────────────────

export function translateAgentLifecycle(state: ChatState, data: Record<string, unknown>): ChatOp[] {
  const phase = (data.phase || data.event || "") as string;
  const subagentId = data.subagentId as SubagentId | undefined;

  if (subagentId) {
    if (phase === "start" || phase === "run.start") {
      const round = activeRound(state);
      if (!round) return [];
      const label =
        (data.subagentLabel as string) || (data.label as string) || subagentId.slice(-8);
      // 幂等：reducer 见到同 id 会短路
      return [
        {
          type: "subagent/spawn",
          parentRoundId: round.id,
          subagentId,
          label,
          childSessionKey: data.childSessionKey as SessionKey | undefined,
          timestamp: Date.now(),
        },
      ];
    }
    if (phase === "end" || phase === "run.end") {
      return [
        { type: "subagent/lifecycle-end", subagentId, status: "done", timestamp: Date.now() },
      ];
    }
    if (phase === "error") {
      return [
        { type: "subagent/lifecycle-end", subagentId, status: "failed", timestamp: Date.now() },
      ];
    }
    return [];
  }

  // 主 agent lifecycle
  if (phase === "end" || phase === "run.end") {
    return translateChatTerminal(state, "done");
  }
  if (phase === "error") {
    return translateChatTerminal(state, "failed", "lifecycle:error");
  }
  return [];
}


export function translateAgentAssistant(state: ChatState, data: Record<string, unknown>): ChatOp[] {
  const subagentId = data.subagentId as SubagentId | undefined;

  // ── Subagent 路径（S4.5-T mirror 老 chat-event-handler.ts:1080-1099）──
  if (subagentId) {
    const round = activeRound(state);
    if (!round) return [];
    const ops: ChatOp[] = [
      ...ensureSubagentSpawnOps(state, round.id, subagentId, {
        label: data.subagentLabel as string | undefined,
        childSessionKey: data.childSessionKey as SessionKey | undefined,
      }),
    ];
    // 重新读 record（spawn op 还没 apply，state 里可能没有 → 用 placeholder）
    const rec =
      state.subagents.get(subagentId) ??
      ({
        id: subagentId,
        parentRoundId: round.id,
        label: subagentId.slice(-8),
        status: "pending" as const,
        segments: [],
        startedAt: Date.now(),
        openBatchId: null,
        activeMessageIndex: 0,
        segmentSeqByKind: new Map<string, number>(),
      } satisfies SubagentRecord);

    if (data.phase === "message_start") {
      // 切换 batch 边界 + bump activeMessageIndex
      ops.push({ type: "subagent/message-start", subagentId, timestamp: Date.now() });
      return ops;
    }

    const subText = (data.text as string) || "";
    const subThinking = (data.thinking as string) || (data.reasoning as string) || "";
    if (subText) {
      ops.push(...translateSubagentNarrationText(rec, subText));
    }
    if (subThinking) {
      const cleaned = sanitizeNarrationText(stripReasoningFormat(subThinking));
      if (cleaned) {
        ops.push({
          type: "subagent/pending-thinking",
          subagentId,
          action: "set",
          text: cleaned,
        });
      }
    }
    return ops;
  }

  if (data.phase === "message_start") {
    const round = activeRound(state);
    if (!round) return [];
    const ops: ChatOp[] = [];
    if (round.activeMessageId) {
      ops.push({
        type: "message/end",
        roundId: round.id,
        messageId: round.activeMessageId,
        timestamp: Date.now(),
      });
    }
    const messageId = ChatId.message(round.id, round.nextMessageIndex);
    ops.push({ type: "message/start", roundId: round.id, messageId, timestamp: Date.now() });
    return ops;
  }

  // assistant 文本（无 phase）—— 与 chat:delta 同形（累积全量），v1.4 set 覆盖
  const text = (data.text as string) || "";
  if (!text) return [];
  const round = activeRound(state);
  if (!round) return [];
  // **严格化（同 translateChatDelta race 修法）**：activeMessageId null 时丢弃 stray text，
  // 不隐式创建 messageId 防 task_create text 跨 message 泄漏。
  if (!round.activeMessageId) return [];
  return [
    {
      type: "message/set-text",
      roundId: round.id,
      messageId: round.activeMessageId,
      fullText: text,
    },
  ];
}


export function translateAgentThinking(state: ChatState, data: Record<string, unknown>): ChatOp[] {
  const subagentId = data.subagentId as SubagentId | undefined;

  // ── Subagent 路径：写 pending buffer，等 tool start 触发 flush ─────
  if (subagentId) {
    const round = activeRound(state);
    if (!round) return [];
    const cleaned = sanitizeNarrationText(stripReasoningFormat((data.text as string) || ""));
    if (!cleaned) return [];
    const ops: ChatOp[] = [
      ...ensureSubagentSpawnOps(state, round.id, subagentId, {
        label: data.subagentLabel as string | undefined,
        childSessionKey: data.childSessionKey as SessionKey | undefined,
      }),
    ];
    ops.push({
      type: "subagent/pending-thinking",
      subagentId,
      action: "set",
      text: cleaned,
    });
    return ops;
  }

  // plan v1.5 §20.14 实施备忘：raw text 必须先 stripReasoningFormat 去 `Reasoning:` wrapper
  // 和 `_italic_` 标记，否则浮动 closing `_` 让 mergeFullText prefix 比较失败，rule 5 误判独立
  // block → 反复 append → 指数堆叠。
  const text = stripReasoningFormat((data.text as string) || "");
  if (!text) return [];
  const round = activeRound(state);
  if (!round) return [];
  // **严格化（同 translateChatDelta race 修法）**：activeMessageId null 时丢弃 stray thinking
  if (!round.activeMessageId) return [];
  const messageId = round.activeMessageId;
  const ops: ChatOp[] = [];
  ops.push({ type: "message/set-thinking", roundId: round.id, messageId, fullText: text });
  return ops;
}
