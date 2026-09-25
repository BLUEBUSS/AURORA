// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/** Standalone extraction of the source translator; see docs/chat-core-migration.md. */
import type { NarrationSegment, PhaseMarkerSegment, ToolBatchSegment } from "../contracts/cards";
import { sanitizeNarrationText, stripReasoningFormat } from "./_text-normalize";
import type { ChatOp } from "../model/chat.ops";
import type { RoundId, SubagentId, ToolCallId } from "../model/chat.types";
import { HistoryMessage, extractTextContent, extractThinkingText, extractToolResultText, extractToolUses } from "./history.message";


// ── Subagent transcript history（lazy-load 用，S4.5-T 新增） ─────────────
//
// 入口：从 child sessionKey 拉到 subagent 自己的 transcript（assistant text/thinking/tool_use/tool_result）。
// 输出 ops 用 deterministic segmentId（mirror live translator 公式 `${subId}:${msgIdx}:${kind}:${seq}`），
// reducer 按 id merge → 跟 live 已写入的段自然 patch 而不重复（修 Bug 1a 整桶替换 race 的 root path）。
//
// 行为对齐老 buildSegmentsForRound（services/history-segments.ts）：
//   - assistant content text → narration 段
//   - assistant content thinking + 同 message 无 text → thinking-fallback narration（pending-thinking flush）
//   - tool_use → tool-batch（同 message 多 tool 合并）
//   - sessions_spawn / 主 agent 用 phase-marker 在子 agent 抽屉里：仍是 phase-marker
//
// 当前 S4.5-T 不改 SubagentDrillDown 渲染层，本 helper 是 S4.final lazy-load 切换的 groundwork。
// 单测覆盖语义；dev manual 跑流式（不点抽屉）时不被消费。

export function historyToSubagentOps(
  messages: HistoryMessage[],
  subagentId: SubagentId,
  parentRoundId: RoundId,
): ChatOp[] {
  const ops: ChatOp[] = [];
  // 兜底 spawn —— 调用方可能事先没在主 round 里见过 sessions_spawn
  ops.push({
    type: "subagent/spawn",
    parentRoundId,
    subagentId,
    label: subagentId.slice(-8),
    timestamp: 0,
  });

  // 跟 live 路径 segmentId 派生对齐：spawn 初始化 activeMessageIndex=0，
  // 第一个 backend assistant message_start 会 bump 到 1。history 路径 mirror 这条不变量——
  // 每条 assistant message 都视作一次 message-start，即首条也 bump。
  let activeMessageIndex = 0;
  // per-message segment seq counters（跟 live + reducer 同步，每 message-start 重置）
  let narrationSeq = 0;
  let toolBatchSeq = 0;
  let phaseMarkerSeq = 0;
  let pendingThinking: string | undefined;
  let messageHasNarration = false;
  let openBatchId: string | null = null;

  const flushPendingAsThinkingFallback = (ts: number) => {
    if (!pendingThinking || messageHasNarration) {
      pendingThinking = undefined;
      return;
    }
    const segmentId = `${subagentId}:${activeMessageIndex}:narration:${narrationSeq}`;
    const seg: NarrationSegment = {
      kind: "narration",
      id: segmentId,
      text: pendingThinking,
      startedAt: ts,
      isThinkingFallback: true,
      context: { phaseIndex: undefined, subagentId },
    };
    ops.push({ type: "subagent/append-segment", subagentId, segment: seg });
    narrationSeq++;
    openBatchId = null;
    pendingThinking = undefined;
  };

  const startNewMessage = (ts: number) => {
    activeMessageIndex++;
    narrationSeq = 0;
    toolBatchSeq = 0;
    phaseMarkerSeq = 0;
    messageHasNarration = false;
    openBatchId = null;
    // 同步 emit subagent/message-start op，让 reducer 也 ++activeMessageIndex
    //   + 重置 segmentSeqByKind。否则 reducer 内 segmentSeqByKind 跨 message 累积，
    //   后续 live event 流式 narration 派生 segmentId 时读 reducer 的 seqMap（累积值）
    //   → segmentId 跟 history 翻译的 segmentId 不在同一个 (messageIndex, seq) 命名空间
    //   → patch 路径 startsWith 命中后用错误 lastSeg.id → 反复"新段"→ 同一段报告被
    //   渲染成 N 个独立 narration（实测 dump bug：报告重复 3 次）。
    ops.push({ type: "subagent/message-start", subagentId, timestamp: ts });
    // pendingThinking 保留到 tool-start 触发 flush 或下一条 text 到达 clear
  };

  for (const msg of messages) {
    const role = (msg.role ?? "").toLowerCase();
    const ts = msg.timestamp ?? 0;

    if (role === "assistant") {
      // 每条 assistant message 都触发 message-start 边界（mirror live 路径 backend
      // 推 phase=message_start 行为）。首条也 bump，msgIdx 从 1 起步与 live 一致。
      startNewMessage(ts);

      const text = sanitizeNarrationText(stripReasoningFormat(extractTextContent(msg)));
      const thinking = sanitizeNarrationText(extractThinkingText(msg));

      if (text) {
        // text 到达 → 清 pending（保证 flush 时 pending 真的是无 text）
        pendingThinking = undefined;
        messageHasNarration = true;
        const segmentId = `${subagentId}:${activeMessageIndex}:narration:${narrationSeq}`;
        const seg: NarrationSegment = {
          kind: "narration",
          id: segmentId,
          text,
          startedAt: ts,
          context: { phaseIndex: undefined, subagentId },
        };
        ops.push({ type: "subagent/append-segment", subagentId, segment: seg });
        narrationSeq++;
        openBatchId = null;
      } else if (thinking) {
        pendingThinking = thinking;
      }

      const toolUses = extractToolUses(msg);
      for (const tu of toolUses) {
        // tool start 触发 flush（无 text 时把 thinking 转成 fallback narration）
        flushPendingAsThinkingFallback(ts);

        // task_create / task_update：在 subagent 桶里写 phase-marker
        if (tu.name === "task_create") {
          const phasesArr = tu.args?.phases as unknown;
          const planPhaseCount = Array.isArray(phasesArr) ? phasesArr.length : undefined;
          const segmentId = `${subagentId}:${activeMessageIndex}:phase-marker:${phaseMarkerSeq}`;
          const marker: PhaseMarkerSegment = {
            kind: "phase-marker",
            id: segmentId,
            action: "create",
            planPhaseCount,
            toolCallId: tu.id,
            startedAt: ts,
            context: { phaseIndex: undefined, subagentId },
          };
          ops.push({ type: "subagent/append-segment", subagentId, segment: marker });
          phaseMarkerSeq++;
          openBatchId = null;
          continue;
        }
        if (tu.name === "task_update" && tu.args) {
          const action = tu.args.action as string | undefined;
          if (action === "complete_phase" || action === "fail_phase" || action === "skip_phase") {
            const markerAction =
              action === "complete_phase"
                ? ("complete" as const)
                : action === "fail_phase"
                  ? ("fail" as const)
                  : ("skip" as const);
            const phaseIndexArg = tu.args.phase_index as number | undefined;
            const summary =
              (tu.args.summary as string | undefined) ?? (tu.args.reason as string | undefined);
            const segmentId = `${subagentId}:${activeMessageIndex}:phase-marker:${phaseMarkerSeq}`;
            const marker: PhaseMarkerSegment = {
              kind: "phase-marker",
              id: segmentId,
              action: markerAction,
              phaseIndex: phaseIndexArg,
              summaries: summary ? [summary] : undefined,
              toolCallId: tu.id,
              startedAt: ts,
              context: { phaseIndex: undefined, subagentId },
            };
            ops.push({ type: "subagent/append-segment", subagentId, segment: marker });
            phaseMarkerSeq++;
            openBatchId = null;
          } else if (action === "add_phases") {
            const newPhases = tu.args.new_phases as Array<{ description?: string }> | undefined;
            const addedDescriptions = Array.isArray(newPhases)
              ? newPhases
                  .map((p) => (typeof p?.description === "string" ? p.description : ""))
                  .filter(Boolean)
              : [];
            const segmentId = `${subagentId}:${activeMessageIndex}:phase-marker:${phaseMarkerSeq}`;
            const marker: PhaseMarkerSegment = {
              kind: "phase-marker",
              id: segmentId,
              action: "add",
              addedPhases: addedDescriptions,
              toolCallId: tu.id,
              startedAt: ts,
              context: { phaseIndex: undefined, subagentId },
            };
            ops.push({ type: "subagent/append-segment", subagentId, segment: marker });
            phaseMarkerSeq++;
            openBatchId = null;
          }
          continue;
        }

        // 普通 tool → 进 tool-batch（同 message 内合并）
        if (openBatchId) {
          // 找出当前 batch，patch toolCallIds
          // history 翻译是线性的——当前 openBatchId 对应的 segment 一定是 ops 队列中最后一个 batch
          // 找到它并 patch
          for (let i = ops.length - 1; i >= 0; i--) {
            const op = ops[i];
            if (
              op &&
              op.type === "subagent/append-segment" &&
              op.subagentId === subagentId &&
              op.segment.kind === "tool-batch" &&
              op.segment.id === openBatchId
            ) {
              const batch = op.segment as ToolBatchSegment;
              if (!batch.toolCallIds.includes(tu.id)) {
                const patched: ToolBatchSegment = {
                  ...batch,
                  toolCallIds: [...batch.toolCallIds, tu.id],
                };
                ops[i] = {
                  type: "subagent/append-segment",
                  subagentId,
                  segment: patched,
                };
              }
              break;
            }
          }
        } else {
          const segmentId = `${subagentId}:${activeMessageIndex}:tool-batch:${toolBatchSeq}`;
          const newBatch: ToolBatchSegment = {
            kind: "tool-batch",
            id: segmentId,
            toolCallIds: [tu.id],
            startedAt: ts,
            context: { phaseIndex: undefined, subagentId },
          };
          ops.push({ type: "subagent/append-segment", subagentId, segment: newBatch });
          openBatchId = segmentId;
          toolBatchSeq++;
        }

        // 写 toolCalls map（drilldown 通过 callId 反查 ToolCallData）
        ops.push({
          type: "tool/start",
          toolCallId: tu.id satisfies ToolCallId,
          toolName: tu.name,
          args: tu.args,
          subagentId,
        });
      }
      continue;
    }

    if (role === "tool" || role === "toolresult") {
      const callId = msg.tool_call_id ?? msg.toolCallId;
      if (!callId) continue;
      const result = extractToolResultText(msg);
      ops.push({
        type: "tool/result",
        toolCallId: callId as ToolCallId,
        status: "success",
        result,
      });
      continue;
    }
    // 其他 role 略过
  }

  return ops;
}
