// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/** Chat message in the message list */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  /** Tool call IDs associated with this message */
  toolCallIds?: string[];
  /** Thinking text (for assistant messages) */
  thinkingText?: string;
  /** Whether thinking is collapsed */
  thinkingCollapsed?: boolean;
  /** Token usage info */
  usage?: { input: number; output: number };
  /** Image attachments (base64 data URLs) */
  images?: string[];
  /** 强制使用的技能名称（从 FINCLAW_SELECTED_SKILL 前缀提取） */
  skillName?: string;
}


/** Tool call data */
export interface ToolCallData {
  callId: string;
  toolName: string;
  /** Human readable title for display */
  title?: string;
  status: "pending" | "running" | "success" | "error";
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  startedAt?: number;
  completedAt?: number;
}


/** Task step group from task_create tool */
export interface TaskStepGroup {
  id?: string;
  title: string;
  type?: "serial" | "parallel";
  steps: TaskStep[];
}


/** Task plan from task_create tool */
export interface TaskPlan {
  id?: string;
  query?: string;
  coreQuestion?: string;
  core_question?: string; // snake_case alias
  title?: string;
  matchedSkill?: string;
  matchedSkillLabel?: string;
  skillName?: string;
  status?: "pending" | "running" | "done" | "failed" | "executing";
  groups?: TaskStepGroup[]; // legacy format
  phases?: Array<{ description: string }>; // new simplified format
  checkpoint?: string;
  /** 子 agent 状态数组（sessions_spawn 路径，来自后端 task_update） */
  subagents?: Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "done" | "failed";
    stepIds: string[];
    startedAt?: number;
    completedAt?: number;
    currentTool?: string;
  }>;
  createdAt?: number;
  completedAt?: number;
}


/** Individual task step */
export interface TaskStep {
  id: string;
  title?: string;
  name?: string; // alias for title
  description?: string;
  status?: "pending" | "running" | "done" | "failed" | "skipped";
  tool?: string;
  outputSummary?: string;
  output_summary?: string; // snake_case alias
  insights?: string[];
  duration?: number;
  callId?: string;
  toolCallId?: string;
  addedBy?: string;
  added_by?: string; // snake_case alias
}


// ── Annotation Types ──────────────────────────────────────────────────────

/** 标注类型 */
export type AnnotationType = "text" | "voice";


/** 文本选区信息 */
export interface AnnotationSelection {
  /** Round 唯一 ID（最优先使用，最稳定） */
  roundId?: string;
  /** 消息唯一 ID（次优先） */
  messageId?: string;
  /** 消息在会话中的索引（向后兼容） */
  messageIndex: number;
  /** 选区起始字符偏移 */
  startOffset: number;
  /** 选区结束字符偏移 */
  endOffset: number;
  /** 被选中的原始文本 */
  selectedText: string;
}


/** 标注内容 */
export interface AnnotationPayload {
  /** 备注文本 */
  text: string;
  /** 语音录音 URL（仅 voice 类型） */
  voiceUrl?: string;
  /** 语音时长（秒，仅 voice 类型） */
  voiceDurationSec?: number;
}


/** 标注实体 */
export interface Annotation {
  /** 标注唯一 ID */
  id: string;
  /** 所属会话 key */
  sessionKey: string;
  /** 标注类型 */
  type: AnnotationType;
  /** 文本选区信息 */
  selection: AnnotationSelection;
  /** 标注内容 */
  payload: AnnotationPayload;
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
  /** 创建者用户 ID */
  createdBy?: string;
}
