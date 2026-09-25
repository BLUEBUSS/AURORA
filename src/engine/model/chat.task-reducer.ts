// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/** Task-specific reducers kept separate from shared segment reducers. */

import type { ChatOp } from "./chat.ops";
import { countPhases, withRound } from "./chat.reducer.parts";
import { isPhaseStep } from "./chat.types";
import type { ChatState } from "./chat.types";

/**
 * 收敛显式完成的任务计划。
 * 已标为 failed/skipped 的阶段保留原状态，其余阶段视为本次报告已覆盖并标记 done。
 */
export function reduceTaskCompleteAll(
  state: ChatState,
  op: Extract<ChatOp, { type: "task/complete-all" }>,
): ChatState {
  return withRound(state, op.roundId, (r) => {
    if (!r.task) return r;
    const current = r.phaseStatuses ?? [];
    const planPhaseCount = countPhases(r.task);
    const phaseCount = planPhaseCount > 0 ? planPhaseCount : current.length;
    if (phaseCount === 0) return r;

    const newStatuses = Array.from({ length: phaseCount }, (_, index) => {
      const existing = current[index];
      return existing === "failed" || existing === "skipped" ? existing : ("done" as const);
    });

    let cursor = 0;
    const newGroups = (r.task.groups ?? []).map((group) => ({
      ...group,
      steps: group.steps.map((step) => {
        if (!isPhaseStep(step)) return step;
        const status = newStatuses[cursor] ?? "done";
        cursor++;
        return status === step.status ? step : { ...step, status };
      }),
    }));
    const nextTask = newGroups.length > 0 ? { ...r.task, groups: newGroups } : r.task;

    const statusesSame =
      current.length === newStatuses.length &&
      current.every((status, i) => status === newStatuses[i]);
    if (statusesSame && nextTask === r.task) return r;
    return { ...r, task: nextTask, phaseStatuses: newStatuses };
  });
}
