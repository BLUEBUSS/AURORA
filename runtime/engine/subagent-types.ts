// Adapted from ANLYST/OpenClaw (MIT). See docs/licenses/OpenClaw-MIT.txt.
/**
 * 子 Agent 类型定义
 *
 * SubagentStatusEntry 用于 sessions_spawn 路径，随 plan JSON 推送到前端。
 * 其余编排器类型（OrchestratorContext, SpawnRecord, SubagentGroup 等）已废弃并移除。
 */

/** 子 agent 状态条目（随 plan JSON 推送到前端） */
export interface SubagentStatusEntry {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  stepIds: string[];
  startedAt?: number;
  completedAt?: number;
  currentTool?: string;
}
