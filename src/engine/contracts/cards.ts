// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/** 卡片生命周期状态 */
export type CardStatus = "pending" | "running" | "streaming" | "paused" | "done" | "failed";

/** 卡片类型 */
export type CardKind = "thinking" | "task" | "conclusion";

/** 任务步骤执行模式 */
export type TaskExecutionMode = "serial" | "parallel";

/** 任务步骤状态 */
export type TaskStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** 任务步骤 */
export interface TimelineTaskStep {
  id: string;
  name: string;
  status: TaskStepStatus;
  /** 所属组 ID */
  groupId?: string;
  /** 所属组标题 */
  groupTitle?: string;
  /** 组类型 */
  groupType?: TaskExecutionMode;
  outputSummary?: string;
  /** snake_case alias for outputSummary */
  output_summary?: string;
  insights?: string[];
  /** 数据来源 */
  dataSource?: string;
  /** snake_case alias for dataSource */
  data_source?: string;
  /** 耗时（ms） */
  duration?: number;
  tool?: string;
  toolCallId?: string;
  /** 归属的子 agent ID */
  subagentId?: string;
}

/** 任务步骤组（用于渲染） */
export interface TimelineTaskGroup {
  id: string;
  title: string;
  type: TaskExecutionMode;
  steps: TimelineTaskStep[];
}

/** 思考卡片数据 */
export interface ThinkingCardData {
  kind: "thinking";
  /** 流式累积的思考文本 */
  streamingText: string;
}

/** 子 agent 状态条目（来自 plan.subagents） */
export interface SubagentEntry {
  id: string;
  label: string;
  status: TaskStepStatus;
  stepIds: string[];
  startedAt?: number;
  completedAt?: number;
  currentTool?: string;
  /** 子 agent 自己的 sessionKey（如 agent:main:subagent:<uuid>），SubagentDrillDown
   *  懒加载完整 transcript 时通过它调 chat.history。
   *  Live 路径若 lifecycle 事件不带 sessionKey，可能为 undefined；history 路径会从
   *  sessions_spawn 的 toolResult.details.childSessionKey 重建填回。 */
  childSessionKey?: string;
}

/** 任务执行卡片数据 */
export interface TaskCardData {
  kind: "task";
  planId?: string;
  title: string;
  coreQuestion?: string;
  skillName?: string;
  /** 子 agent 状态列表（sessions_spawn 路径由后端推送） */
  subagents?: SubagentEntry[];
  /** 扁平化的步骤列表（用于简单渲染） */
  steps: TimelineTaskStep[];
  /** 分组的步骤列表（用于高级渲染） */
  groups?: TimelineTaskGroup[];
  checkpoint?: string;
  /** Structured checkpoint data from task_checkpoint tool */
  checkpointData?: {
    type: "confirm" | "suggest" | "warn";
    message: string;
    options?: string[];
  };
}

/** 核心结论卡片数据 */
export interface ConclusionCardData {
  kind: "conclusion";
  /** 流式累积的结论文本 */
  streamingText: string;
  /** 标注列表 */
  annotations?: import("./protocol").Annotation[];
}

export type CardData = ThinkingCardData | TaskCardData | ConclusionCardData;

/** 时间轴中的一个卡片条目 */
export interface CardEntry {
  id: string;
  status: CardStatus;
  data: CardData;
  /** 卡片开始时间 */
  startedAt: number;
  /** 卡片完成时间 */
  completedAt?: number;
  /** 失败原因 */
  errorReason?: string;
  /** 是否折叠（仅 thinking/conclusion 卡片有效） */
  collapsed?: boolean;
}

/** Round 内的 slot 类型 */
export type RoundSlot = "thinking" | "task" | "conclusion";

// ── 右栏执行 Timeline Segment 类型 ────────────────────────────────────────

/** Segment 所属上下文：主 agent（phase 归属）或某个 subagent */
export interface SegmentContext {
  /** 所属 phase 索引。主 agent 视角下的 phase cursor 快照值。
   *  undefined 表示 pre-plan / report / 无法归属 */
  phaseIndex?: number;
  /** 若此 segment 产生在 subagent 内部，记录 subagentId；主 agent 自身的段为 undefined */
  subagentId?: string;
}

/** 右栏时间轴条目（按到达顺序排列） */
export type SegmentKind = "narration" | "tool-batch" | "phase-marker" | "subagent-card";

/** 话术段 —— 模型的 text content block（非 extended thinking） */
export interface NarrationSegment {
  kind: "narration";
  id: string;
  /** 累积的流式文本 */
  text: string;
  startedAt: number;
  context: SegmentContext;
  /**
   * 是否为 thinking 兜底段：当某条 assistant message 没有 content text 但有 thinking 时，
   * 把 thinking 文本写入 narration 作为右栏可见兜底。这个标记用于：
   *   1. 区分"已有真实 content narration" vs "只有 thinking 兜底"，避免重复兜底；
   *   2. 与普通 narration 行为一致，不再做视觉上的 emoji 前缀区分（之前用 "🧠 " 前缀）。
   */
  isThinkingFallback?: boolean;
}

/** Tool 调用批次 —— 同一 assistant message 内的多个 tool_use 自然成组 */
export interface ToolBatchSegment {
  kind: "tool-batch";
  id: string;
  /** 批次内按顺序排列的 tool call id 列表（实际 ToolCallData 仍存在 chat.store.toolCalls Map 中）*/
  toolCallIds: string[];
  startedAt: number;
  context: SegmentContext;
}

/** Phase 事件标记（task_create / task_update 各种 action / add_phases 都收敛到这种 segment） */
export type PhaseMarkerAction = "create" | "complete" | "fail" | "skip" | "add";
export interface PhaseMarkerSegment {
  kind: "phase-marker";
  id: string;
  action: PhaseMarkerAction;
  /** 单值或数组（合并启发式后可能是数组，表示批量完成） */
  phaseIndex?: number | number[];
  /** 合并后多条 summary 以数组保留原序；单条 summary 也用数组 */
  summaries?: string[];
  /** add_phases 时附带的新 phase 描述列表 */
  addedPhases?: string[];
  /** create 时的 plan 概览（用于顶部"📋 计划：N phases"标记）*/
  planPhaseCount?: number;
  /** 底层 tool call id（点击进 ToolDetailModal 时使用）*/
  toolCallId?: string;
  startedAt: number;
  context: SegmentContext;
}

/** 父视图里指向 subagent 的占位卡 */
export interface SubagentCardSegment {
  kind: "subagent-card";
  id: string;
  subagentId: string;
  /** subagent 的人类标签 */
  label: string;
  startedAt: number;
  context: SegmentContext;
}

export type Segment =
  | NarrationSegment
  | ToolBatchSegment
  | PhaseMarkerSegment
  | SubagentCardSegment;

// ── Round ─────────────────────────────────────────────────────────────────

/** 一次对话轮次，包含用户消息和 AI 响应的三个固定 slot */
export interface Round {
  id: string;
  index: number;
  /** 关联的用户消息 */
  userMessage: import("./protocol").ChatMessage;
  /** assistant 消息的唯一 ID */
  assistantMessageId?: string;
  /** AI 响应的三个独立 slot，渲染顺序由 JSX 结构保证 */
  thinking: CardEntry | null;
  task: CardEntry | null;
  conclusion: CardEntry | null;
  /** 右栏执行 timeline 段序列（按到达顺序追加）。
   *  主 agent 自身发起的段放主列；subagent 内部的段 context.subagentId 不为空。
   *  用一个扁平数组承载所有主 agent 的段，subagent 内部段按 subagentId 分组懒渲染。 */
  executionSegments: Segment[];
  /** 轮次状态 */
  status: "pending" | "streaming" | "done" | "failed";
  startedAt: number;
  completedAt?: number;
}
