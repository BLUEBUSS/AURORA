// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/** Standalone extraction of the source translator; see docs/chat-core-migration.md. */
import type { NarrationSegment, PhaseMarkerSegment, ToolBatchSegment } from "../contracts/cards";
import { sanitizeNarrationText, stripReasoningFormat } from "./_text-normalize";
import { isMergeablePhaseAction, mergePhaseIndexValues } from "../model/chat.merge-helpers";
import type { ChatOp } from "../model/chat.ops";
import type { ChatState, RoundId, SessionKey, SubagentId, SubagentRecord } from "../model/chat.types";



// ── Subagent 内部翻译辅助（S4.5-T mirror 老 segment-builder 行为）───────

/** 派生稳定 segmentId：`${subagentId}:${activeMessageIndex}:${kind}:${seq}`。
 *  live / history / lazy load 三处用同一公式，reducer 按 id merge 自然去重（修 Bug 1a）。 */
export function deriveSubagentSegmentId(rec: SubagentRecord, kind: string): string {
  const seq = rec.segmentSeqByKind.get(kind) ?? 0;
  return `${rec.id}:${rec.activeMessageIndex}:${kind}:${seq}`;
}


/** 全 segments 范围内最近一条 narration（mirror 老 mostRecentNarration 短路）。 */
export function mostRecentNarration(rec: SubagentRecord): NarrationSegment | undefined {
  for (let i = rec.segments.length - 1; i >= 0; i--) {
    const seg = rec.segments[i];
    if (seg && seg.kind === "narration") return seg;
  }
  return undefined;
}


/** Subagent 内部 phase cursor：从该 subagent 已有 phase-marker 推导。
 *  mirror 老 segment-builder.ts:462 getSubagentPhaseIndex —— 让新 narration / tool-batch 段
 *  携带的 context.phaseIndex 跟老路径一致。 */
export function getSubagentPhaseCursor(rec: SubagentRecord): number | undefined {
  let totalPhases = 0;
  const settled = new Set<number>();
  for (const seg of rec.segments) {
    if (seg.kind !== "phase-marker") continue;
    if (seg.action === "create" && typeof seg.planPhaseCount === "number") {
      totalPhases = Math.max(totalPhases, seg.planPhaseCount);
    }
    if (seg.action === "add" && seg.addedPhases) totalPhases += seg.addedPhases.length;
    if (seg.action === "complete" || seg.action === "fail" || seg.action === "skip") {
      const idx = seg.phaseIndex;
      if (Array.isArray(idx)) idx.forEach((i) => settled.add(i));
      else if (typeof idx === "number") settled.add(idx);
    }
  }
  if (totalPhases === 0) return undefined;
  for (let i = 0; i < totalPhases; i++) if (!settled.has(i)) return i;
  return totalPhases - 1;
}


/** 确保 SubagentRecord 存在；不存在 → emit spawn 兜底。
 *  Label 优先级：调用方传入（来自 broadcast payload 的 subagentLabel——backend 注册的真实
 *    sub-agent label，刷新后历史 chat.history 不含 toolResult 时这是仅有的中文 label 来源）
 *    > subId 末 8 位 fallback。
 *  spawn 是幂等的，translator 多次 emit 不重复。 */
export function ensureSubagentSpawnOps(
  state: ChatState,
  parentRoundId: RoundId,
  subagentId: SubagentId,
  opts?: { label?: string; childSessionKey?: SessionKey },
): ChatOp[] {
  if (state.subagents.has(subagentId)) return [];
  return [
    {
      type: "subagent/spawn",
      parentRoundId,
      subagentId,
      label: opts?.label ?? subagentId.slice(-8),
      childSessionKey: opts?.childSessionKey,
      timestamp: Date.now(),
    },
  ];
}


/** Subagent narration 写入（mirror 老 recordSubagentNarrationFullText 行为）：
 *   1. mostRecentNarration.text === cleaned → noop（重发去重）
 *   2. lastSeg 是 narration && cleaned.startsWith(lastSeg.text) → patch（同 segmentId 重写）
 *   3. 否则 → 新 narration 段（reducer 在 push 时 close openBatchId + bump seq） */
export function translateSubagentNarrationText(rec: SubagentRecord, rawText: string): ChatOp[] {
  const cleaned = sanitizeNarrationText(stripReasoningFormat(rawText));
  if (!cleaned) return [];

  const lastSeg = rec.segments[rec.segments.length - 1];
  const recent = mostRecentNarration(rec);
  if (recent && recent.text === cleaned) return []; // 1. 重发短路

  // 2. lastSeg 是 narration 且当前 fullText 以它开头 → patch
  if (lastSeg && lastSeg.kind === "narration" && cleaned.startsWith(lastSeg.text)) {
    const patched: NarrationSegment = { ...lastSeg, text: cleaned };
    return [{ type: "subagent/append-segment", subagentId: rec.id, segment: patched }];
  }

  // 3. 新段（与 isThinkingFallback 共享 narration kind 计数：seq 是 per-message）
  const segmentId = deriveSubagentSegmentId(rec, "narration");
  const seg: NarrationSegment = {
    kind: "narration",
    id: segmentId,
    text: cleaned,
    startedAt: Date.now(),
    context: { phaseIndex: getSubagentPhaseCursor(rec), subagentId: rec.id },
  };
  // text 到达即清 pendingThinking——保证 flush 触发 ⟺ 本 message 真的无 text
  return [
    { type: "subagent/append-segment", subagentId: rec.id, segment: seg },
    { type: "subagent/pending-thinking", subagentId: rec.id, action: "clear" },
  ];
}


/** Subagent tool start：先 flush pending thinking → 入 batch（patch openBatchId 或新建）。 */
export function translateSubagentToolStart(rec: SubagentRecord, toolCallId: string): ChatOp[] {
  const ops: ChatOp[] = [
    // 1. flush pending thinking（reducer 内部检测：pendingThinking 非空才派生 narration）
    {
      type: "subagent/pending-thinking",
      subagentId: rec.id,
      action: "flush",
      timestamp: Date.now(),
    },
  ];

  // 2. 决定 patch existing batch 还是新建
  const lastSeg = rec.segments[rec.segments.length - 1];
  if (
    rec.openBatchId &&
    lastSeg &&
    lastSeg.kind === "tool-batch" &&
    lastSeg.id === rec.openBatchId
  ) {
    if (!lastSeg.toolCallIds.includes(toolCallId)) {
      const patched: ToolBatchSegment = {
        ...lastSeg,
        toolCallIds: [...lastSeg.toolCallIds, toolCallId],
      };
      ops.push({ type: "subagent/append-segment", subagentId: rec.id, segment: patched });
    }
    return ops;
  }

  // 新 batch：注意 flush op 可能在 reducer 里 push 了 thinking-fallback narration，
  // 改变 segments 长度，但 segmentSeqByKind 的 tool-batch 计数没动 —— deriveSubagentSegmentId
  // 仍用 rec.segmentSeqByKind 当前值派生 id。reducer 在新 push 时再 bump。
  const segmentId = deriveSubagentSegmentId(rec, "tool-batch");
  const newBatch: ToolBatchSegment = {
    kind: "tool-batch",
    id: segmentId,
    toolCallIds: [toolCallId],
    startedAt: Date.now(),
    context: { phaseIndex: getSubagentPhaseCursor(rec), subagentId: rec.id },
  };
  ops.push({ type: "subagent/append-segment", subagentId: rec.id, segment: newBatch });
  return ops;
}


/** Subagent phase-marker 派发，含合并启发式：相邻 same-action complete/fail/skip 合并 phaseIndex / summaries。
 *  mirror 老 segment-builder.ts:601-650 recordSubagentPhaseMarker。 */
export function translateSubagentPhaseMarker(
  rec: SubagentRecord,
  payload: {
    action: PhaseMarkerSegment["action"];
    phaseIndex?: number;
    summary?: string;
    addedPhases?: string[];
    planPhaseCount?: number;
    toolCallId?: string;
  },
): ChatOp[] {
  const last = rec.segments[rec.segments.length - 1];
  if (
    isMergeablePhaseAction(payload.action) &&
    last &&
    last.kind === "phase-marker" &&
    last.action === payload.action &&
    payload.phaseIndex !== undefined
  ) {
    const newIndex = mergePhaseIndexValues(last.phaseIndex, payload.phaseIndex);
    const newSummaries = [...(last.summaries ?? [])];
    if (payload.summary) newSummaries.push(payload.summary);
    const patched: PhaseMarkerSegment = {
      ...last,
      phaseIndex: newIndex,
      summaries: newSummaries,
    };
    return [{ type: "subagent/append-segment", subagentId: rec.id, segment: patched }];
  }

  const segmentId = deriveSubagentSegmentId(rec, "phase-marker");
  const marker: PhaseMarkerSegment = {
    kind: "phase-marker",
    id: segmentId,
    action: payload.action,
    phaseIndex: payload.phaseIndex,
    summaries: payload.summary ? [payload.summary] : undefined,
    addedPhases: payload.addedPhases,
    planPhaseCount: payload.planPhaseCount,
    toolCallId: payload.toolCallId,
    startedAt: Date.now(),
    context: { phaseIndex: getSubagentPhaseCursor(rec), subagentId: rec.id },
  };
  return [{ type: "subagent/append-segment", subagentId: rec.id, segment: marker }];
}
