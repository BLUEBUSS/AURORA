// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * Chat refactor §8 主 reducer。
 *
 * 公开 API：
 *   - chatReducer(state, op): ChatState
 *   - applyOps(state, ops): ChatState
 *   - classify(round, pending, blockKind): Classification
 *   - phaseOfRound(round): Phase
 *
 * 子 reducer 的实现拆到 chat.reducer.parts.ts；本文件只做主 switch
 * 与 round/message 两条核心生命周期 + 分类逻辑（refactor-plan §8.2/§8.4）。
 *
 * 不变性：
 *   P2 幂等 — round/start、message/start、subagent/spawn、tool/start 重复 dispatch 短路
 *   P3 派生量零存储 — phase 由 phaseOfRound 计算，不进 state
 *   P4 纯函数 — 任何子 reducer 不调用副作用
 */

import type { NarrationSegment, ToolBatchSegment } from "../contracts/cards";
import { ChatId } from "./chat.id";
import { type ChatOp, assertNever } from "./chat.ops";
import {
  freezeContribution,
  getRound,
  makePending,
  nextSegmentSeq,
  reduceContributionRewrite,
  reduceSegmentAddPhaseMarker,
  reduceSegmentAppendNarration,
  reduceSegmentCloseBatch,
  reduceSubagentAppendSegment,
  reduceSubagentLifecycleEnd,
  reduceSubagentMessageStart,
  reduceSubagentPendingThinking,
  reduceSubagentResetState,
  reduceSubagentSpawn,
  reduceSubagentUpdateStatus,
  reduceTaskAddPhases,
  reduceTaskCheckpoint,
  reduceTaskSetPlan,
  reduceTaskUpdatePhase,
  reduceToolProvenancePatch,
  reduceToolResult,
  reduceToolStart,
  STRUCTURAL_TOOL_NAMES,
  withRound,
  withSegmentSeqIncremented,
} from "./chat.reducer.parts";
import { reduceTaskCompleteAll } from "./chat.task-reducer";
import {
  type BlockKind,
  type ChatState,
  type Classification,
  type MessageContribution,
  type PendingMessage,
  type Phase,
  type Round,
  isPhaseStep,
} from "./chat.types";
import type { TaskPlan } from "../contracts/protocol";

// ── Phase 派生（refactor-plan §8.3）─────────────────────────────────────────

function extractPhaseSteps(plan: TaskPlan) {
  const fromGroups = (plan.groups ?? []).flatMap((g) => g.steps);
  return fromGroups.filter(isPhaseStep);
}

export function phaseOfRound(round: Round): Phase {
  if (!round.task) return "pre-plan";
  const steps = extractPhaseSteps(round.task);
  if (steps.length === 0) return "execution";
  const allTerminal = steps.every(
    (p) => p.status === "done" || p.status === "failed" || p.status === "skipped",
  );
  return allTerminal ? "report" : "execution";
}

// ── 分类器（refactor-plan §8.2 α 严格版）────────────────────────────────────

export function classify(
  _round: Round,
  pending: Pick<PendingMessage, "toolCallIds" | "toolNamesSeen" | "phaseAtStart">,
  blockKind: BlockKind,
): Classification {
  // v1.1 §3.4 / §20.10: classify 用 message_start 时刻 snapshot 的 phaseAtStart，
  // 不用 message_end 派生的当前 phase。message 内 phase 翻转
  // （task_update.complete_phase(LAST)）不应改变本 message 的分类。
  const phase = pending.phaseAtStart;

  if (phase === "pre-plan") {
    if (blockKind === "thinking") return "preplan-thinking";
    // refactor-plan §3.2 v1.2: pre-plan 阶段所有 tool（read / web_search / task_create 等）
    // 都是为准备 plan 服务的辅助动作，message text 一律是规划准备话术，归 preplan-thinking。
    // 仅完全不含 tool 的 text-only message 归 preplan-content（简单对话场景）。
    if (pending.toolCallIds.length > 0) return "preplan-thinking";
    return "preplan-content";
  }
  if (phase === "report") {
    return blockKind === "thinking" ? "report-thinking" : "report-conclusion";
  }
  // 执行阶段（plan §3.2 字面规则恢复，2026-05-20）：
  // - thinking 一律 discarded
  // - text + no tool → left-conclusion（进左栏 conclusion 卡）
  // - text + has tool → right-narration（右栏过程话术）
  //
  // 恢复"text + no tool → left-conclusion"规则的依据：finclaw agent loop 把
  //   "assistant message 无 toolCall" 当作稳定终止信号——execute 阶段 model 输出
  //   无 tool 的 text 必然是"给用户看的最终输出"，不是中段过渡话。两类典型场景：
  //   1. Model 跑完几个 phase 后自己判断够了，直接出结论（不发 task_update.complete_phase）
  //   2. 复杂任务中需要跟用户做确认，输出询问/澄清话术等用户回复
  //   两种 case message 内容都属于"结论位"语义，跟过程话术（必带 tool_use）结构上区分得开，
  //   归 left-conclusion 比 right-narration 更贴近用户体验。
  //
  // v1.8 移除该规则的动机（incomplete history payload 让 conclusion 错位）已被
  //   场景 1 的真实需求覆盖：model 自判够了的输出确实应进 conclusion。abort 中断
  //   的 partial message 仅在历史会话刷新场景出现，影响面小且用户可感知中断状态。
  if (blockKind === "thinking") return "discarded";
  if (pending.toolCallIds.length === 0) return "left-conclusion";
  return "right-narration";
}

// ── Round lifecycle ─────────────────────────────────────────────────────

function reduceRoundStart(
  state: ChatState,
  op: Extract<ChatOp, { type: "round/start" }>,
): ChatState {
  if (state.roundsById.has(op.roundId)) return state;

  const round: Round = {
    id: op.roundId,
    index: op.roundIndex,
    userMessage: op.userMessage,
    sessionKey: op.sessionKey,
    status: "streaming",
    startedAt: op.timestamp,
    pending: new Map(),
    contributions: new Map(),
    segments: [],
    silencedAfterCheckpoint: false,
    nextMessageIndex: 0,
    activeMessageId: null,
    segmentSeqByKind: new Map(),
  };

  const rounds = [...state.rounds, round];
  const roundsById = new Map(state.roundsById);
  roundsById.set(round.id, rounds.length - 1);

  return {
    ...state,
    rounds,
    roundsById,
    activeRoundId: round.id,
    activeMessageId: null,
    currentSessionKey: op.sessionKey,
  };
}

function reduceRoundComplete(
  state: ChatState,
  op: Extract<ChatOp, { type: "round/complete" }>,
): ChatState {
  return withRound(state, op.roundId, (r) => {
    if (r.status !== "streaming") return r;
    return {
      ...r,
      status: op.status,
      completedAt: op.timestamp,
      failureReason: op.reason,
      activeMessageId: null,
    };
  });
}

function reduceCheckpointSilence(
  state: ChatState,
  op: Extract<ChatOp, { type: "round/checkpoint-silence" }>,
): ChatState {
  // 静音状态由 Round.silencedAfterCheckpoint 单独承载，避免 top-level 冗余 Set。
  return withRound(state, op.roundId, (r) => ({
    ...r,
    silencedAfterCheckpoint: true,
  }));
}

// ── Message lifecycle ───────────────────────────────────────────────────

function reduceMessageStart(
  state: ChatState,
  op: Extract<ChatOp, { type: "message/start" }>,
): ChatState {
  const round = getRound(state, op.roundId);
  if (!round) return state;
  if (round.pending.has(op.messageId)) return state;

  const pending = new Map(round.pending);
  // v1.1 §3.4: snapshot phase at message_start——message 内 phase 翻转不影响本 message 分类
  const phaseAtStart = phaseOfRound(round);
  pending.set(op.messageId, makePending(op.messageId, op.timestamp, phaseAtStart));
  const parsed = ChatId.parseMessage(op.messageId);
  const incomingIdx = parsed?.messageIndex ?? round.nextMessageIndex;

  const updated = withRound(state, op.roundId, (r) => ({
    ...r,
    pending,
    activeMessageId: op.messageId,
    nextMessageIndex: Math.max(r.nextMessageIndex, incomingIdx + 1),
  }));

  return { ...updated, activeMessageId: op.messageId };
}

function reduceMessageEnd(
  state: ChatState,
  op: Extract<ChatOp, { type: "message/end" }>,
): ChatState {
  const round = getRound(state, op.roundId);
  if (!round) return state;
  const pending = round.pending.get(op.messageId);
  if (!pending) return state;

  const thinkingCls = pending.thinkingText.length > 0 ? classify(round, pending, "thinking") : null;
  const textCls = pending.contentText.length > 0 ? classify(round, pending, "text") : null;

  const newContribs = new Map(round.contributions);

  if (thinkingCls && textCls && thinkingCls !== textCls) {
    newContribs.set(
      `${op.messageId}:thinking`,
      freezeContribution({
        messageId: op.messageId,
        finalizedAt: op.timestamp,
        contentText: "",
        thinkingText: pending.thinkingText,
        toolCallIds: pending.toolCallIds,
        classification: thinkingCls,
      }),
    );
    newContribs.set(
      `${op.messageId}:text`,
      freezeContribution({
        messageId: op.messageId,
        finalizedAt: op.timestamp,
        contentText: pending.contentText,
        thinkingText: "",
        toolCallIds: pending.toolCallIds,
        classification: textCls,
      }),
    );
  } else if (thinkingCls || textCls) {
    const cls = (textCls ?? thinkingCls) as Classification;
    newContribs.set(
      op.messageId,
      freezeContribution({
        messageId: op.messageId,
        finalizedAt: op.timestamp,
        contentText: pending.contentText,
        thinkingText: pending.thinkingText,
        toolCallIds: pending.toolCallIds,
        classification: cls,
      } satisfies MessageContribution),
    );
  }
  // else: empty message → discarded

  // textCls === right-narration → 派生 / 更新 narration segment
  let segments = round.segments;
  let segmentSeqByKind = round.segmentSeqByKind;
  if (textCls === "right-narration") {
    const seq = nextSegmentSeq(round, "narration");
    const segId = ChatId.segment(round.id, op.messageId, "narration", seq);
    const existsIdx = segments.findIndex((s) => s.id === segId);
    const narration: NarrationSegment = {
      kind: "narration",
      id: segId,
      text: pending.contentText,
      startedAt: pending.startedAt,
      context: { phaseIndex: undefined, subagentId: undefined },
    };
    if (existsIdx >= 0) {
      segments = segments.slice();
      segments[existsIdx] = narration;
    } else {
      segments = [...segments, narration];
      segmentSeqByKind = withSegmentSeqIncremented(round, "narration");
    }
  } else if (
    // 主 agent execute 期 thinking-fallback：thinking 非空 + text 空 + 含 tool（含 structural）
    // → 派生 narration with isThinkingFallback=true。Mirror 老 segment-builder.ts 的
    // recordThinkingFullText + flushPendingThinking 兜底机制；plan §20.2 主 agent execute thinking
    // 完全 discard 是设计 ideal，但实测老路径主 agent execute 期 thinking-only message
    // 把 thinking 显示在右栏作 trace 信号——用户期望此行为，2026-05 修订对齐。
    thinkingCls === "discarded" &&
    !textCls &&
    pending.thinkingText.length > 0 &&
    pending.toolCallIds.length > 0
  ) {
    const seq = nextSegmentSeq(round, "narration");
    const segId = ChatId.segment(round.id, op.messageId, "narration", seq);
    const fallback: NarrationSegment = {
      kind: "narration",
      id: segId,
      text: pending.thinkingText,
      startedAt: pending.startedAt,
      isThinkingFallback: true,
      context: { phaseIndex: undefined, subagentId: undefined },
    };
    segments = [...segments, fallback];
    segmentSeqByKind = withSegmentSeqIncremented(round, "narration");
  }

  // S4.4-T 子步 2: message 含**真实数据 tool**（非 STRUCTURAL_TOOL_NAMES）→ 派生 tool-batch 段。
  // 跟老路径行为对齐：含 structural-only tool（task_create / task_update / sessions_spawn / subagents /
  // task_checkpoint）的 message 不派生 tool-batch——这些有专门的 phase-marker / subagent-card 段表示。
  const hasRealDataTool = (() => {
    if (pending.toolCallIds.length === 0) return false;
    for (const name of pending.toolNamesSeen) {
      if (!STRUCTURAL_TOOL_NAMES.has(name)) return true;
    }
    return false;
  })();
  if (hasRealDataTool) {
    const seq = nextSegmentSeq(round, "tool-batch");
    const segId = ChatId.segment(round.id, op.messageId, "tool-batch", seq);
    if (!segments.some((s) => s.id === segId)) {
      const batch: ToolBatchSegment = {
        kind: "tool-batch",
        id: segId,
        toolCallIds: [...pending.toolCallIds],
        startedAt: pending.startedAt,
        context: { phaseIndex: undefined, subagentId: undefined },
      };
      segments = [...segments, batch];
      const incremented = new Map(segmentSeqByKind);
      const currentSeq = incremented.get("tool-batch") ?? 0;
      incremented.set("tool-batch", currentSeq + 1);
      segmentSeqByKind = incremented;
    }
  }

  const newPending = new Map(round.pending);
  newPending.delete(op.messageId);
  const wasActive = round.activeMessageId === op.messageId;

  const updated = withRound(state, op.roundId, (r) => ({
    ...r,
    pending: newPending,
    contributions: newContribs,
    segments,
    segmentSeqByKind,
    activeMessageId: wasActive ? null : r.activeMessageId,
  }));

  return wasActive ? { ...updated, activeMessageId: null } : updated;
}

// ── Message 内容写入（v1.5 §20.14 prefix-aware merge）─────────────────────

/**
 * Backend 在同一 pending message 上可能推出多种 fullText 关系，merge 策略：
 *   1. 整段 cumulative growth (next.startsWith(prev))      → 取 next
 *   2. 整段同段 buffer reset 重发 (prev.startsWith(next))  → 短路保留 prev
 *   3. 对最后一个 block 的 cumulative growth               → 更新 lastBlock（不再 append）
 *   4. 对最后一个 block 的同段 reset 重发                  → 短路
 *   5. 真新独立 block（互不包含）                          → append `\n\n` 分隔
 *
 * 实证 (refactor-plan §20.14): anthropic 协议每条 assistant message 含 1 个独立 thinking block。
 * 当 message_start 边界缺/race 时，多条 thinking 落同一 pending：第二段流式从 "想法 B"
 * 累积到 "想法 B 完整" 时必须更新 lastBlock（规则 3），否则会重复 "想法 B"。
 */
const MERGE_SEP = "\n\n";

function mergeFullText(prev: string, next: string): string {
  if (prev.length === 0) return next;
  if (next.length === 0) return prev;
  if (next.startsWith(prev)) return next; // 1. 整段 cumulative growth
  if (prev.startsWith(next)) return prev; // 2. 整段同段 buffer reset 重发，幂等

  const lastSepIdx = prev.lastIndexOf(MERGE_SEP);
  if (lastSepIdx >= 0) {
    const head = prev.slice(0, lastSepIdx + MERGE_SEP.length);
    const lastBlock = prev.slice(lastSepIdx + MERGE_SEP.length);
    if (next.startsWith(lastBlock)) return head + next; // 3. lastBlock cumulative growth
    if (lastBlock.startsWith(next)) return prev; // 4. lastBlock 同段 reset 重发
  }

  return `${prev}${MERGE_SEP}${next}`; // 5. 真新独立 block
}

/** 跨 message dedup：op.fullText === 同 round 任一 finalized contribution 同字段 → 短路丢弃。
 *
 *  **修法 N（2026-05）**：backend 在 message_start 边界之后**仍 force-flush 上一 message 的
 *  chat:delta**（fullText 是上一 message 累积内容）→ translator 无从识别（activeMessageId 已切
 *  下一 message，C 修法不触发）→ set-text 写到下一 message pending → classify(execute + text +
 *  tool) 错归 right-narration → 右栏 narration 重复显示规划话术（user 实测 c3e05245 dump 100%
 *  实证：msg-3/4 contribution.contentText === msg-2 contribution.contentText，byte-equal）。
 *
 *  修法基于**结构 exact-equal 比对**，不是 keyword 兜底；跟 v1.4 §20.13 / v1.5 §20.14 mergeFullText
 *  "buffer reset 重发幂等"（rule 2 / 4）同思路扩展——单 message 内重发短路 → 跨 message 重发短路。
 *  backend 协议契约：chat:delta 永远应该是当前 message 累积，不是上一 message 重发。 */
function isCrossMessageRedundant(
  contributions: ReadonlyMap<string, MessageContribution>,
  currentMessageId: string,
  fullText: string,
  field: "contentText" | "thinkingText",
): boolean {
  if (fullText.length === 0) return false;
  // trim 比对吸收 trailing whitespace 差异：实测 db93b797 dump，msg-2 contribution.contentText
  // 末尾因 mergeFullText rule 5 拼了 "\n\n"，而 backend 边界后 force-flush 推到 msg-3 的
  // chat:delta fullText 没有这个尾巴 → byte-equal 比对失败 → dedup 漏检 → msg-3 pending 错写
  // msg-2 plan 文本 → execute 阶段 classify 走 right-narration → 派生 <plan> narration 错位。
  const trimmedFullText = fullText.trim();
  if (trimmedFullText.length === 0) return false;
  for (const c of contributions.values()) {
    if (c.messageId === currentMessageId) continue;
    if (c[field].trim() === trimmedFullText) return true;
  }
  return false;
}

function reduceSetText(
  state: ChatState,
  op: Extract<ChatOp, { type: "message/set-text" }>,
): ChatState {
  return withRound(state, op.roundId, (r) => {
    const pending = r.pending.get(op.messageId);
    if (!pending || r.silencedAfterCheckpoint) return r;
    // 跨 message dedup（修 force-flush 越界推上一 message chat:delta）
    if (isCrossMessageRedundant(r.contributions, op.messageId, op.fullText, "contentText")) {
      return r;
    }
    const merged = mergeFullText(pending.contentText, op.fullText);
    if (merged === pending.contentText) return r; // 幂等短路
    const next: PendingMessage = { ...pending, contentText: merged };
    const newPending = new Map(r.pending);
    newPending.set(op.messageId, next);
    return { ...r, pending: newPending };
  });
}

function reduceSetThinking(
  state: ChatState,
  op: Extract<ChatOp, { type: "message/set-thinking" }>,
): ChatState {
  return withRound(state, op.roundId, (r) => {
    const pending = r.pending.get(op.messageId);
    if (!pending || r.silencedAfterCheckpoint) return r;
    // 跨 message dedup（thinking 同款防御——backend force-flush 可能同时推 thinking event）
    if (isCrossMessageRedundant(r.contributions, op.messageId, op.fullText, "thinkingText")) {
      return r;
    }
    const merged = mergeFullText(pending.thinkingText, op.fullText);
    if (merged === pending.thinkingText) return r; // 幂等短路
    const next: PendingMessage = { ...pending, thinkingText: merged };
    const newPending = new Map(r.pending);
    newPending.set(op.messageId, next);
    return { ...r, pending: newPending };
  });
}

function reduceRecordTool(
  state: ChatState,
  op: Extract<ChatOp, { type: "message/record-tool" }>,
): ChatState {
  return withRound(state, op.roundId, (r) => {
    const pending = r.pending.get(op.messageId);
    if (!pending) return r;
    if (pending.toolCallIds.includes(op.toolCallId)) return r;
    const toolNamesSeen = new Set(pending.toolNamesSeen);
    toolNamesSeen.add(op.toolName);
    const isStructuralLocal = op.isStructural || STRUCTURAL_TOOL_NAMES.has(op.toolName);
    const next: PendingMessage = {
      ...pending,
      toolCallIds: [...pending.toolCallIds, op.toolCallId],
      toolNamesSeen,
      hasStructuralTool: pending.hasStructuralTool || isStructuralLocal,
    };
    const newPending = new Map(r.pending);
    newPending.set(op.messageId, next);
    return { ...r, pending: newPending };
  });
}

// ── 主 reducer ───────────────────────────────────────────────────────────

export function chatReducer(state: ChatState, op: ChatOp): ChatState {
  switch (op.type) {
    case "round/start":
      return reduceRoundStart(state, op);
    case "round/complete":
      return reduceRoundComplete(state, op);
    case "round/checkpoint-silence":
      return reduceCheckpointSilence(state, op);
    case "message/start":
      return reduceMessageStart(state, op);
    case "message/end":
      return reduceMessageEnd(state, op);
    case "message/set-text":
      return reduceSetText(state, op);
    case "message/set-thinking":
      return reduceSetThinking(state, op);
    case "message/record-tool":
      return reduceRecordTool(state, op);
    case "task/set-plan":
      return reduceTaskSetPlan(state, op);
    case "task/update-phase":
      return reduceTaskUpdatePhase(state, op);
    case "task/complete-all":
      return reduceTaskCompleteAll(state, op);
    case "task/add-phases":
      return reduceTaskAddPhases(state, op);
    case "task/checkpoint":
      return reduceTaskCheckpoint(state, op);
    case "subagent/spawn":
      return reduceSubagentSpawn(state, op);
    case "subagent/append-segment":
      return reduceSubagentAppendSegment(state, op);
    case "subagent/update-status":
      return reduceSubagentUpdateStatus(state, op);
    case "subagent/lifecycle-end":
      return reduceSubagentLifecycleEnd(state, op);
    case "subagent/message-start":
      return reduceSubagentMessageStart(state, op);
    case "subagent/reset-state":
      return reduceSubagentResetState(state, op);
    case "subagent/pending-thinking":
      return reduceSubagentPendingThinking(state, op);
    case "segment/append-narration":
      return reduceSegmentAppendNarration(state, op);
    case "segment/close-batch":
      return reduceSegmentCloseBatch(state, op);
    case "segment/add-phase-marker":
      return reduceSegmentAddPhaseMarker(state, op);
    case "tool/start":
      return reduceToolStart(state, op);
    case "tool/result":
      return reduceToolResult(state, op);
    case "tool/provenance-patch":
      return reduceToolProvenancePatch(state, op);
    case "contribution/rewrite-text":
      return reduceContributionRewrite(state, op);
    default:
      return assertNever(op);
  }
}

/** 批量 apply：等价 ops.reduce(chatReducer, state) 但避免中间 GC。 */
export function applyOps(state: ChatState, ops: readonly ChatOp[]): ChatState {
  let s = state;
  for (const op of ops) s = chatReducer(s, op);
  return s;
}
