// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * Chat refactor §6 状态 schema 类型定义。
 *
 * 本文件只放新管线（reducer/translator/selector）需要的类型，
 * 不动现有 `@/types`、`CardTypes` 中已有定义；Segment 系列直接复用 CardTypes。
 *
 * 设计原则：
 *   P3 派生量零存储 — phase / conclusion 文本 / thinking 文本不进 state，由 selector 派生
 *   P6 稳定派生 ID — RoundId/MessageId/SegmentId 跨 live/history 一致
 */

import type { Segment } from "../contracts/cards";
import type { ChatMessage, TaskPlan, TaskStep, ToolCallData } from "../contracts/protocol";

// ── ID 标记类型（仅文档用途，运行时仍是 string）────────────────────────────────
export type RoundId = string;
export type MessageId = string;
export type SegmentId = string;
export type ToolCallId = string;
export type SubagentId = string;
export type SessionKey = string;

// ── 三阶段（refactor-plan §3.1）─────────────────────────────────────────────
export type Phase = "pre-plan" | "execution" | "report";

// ── Block 类型（一条 message 内 thinking 或 text 二选一）─────────────────────
export type BlockKind = "text" | "thinking";

// ── 分类（refactor-plan §3.2）───────────────────────────────────────────────
export type Classification =
  | "left-conclusion"
  | "right-narration"
  | "report-conclusion"
  | "preplan-content"
  | "preplan-thinking"
  | "report-thinking"
  | "discarded";

// ── Pending（流式中未 finalize 的 message）─────────────────────────────────
export interface PendingMessage {
  messageId: MessageId;
  startedAt: number;
  /** v1.5 §20.14: prefix-aware merge 写入语义。三分支：
   *    1. cumulative growth (next.startsWith(prev)) → 取 next
   *    2. 同段 buffer reset 重发 (prev.startsWith(next)) → 短路保留 prev
   *    3. 独立 block 互不包含 → append 拼接（v1.4-A 修复）
   *  实证：anthropic 协议每条 assistant message 含 1 个独立 thinking block，
   *  message_start 缺失/race 时多条 thinking 落同一 pending → 必须 append。 */
  contentText: string;
  thinkingText: string;
  /** 当前 message 内已记录的 tool call ids（按到达顺序） */
  toolCallIds: ToolCallId[];
  /** 当前 message 已见的 tool 名集合（去重，O(1) 查询用） */
  toolNamesSeen: Set<string>;
  /** 当前 message 是否含 structural tool（task_create / task_update / sessions_spawn / subagents 等） */
  hasStructuralTool: boolean;
  /** message_start 时刻 snapshot 的 phase（v1.1 §3.4 / §20.10）。
   *  classify 用此值而非 message_end 时派生的当前 phase——message 内 phase 翻转
   *  （task_update.complete_phase(LAST)）不应改变本 message 的分类。 */
  phaseAtStart: Phase;
}

// ── Contribution（已 finalize、immutable）──────────────────────────────────
export interface MessageContribution {
  messageId: MessageId;
  finalizedAt: number;
  /** v1.4: finalize 时从 pending 整段转移；immutable */
  contentText: string;
  thinkingText: string;
  toolCallIds: readonly ToolCallId[];
  classification: Classification;
}

// ── Subagent 记录（refactor-plan §6 / §12）──────────────────────────────────
export type SubagentStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** Phase 状态（与 TaskStepStatus 对齐）。
 *  独立于 backend TaskPlan 协议存储——backend phases-only plan 形态下 plan 自身没 status，
 *  状态由 reducer 在 reduceTaskUpdatePhase 时维护。 */
export type PhaseStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** Checkpoint UI 数据（task_checkpoint tool 触发）。
 *  独立于 TaskPlan.checkpoint string，结构跟老路径 TaskCardData.checkpointData 同形。 */
export interface CheckpointData {
  type: "confirm" | "suggest" | "warn";
  message: string;
  options?: string[];
}

export interface SubagentRecord {
  id: SubagentId;
  parentRoundId: RoundId;
  label: string;
  status: SubagentStatus;
  childSessionKey?: SessionKey;
  /** 抽屉单列时间轴（refactor-plan §4.3） */
  segments: Segment[];
  startedAt: number;
  completedAt?: number;
  /** 当前正在执行的 tool 名（用于摘要） */
  currentTool?: string;
  // ── S4.5-T 内部翻译需要的辅助状态 ───────────────────────────────────────
  /** 当前 message 内尚未 flush 的 thinking 文本。
   *  text 到达即清空（subagent/pending-thinking action="clear"）；
   *  tool start 时若仍非空 → flush 成 isThinkingFallback=true 的 narration（plan §20.2）。 */
  pendingThinking?: string;
  /** 当前打开的 tool-batch segment id（mirror 老 openSubagentBatch Map）。
   *  message-start / 新 narration / phase-marker 触发 close（设回 null）。 */
  openBatchId?: string | null;
  /** Subagent 内部 message 序号，0-based。subagent/message-start 时 ++。
   *  stable segmentId 派生：`${subagentId}:${activeMessageIndex}:${kind}:${seq}` */
  activeMessageIndex: number;
  /** 当前 message 内 segment 序号（按 kind 分别计数）；message-start 时清空。
   *  reducer 在 subagent/append-segment 新 push 时自增；patch 不动。 */
  segmentSeqByKind: Map<string, number>;
}

// ── Round（refactor-plan §6）────────────────────────────────────────────────
export type RoundStatus = "streaming" | "done" | "failed" | "aborted";

export interface Round {
  id: RoundId;
  index: number;
  userMessage: ChatMessage;
  sessionKey: SessionKey;
  status: RoundStatus;
  startedAt: number;
  completedAt?: number;
  /** 任务计划，仅作 backend 协议原始 plan 存储。
   *  注：phase 状态推进**不**写入此字段——见 phaseStatuses。 */
  task?: TaskPlan;
  /** phase 状态独立字段，按 phase index 索引，与 plan 协议结构解耦。
   *  生命周期：reduceTaskSetPlan 初始化/扩展（永不缩短）；
   *           reduceTaskUpdatePhase 写入；
   *           reduceTaskAddPhases 末尾扩展。 */
  phaseStatuses?: PhaseStatus[];
  /** task_checkpoint tool 触发的 checkpoint UI 数据，独立于 TaskPlan.checkpoint string */
  checkpointData?: CheckpointData;
  /** 流式中、未 finalize 的 messages，messageId → PendingMessage */
  pending: Map<MessageId, PendingMessage>;
  /** 已 finalize 的 messages（append-only，除显式 contribution/rewrite-text op） */
  contributions: Map<MessageId, MessageContribution>;
  /** 右侧 timeline segments，按到达顺序追加 */
  segments: Segment[];
  /** assistant 消息 ID，annotation hook */
  assistantMessageId?: MessageId;
  /** 是否被 checkpoint 静音 */
  silencedAfterCheckpoint: boolean;
  /** Round 内 message index 自增计数，message/start 时使用 */
  nextMessageIndex: number;
  /** 当前活跃 message id（pending 中最后一个 message_start 的） */
  activeMessageId: MessageId | null;
  /** 当前 message 内 segment 序号（按 kind 分别计数），用于派生 segment id */
  segmentSeqByKind: Map<string, number>;
  /** 失败原因（status=failed 时填） */
  failureReason?: string;
}

// ── ChatState（reducer 顶层）────────────────────────────────────────────────
export interface ChatState {
  /** 顺序数组（用户阅读顺序） */
  rounds: Round[];
  /** roundId → rounds 数组下标 O(1) 索引 */
  roundsById: Map<RoundId, number>;

  /** subagentId → SubagentRecord */
  subagents: Map<SubagentId, SubagentRecord>;

  /** toolCallId → ToolCallData */
  toolCalls: Map<ToolCallId, ToolCallData>;

  /** 当前活跃（streaming）round ID */
  activeRoundId: RoundId | null;
  /** 当前活跃 message id（流式 delta 写入目标）。等价 active round 的 activeMessageId 镜像 */
  activeMessageId: MessageId | null;

  /** 当前 sessionKey */
  currentSessionKey: SessionKey | null;

  /** sessions_spawn 工具尚未 lifecycle:start 的子 sessionKey 缓存：runId → childSessionKey */
  pendingChildSessionKeyByRunId: Map<SubagentId, SessionKey>;

  // 被 checkpoint 静音的 round 由 Round.silencedAfterCheckpoint 单独承载，
  // 不在 top-level 维护重复 Set（P3 派生量零存储）。
}

/** Continue beyond the largest restored index. Hidden system messages can leave
 * gaps in the legacy history numbering; counting visible rounds would reuse an ID. */
export function nextRoundIndexFor(state: ChatState, sessionKey: SessionKey): number {
  let next = 0;
  for (const r of state.rounds) {
    if (r.sessionKey === sessionKey) next = Math.max(next, r.index + 1);
  }
  return next;
}

// ── 左侧 LeftCard（selectLeftCards 的输出）─────────────────────────────────
export type LeftCardKind = "preplan-thinking" | "task" | "report-thinking" | "conclusion";

export interface PreplanThinkingCard {
  kind: "preplan-thinking";
  text: string;
  /** 来源 messageIds（用于 annotation 锚点） */
  sourceMessageIds: readonly MessageId[];
}

export interface TaskCard {
  kind: "task";
  task: TaskPlan;
}

export interface ReportThinkingCard {
  kind: "report-thinking";
  text: string;
  sourceMessageIds: readonly MessageId[];
}

export interface ConclusionCard {
  kind: "conclusion";
  text: string;
  sourceMessageIds: readonly MessageId[];
}

export type LeftCard = PreplanThinkingCard | TaskCard | ReportThinkingCard | ConclusionCard;

// ── 工具：判断 task step 是否为可推进的 phase（task plan 里既有 phase 也有非 phase step） ─
export type PhaseStep = TaskStep & {
  status: NonNullable<TaskStep["status"]>;
};

export function isPhaseStep(step: TaskStep): step is PhaseStep {
  return step.status !== undefined;
}

// ── Initial state factory ─────────────────────────────────────────────────
export function createInitialChatState(): ChatState {
  return {
    rounds: [],
    roundsById: new Map(),
    subagents: new Map(),
    toolCalls: new Map(),
    activeRoundId: null,
    activeMessageId: null,
    currentSessionKey: null,
    pendingChildSessionKeyByRunId: new Map(),
  };
}
