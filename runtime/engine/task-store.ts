// Adapted from ANLYST/OpenClaw (MIT). See docs/licenses/OpenClaw-MIT.txt.
import { TaskStoreImpl } from "./task-state.js";
import { emitAgentEvent, researchContext } from "./context.js";
import type { TaskPlan } from "./task-types.js";
export * from "./task-types.js";
export * from "./task-ids.js";
export const taskStore = new TaskStoreImpl();
/** Check if all steps in a plan are terminal (done/failed/skipped).
 *  Used by nav/update hints to decide whether to prompt the report phase,
 *  since plan.status is no longer set to "done" mid-turn. */
export function isAllStepsTerminal(plan: TaskPlan): boolean {
  const all = plan.groups.flatMap((g) => g.steps);
  return (
    all.length > 0 &&
    all.every((s) => s.status === "done" || s.status === "failed" || s.status === "skipped")
  );
}

/** 发射 task_update 事件刷新前端任务进度面板 */
export function pushTaskUpdateEvent(
  planId: string,
  logger?: { info: (msg: string) => void },
  caller?: string,
): void {
  const plan = taskStore.toJSONCompact(planId);
  if (!plan) return;

  const globalRunId = researchContext.getStore()?.runId;

  // Use a dedicated stream "task_update" instead of "tool" so the gateway routes
  // via broadcastToSessionOrAll (sessionKey-based) instead of toolEventRecipients
  // (runId-based). When sub-agents call task_update, their runId doesn't match
  // the WS-registered recipients (which use the parent agent's runId), causing
  // events to be silently dropped. SessionKey-based routing always reaches the
  // correct frontend subscriber regardless of which agent emitted the event.
  //
  // Groups are included (not stripped) so the frontend syncPlanFromToolResult
  // can update step statuses. syncPlanFromToolResult uses statusRank to never
  // downgrade a step's status (pending < running < done/failed/skipped).
  try {
    emitAgentEvent({
      runId: globalRunId ?? `task-${planId}`,
      sessionKey: plan.sessionKey,
      stream: "task_update",
      data: {
        name: "task_update",
        plan,
      },
    });
    logger?.info(
      `[pushTaskUpdateEvent] emitted, runId=${(globalRunId ?? `task-${planId}`).slice(-30)}, planId=${planId}, caller=${caller ?? "?"}, `,
    );
  } catch (err) {
    console.warn(`[pushTaskUpdateEvent] emitAgentEvent threw: ${err}`);
  }
}
