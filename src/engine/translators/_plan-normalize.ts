// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * Plan 形态规范化（translator 层一次性做）。
 *
 * 背景：backend `task_create` / `task_update.result` 推的 plan 形态多样：
 *   - phases-only: `{ phases: [{ description }] }`，无 status，无 groups
 *   - groups-only: `{ groups: [{ steps: [{ id, status }] }] }`，含 status
 *   - 同时含或两者皆空（异常 case）
 *
 * 策略：translator 翻译时调用本函数将所有形态统一为内部规范形态——
 *   - phases-only → 合成 groups[0].steps with `phase-N` id + status="pending"，phases 字段保留
 *   - groups-only / both → 不动（已是规范形态）
 *   - 都空 → 返回 null（视为无效 plan，translator 应跳过 set-plan op）
 *
 * 这样 reducer 接收的总是含 groups 的 normalized plan，简化 reducer 判断。
 *
 * 设计原则（v1.7 §20.16 撤回教训）：
 *   - 不在 reducer 里做 normalize，避免每次 set-plan 反复处理；
 *   - phase 状态本体由 reducer 的 phaseStatuses 字段维护，不依赖 normalized plan 的 step.status；
 *   - normalized plan 仅作 backend 协议的"内部规范快照"，phase 状态由 phaseStatuses 单独维护。
 */

import type { TaskPlan, TaskStep } from "../contracts/protocol";

const PHASE_ID_PREFIX = "phase-";

/**
 * 规范化 plan 形态。
 *
 * @returns 规范化后的 plan；若 plan 完全无 phases / groups → null（视为无效）
 */
export function normalizePlan(plan: TaskPlan | null | undefined): TaskPlan | null {
  if (!plan) return null;
  // 1. 已含真正 steps 的 groups → 不动
  // 防御：plan.groups 可能是 string（backend 流式 partial flush）→ Array.isArray 守卫
  if (
    Array.isArray(plan.groups) &&
    plan.groups.some((g) => Array.isArray(g.steps) && g.steps.length > 0)
  ) {
    return plan;
  }
  // 2. phases-only → 合成 groups[0].steps
  // 防御：plan.phases 在 task_create 流式期间可能是未完成的 JSON 字符串（backend partial flush
  // 持久化到 jsonl，刷新时 chat.history 把 partial message 发回 → string truthy 通过老 check
  // → 进入 .map() 抛 TypeError。Array.isArray 守卫让 partial-flushed plan 静默 reject 返回 null。
  if (Array.isArray(plan.phases) && plan.phases.length > 0) {
    const steps: TaskStep[] = plan.phases.map((p, i) => ({
      id: `${PHASE_ID_PREFIX}${i + 1}`,
      title: p.description,
      name: p.description,
      description: p.description,
      status: "pending" as const,
    }));
    return {
      ...plan,
      groups: [
        {
          id: "g1",
          title: plan.title ?? "",
          type: "serial",
          steps,
        },
      ],
    };
  }
  // 3. 既无 phases 也无 groups（或 groups 全空）→ 视为无效
  return null;
}

/**
 * 计算 plan 的 phase 总数。基于 normalized plan 的 plan.groups[].steps 展平后过滤 phase- 前缀。
 * normalized plan 一定有 groups（否则 normalizePlan 返回 null）。
 */
export function countPhaseSteps(plan: TaskPlan): number {
  if (!plan.groups) return 0;
  let total = 0;
  for (const g of plan.groups) {
    for (const s of g.steps) {
      if (typeof s.id === "string" && s.id.startsWith(PHASE_ID_PREFIX)) total++;
    }
  }
  return total;
}

/**
 * 派生 plan 的 phase 初始 status 数组（用于 reducer 初始化 phaseStatuses）。
 * 优先用 plan.groups[].steps[].status；缺失时填 pending。
 */
export function derivePlanPhaseStatuses(
  plan: TaskPlan,
): import("../model/chat.types").PhaseStatus[] {
  if (!plan.groups) return [];
  const out: import("../model/chat.types").PhaseStatus[] = [];
  for (const g of plan.groups) {
    for (const s of g.steps) {
      if (typeof s.id === "string" && s.id.startsWith(PHASE_ID_PREFIX)) {
        out.push(toPhaseStatus(s.status));
      }
    }
  }
  return out;
}

/** 把宽 string status 收窄到 PhaseStatus；老 paused 转 running 与 reduceTaskUpdatePhase 行为一致 */
export function toPhaseStatus(s: string | undefined): import("../model/chat.types").PhaseStatus {
  if (s === "running" || s === "done" || s === "failed" || s === "skipped") return s;
  if (s === "paused") return "running";
  return "pending";
}
