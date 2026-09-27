// Adapted from ANLYST/OpenClaw (MIT). See docs/licenses/OpenClaw-MIT.txt.
import type { SubagentStatusEntry } from "./subagent-types.js";
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type PlanStatus = "planning" | "executing" | "paused" | "done" | "failed";

export interface TaskStep {
  id: string;
  title: string;
  description: string;
  status: StepStatus;
  tool?: string;
  tool_call_id?: string;
  output_summary?: string;
  compressed_result?: string;
  error_message?: string;
  data_source?: string;
  /** 磁盘文件路径（相对于 workspace），原始数据持久化后供 exec 脚本读取 */
  data_file?: string;
  /** 绝对路径，仅用于 plan 完成后清理临时文件 */
  data_file_abs?: string;
  insights?: string[];
  added_by: "initial" | "replan";
  started_at?: string;
  completed_at?: string;
}

export interface TaskGroup {
  id: string;
  title: string;
  order: number;
  type: "serial" | "parallel";
  steps: TaskStep[];
}

export interface TaskCheckpointRecord {
  step_id?: string;
  type: "confirm" | "suggest" | "warn";
  message: string;
  options?: string[];
  user_choice?: string;
  created_at: string;
}

/** Research category for deep-research-pdf skill — determines downstream phase file routing */
export type ResearchCategory = "investment" | "industry" | "macro" | "event";

export interface TaskPlan {
  id: string;
  query: string;
  matched_skill?: string;
  matched_skill_label?: string;
  /** Optional research category (currently used by deep-research-pdf skill for routing/labels) */
  research_category?: ResearchCategory;
  core_question?: string;
  hypotheses?: string[];
  status: PlanStatus;
  groups: TaskGroup[];
  /** 原始 phases 描述（task_create 输入），用于前端区分 phase 和工具步骤 */
  phases?: Array<{ description: string }>;
  checkpoints: TaskCheckpointRecord[];
  created_at: string;
  updated_at: string;
  completed_at?: string;
  /** Session that owns this plan — isolates concurrent queries for the same agent. */
  sessionKey?: string;
  /** 子 agent 状态数组（随 pushTaskUpdateEvent 推送到前端） */
  subagents?: SubagentStatusEntry[];
  /** 来自 subagent announce 的已持久化数据文件路径（不在 step 级别追踪） */
  externalDataFiles?: string[];
}

/** Scope key for plan lookup. Prefer sessionKey (per-query isolation); fall back to agentId. */
export interface StoreScope {
  agentId?: string;
  sessionKey?: string;
}

