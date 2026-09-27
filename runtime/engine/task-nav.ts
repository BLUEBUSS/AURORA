// Adapted from ANLYST/OpenClaw (MIT). See docs/licenses/OpenClaw-MIT.txt.
import { type TaskPlan } from "./task-store.js";

// Patterns indicating the error contains candidate options that need user disambiguation.
const DISAMBIGUATION_PATTERNS = [/匹配到多/, /请指定更精确/, /多个结果/, /多只股票/];

function isDisambiguationError(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  return DISAMBIGUATION_PATTERNS.some((p) => p.test(errorMessage));
}

/**
 * If any failed step contains a disambiguation error (multiple candidates),
 * instruct the model to call task_checkpoint so the user can pick the right one.
 * Non-disambiguation failures (network, data missing, etc.) are skipped silently.
 */
export function buildFailedStepRecoveryHint(plan: TaskPlan): string | null {
  const allSteps = plan.groups.flatMap((g) => g.steps);
  const disambigSteps = allSteps.filter(
    (s) => s.status === "failed" && s.tool && isDisambiguationError(s.error_message),
  );
  if (disambigSteps.length === 0) return null;

  const hasPending = allSteps.some((s) => s.status === "pending");
  if (!hasPending) return null;

  const failedList = disambigSteps.map((s) => `${s.tool}（步骤 ${s.id}）`).join("、");
  return (
    `【名称歧义需用户确认】${failedList} 因标的名称匹配到多个结果而失败。` +
    "请检查上方工具返回的错误信息中的候选列表，调用 task_checkpoint(type='suggest')，将候选项作为 options 参数传入，让用户选择正确的标的。" +
    "用户选择后，用选定的证券代码重新调用该工具（系统会自动追加步骤跟踪），然后继续后续步骤。"
  );
}

/**
 * Build a compact one-line progress summary, e.g.:
 * "当前进度: plan-2 [3/7 步骤完成] 公司基本面 ✓ | 财务分析 ✓ | 估值与预期 ○ | …"
 */
export function buildProgressSummary(plan: TaskPlan): string {
  const allSteps = plan.groups.flatMap((g) => g.steps);
  const doneCount = allSteps.filter(
    (s) => s.status === "done" || s.status === "failed" || s.status === "skipped",
  ).length;
  const groupStatus = plan.groups
    .map((g) => {
      const gSteps = g.steps;
      const allDone = gSteps.every(
        (s) => s.status === "done" || s.status === "failed" || s.status === "skipped",
      );
      const anyRunning = gSteps.some((s) => s.status === "running");
      const icon = allDone ? "✓" : anyRunning ? "▶" : "○";
      return `${g.title} ${icon}`;
    })
    .join(" | ");
  return `当前进度: ${plan.id} [${doneCount}/${allSteps.length} 步骤完成] ${groupStatus}`;
}
