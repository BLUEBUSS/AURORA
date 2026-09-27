import type { TaskPlan } from "./task-types.js";
export function isAllStepsTerminal(plan: TaskPlan): boolean {
  const all = plan.groups.flatMap((group) => group.steps);
  return all.length > 0 && all.every((step) => ["done", "failed", "skipped"].includes(step.status));
}
