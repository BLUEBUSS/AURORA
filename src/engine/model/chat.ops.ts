// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * Chat refactor §7 Op 层。
 *
 * 所有 op 是可序列化的纯数据，每个 op 描述一次"业务事实"（P7）。
 * 组合规则：
 *   - 内容事件（chat:delta）→ append-* op，等值短路保证幂等
 *   - 边界事件（message_start / message_end）→ message/start, message/end
 *   - 结构事件（task_create / sessions_spawn / lifecycle）→ 对应专用 op
 *
 * 注意：narration / tool-batch segment 通常由 message/end op 在 reducer 内
 * 自动派生，**不直接 dispatch**；segment/* 三个 op 留给 history translator
 * 使用（history 已知 message 边界结构）。
 */

import type {
  PhaseMarkerSegment,
  Segment,
  SubagentCardSegment,
  ToolBatchSegment,
} from "../contracts/cards";
import type {
  MessageId,
  RoundId,
  RoundStatus,
  SessionKey,
  SubagentId,
  SubagentStatus,
  ToolCallId,
} from "./chat.types";
import type { ChatMessage, TaskPlan, TaskStep, ToolCallData } from "../contracts/protocol";

// ── 7.1 Round 生命周期 ────────────────────────────────────────────────────
export interface RoundStartOp {
  type: "round/start";
  roundId: RoundId;
  userMessage: ChatMessage;
  sessionKey: SessionKey;
  /** 显式 round index；translator 应通过 nextRoundIndexFor(state, sessionKey) 派生 */
  roundIndex: number;
  timestamp: number;
}

export interface RoundCompleteOp {
  type: "round/complete";
  roundId: RoundId;
  status: Exclude<RoundStatus, "streaming">;
  reason?: string;
  timestamp: number;
}

export interface RoundCheckpointSilenceOp {
  type: "round/checkpoint-silence";
  roundId: RoundId;
}

// ── 7.2 Message 生命周期 ─────────────────────────────────────────────────
export interface MessageStartOp {
  type: "message/start";
  roundId: RoundId;
  messageId: MessageId;
  timestamp: number;
}

export interface MessageEndOp {
  type: "message/end";
  roundId: RoundId;
  messageId: MessageId;
  timestamp: number;
}

// ── 7.3 Message 内容覆盖（v1.4 §7.2 set 语义）─────────────────────────────
// 跟 backend 协议对齐：backend 推 fullText（thinking/text 都是覆盖式累积），
// translator 直接 set，不做 delta 派生。set 幂等：相同 fullText 重复推不影响 state。
export interface MessageSetTextOp {
  type: "message/set-text";
  roundId: RoundId;
  messageId: MessageId;
  fullText: string;
}

export interface MessageSetThinkingOp {
  type: "message/set-thinking";
  roundId: RoundId;
  messageId: MessageId;
  fullText: string;
}

export interface MessageRecordToolOp {
  type: "message/record-tool";
  roundId: RoundId;
  messageId: MessageId;
  toolName: string;
  toolCallId: ToolCallId;
  /** task_create / task_update / sessions_spawn / subagents 等结构性 tool */
  isStructural: boolean;
}

// ── 7.4 Task 计划 ────────────────────────────────────────────────────────
export interface TaskSetPlanOp {
  type: "task/set-plan";
  roundId: RoundId;
  plan: TaskPlan;
}

export interface TaskUpdatePhaseOp {
  type: "task/update-phase";
  roundId: RoundId;
  phaseIndex: number;
  status: NonNullable<TaskStep["status"]> | "paused";
  result?: string;
}

/** 收敛明确完成意图下尚未逐阶段回报的计划状态。 */
export interface TaskCompleteAllOp {
  type: "task/complete-all";
  roundId: RoundId;
}

export interface TaskAddPhasesOp {
  type: "task/add-phases";
  roundId: RoundId;
  addedPhases: TaskStep[];
}

export interface TaskCheckpointOp {
  type: "task/checkpoint";
  roundId: RoundId;
  phaseIndex: number;
  data: { type: "confirm" | "suggest" | "warn"; message: string; options?: string[] };
}

// ── 7.5 Sub-agent ────────────────────────────────────────────────────────
export interface SubagentSpawnOp {
  type: "subagent/spawn";
  parentRoundId: RoundId;
  subagentId: SubagentId;
  label: string;
  childSessionKey?: SessionKey;
  timestamp: number;
}

export interface SubagentAppendSegmentOp {
  type: "subagent/append-segment";
  subagentId: SubagentId;
  /** segment 已含稳定 id，reducer 按 id merge（已存在则更新） */
  segment: Segment;
}

export interface SubagentUpdateStatusOp {
  type: "subagent/update-status";
  subagentId: SubagentId;
  status: SubagentStatus;
  currentTool?: string;
}

export interface SubagentLifecycleEndOp {
  type: "subagent/lifecycle-end";
  subagentId: SubagentId;
  status: Extract<SubagentStatus, "done" | "failed" | "skipped">;
  timestamp: number;
}

/** S4.5-T: subagent 内部 message 边界。
 *  reducer：close openBatchId + activeMessageIndex++ + segmentSeqByKind 清空。
 *  幂等保证：translator 不需要去重，reducer 见到时无脑应用（每条 backend message_start 都触发）。 */
export interface SubagentMessageStartOp {
  type: "subagent/message-start";
  subagentId: SubagentId;
  timestamp: number;
}

/** Drill-down lazy load 触发：清空 sub-agent record 的瞬时状态（segments / pending /
 *  activeMessageIndex / segmentSeqByKind / openBatchId），保留 spawn 元数据
 *  （id / parentRoundId / label / childSessionKey / status / startedAt）。
 *
 *  Why：lazy load 用 historyToSubagentOps 重建 transcript 是"权威重建"语义——
 *    history 翻译应反映 jsonl 截止当前的最终状态。如果不清空已 live 累积的 state，
 *    history apply 会在 live 累积之上累加：
 *      - activeMessageIndex 累加 → 流式 chat:delta 中段 emit 跨越多个 messageIndex
 *        → 同一段 narration 被切分成多个 segmentId（实测：同段报告渲染 3+ 次）
 *      - segments 数组保留 live push 但 message_start ops 改 reducer state 让后续
 *        live 派生 segmentId 用错误 messageIndex
 *
 *  Reset 后 history apply 让 reducer state 反映 jsonl 截止状态，live 后续 events
 *  在此基础上累加，segmentId 命名空间一致。 */
export interface SubagentResetStateOp {
  type: "subagent/reset-state";
  subagentId: SubagentId;
}

/** S4.5-T: subagent 内部 thinking pending buffer 控制。
 *  - set：写 pendingThinking（覆盖式）
 *  - clear：text 到达时清掉（保证 flush 触发 ⟺ 本 message 真的无 text）
 *  - flush：tool-start 触发；reducer 检测到 pendingThinking 非空 → 派生 narration with isThinkingFallback
 *           （plan §20.2 抽屉 trace 视图保留 thinking 诊断价值）。 */
export interface SubagentPendingThinkingOp {
  type: "subagent/pending-thinking";
  subagentId: SubagentId;
  action: "set" | "clear" | "flush";
  /** action="set" 时为 normalize 后的 thinking text；其他 action 不读 */
  text?: string;
  /** action="flush" 派生 narration 时使用 */
  timestamp?: number;
}

// ── 7.6 右侧 segments（主 agent，仅 history translator 使用）──────────────
export interface SegmentAppendNarrationOp {
  type: "segment/append-narration";
  roundId: RoundId;
  messageId: MessageId;
  text: string;
}

export interface SegmentCloseBatchOp {
  type: "segment/close-batch";
  roundId: RoundId;
  messageId: MessageId;
}

export interface SegmentAddPhaseMarkerOp {
  type: "segment/add-phase-marker";
  roundId: RoundId;
  /** 用于 segment id 派生（同 message 内多 marker 用 seq 区分） */
  messageId: MessageId;
  action: PhaseMarkerSegment["action"];
  phaseIndex?: number | number[];
  /** 直接传入完整 segment payload（除 id/startedAt 外的内容） */
  payload: Omit<PhaseMarkerSegment, "id" | "kind" | "startedAt" | "context" | "action">;
}

// ── 7.7 工具调用 ─────────────────────────────────────────────────────────
export interface ToolStartOp {
  type: "tool/start";
  toolCallId: ToolCallId;
  toolName: string;
  args?: Record<string, unknown>;
  /** 子 agent 内的 tool call 时填写 */
  subagentId?: SubagentId;
}

export interface ToolResultOp {
  type: "tool/result";
  toolCallId: ToolCallId;
  result?: Record<string, unknown>;
  status: Extract<ToolCallData["status"], "success" | "error">;
}

export interface ToolProvenancePatchOp {
  type: "tool/provenance-patch";
  toolCallId: ToolCallId;
  patch: Record<string, unknown>;
}

// ── 7.8 内容重写（受限 op）───────────────────────────────────────────────
export interface ContributionRewriteTextOp {
  type: "contribution/rewrite-text";
  roundId: RoundId;
  messageId: MessageId;
  newText: string;
  /** [from, to] 字符 offset 平移表，annotation 锚点同步使用 */
  offsetMap: Array<[number, number]>;
}

// ── 辅助：直接追加 subagent-card segment（subagent/spawn 时由 reducer 派生）─
export type DirectSegment =
  | Pick<ToolBatchSegment, "kind" | "id" | "toolCallIds" | "startedAt" | "context">
  | Pick<SubagentCardSegment, "kind" | "id" | "subagentId" | "label" | "startedAt" | "context">;

// ── ChatOp union ─────────────────────────────────────────────────────────
export type ChatOp =
  | RoundStartOp
  | RoundCompleteOp
  | RoundCheckpointSilenceOp
  | MessageStartOp
  | MessageEndOp
  | MessageSetTextOp
  | MessageSetThinkingOp
  | MessageRecordToolOp
  | TaskSetPlanOp
  | TaskUpdatePhaseOp
  | TaskCompleteAllOp
  | TaskAddPhasesOp
  | TaskCheckpointOp
  | SubagentSpawnOp
  | SubagentAppendSegmentOp
  | SubagentUpdateStatusOp
  | SubagentLifecycleEndOp
  | SubagentMessageStartOp
  | SubagentResetStateOp
  | SubagentPendingThinkingOp
  | SegmentAppendNarrationOp
  | SegmentCloseBatchOp
  | SegmentAddPhaseMarkerOp
  | ToolStartOp
  | ToolResultOp
  | ToolProvenancePatchOp
  | ContributionRewriteTextOp;

// ── 守卫与工具 ───────────────────────────────────────────────────────────

/** 用于 reducer switch 的 exhaustiveness 守卫；遇到未知 op 抛错（dev）/ noop（prod）。 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled op: ${JSON.stringify(x)}`);
}

/** Op 是否为内容覆盖类（set-text / set-thinking，v1.4）。
 *  这些 op 的特征：高频（每次 chat:delta 触发一次）、幂等覆盖、不影响 active 指针。
 *  reducer / 测试可用此守卫减少分支重复。 */
export function isContentSetOp(op: ChatOp): op is MessageSetTextOp | MessageSetThinkingOp {
  return op.type === "message/set-text" || op.type === "message/set-thinking";
}

/** Op 是否影响 round 生命周期。 */
export function isRoundLifecycleOp(op: ChatOp): op is RoundStartOp | RoundCompleteOp {
  return op.type === "round/start" || op.type === "round/complete";
}
