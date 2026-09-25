// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import { normalizePlan } from "./_plan-normalize";
import type { ChatOp } from "../model/chat.ops";
import type { ChatState } from "../model/chat.types";
import type { TaskPlan } from "../contracts/protocol";
import { activeRound } from "./live.common";


/**
 * Backend sessionKey 路由的 task_update stream 事件翻译。
 *
 * 与 `case "tool"` 内的 `task_update` tool（runId 路由的 toolEventRecipients 路径）不同：
 * - stream:tool 路径：传统 tool start/result 事件，args 含 action/phase_index 等
 * - stream:task_update 路径：backend pushTaskUpdateEvent 主动推送的 plan snapshot
 *   （带 sessionKey 路由，绕过 toolEventRecipients；WS 重连后续推时确保前端拿到 phase 状态）
 *
 * 老路径在 chat-event-handler.ts:1179 case "task_update" 处理；chatV2 之前漏。
 *
 * 翻译策略：
 * 1. emit task/set-plan（normalize 后），同步 plan 形态
 * 2. 遍历 plan 的 phase steps，对每个非 pending 的 status emit task/update-phase
 *    （reducer 幂等：status 已是目标值会短路；phaseStatuses 永不缩短保留已推进状态）
 */
export function translateAgentTaskUpdate(state: ChatState, data: Record<string, unknown>): ChatOp[] {
  const round = activeRound(state);
  if (!round) return [];

  const rawPlan = data.plan as Record<string, unknown> | undefined;
  const normalized = normalizePlan(rawPlan as TaskPlan | undefined);
  if (!normalized) return [];

  const ops: ChatOp[] = [{ type: "task/set-plan", roundId: round.id, plan: normalized }];

  // 遍历 normalized plan 的 phase steps，emit task/update-phase（让 phaseStatuses 推进）
  // reduceTaskSetPlan 仅初始化 phaseStatuses，不写非 pending 状态——必须显式 emit task/update-phase
  let phaseIndex = 0;
  for (const g of normalized.groups ?? []) {
    for (const s of g.steps) {
      if (typeof s.id !== "string" || !s.id.startsWith("phase-")) continue;
      const status = s.status;
      if (
        status === "running" ||
        status === "done" ||
        status === "failed" ||
        status === "skipped"
      ) {
        ops.push({
          type: "task/update-phase",
          roundId: round.id,
          phaseIndex,
          status,
          result: s.output_summary ?? s.outputSummary,
        });
      }
      phaseIndex++;
    }
  }

  return ops;
}


export const PHASE_ACTION_STATUS: Record<string, "done" | "failed" | "skipped"> = {
  complete_phase: "done",
  fail_phase: "failed",
  skip_phase: "skipped",
};


export function parseArgsField(raw: unknown): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return undefined;
}


/** 从 task_create 的 result 解析 plan（与 services/chat-event-helpers parsePlanFromResult 同形）。
 *  支持 result 是字符串、{ content: [{ type: "text", text }] }、{ plan }、{ groups } 多种形态。 */
export function extractPlanFromResult(rawResult: unknown): TaskPlan | null {
  if (rawResult === undefined || rawResult === null) return null;
  let obj: unknown = rawResult;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  // { content: [{ type: "text", text }] }
  if (Array.isArray(o.content)) {
    for (const block of o.content) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          try {
            const inner = JSON.parse(b.text) as Record<string, unknown>;
            if (inner.plan) return inner.plan as TaskPlan;
            if (inner.groups) return inner as unknown as TaskPlan;
          } catch {
            // not JSON
          }
          break;
        }
      }
    }
  }
  if (o.plan && typeof o.plan === "object") return o.plan as TaskPlan;
  if (o.groups) return o as unknown as TaskPlan;
  return null;
}


/** task_update 各 action 的 args → ChatOp[]。
 *  - PHASE_ACTION_STATUS（complete/fail/skip）: emit task/update-phase + segment/add-phase-marker
 *  - add_phases: emit task/add-phases + segment/add-phase-marker(add)
 *  其他 action（batch_complete 等）暂不翻译。
 *  export 给 history translator 复用——确保 live 与 history 行为一致。
 *
 *  `markerCtx` 可选——提供 messageId + toolCallId 时同步 emit phase-marker segment。
 *  history translator 调用时也提供，让 history 重放也写出 phase-marker。 */
export function translateTaskUpdateArgs(
  roundId: string,
  args: Record<string, unknown>,
  markerCtx?: { messageId: string; toolCallId?: string },
  phaseCount?: number,
): ChatOp[] {
  const action = args.action as string | undefined;
  if (!action) return [];

  if (action in PHASE_ACTION_STATUS) {
    const phaseIndex = args.phase_index as number | undefined;
    if (phaseIndex === undefined || !Number.isInteger(phaseIndex) || phaseIndex < 0) return [];
    const status = PHASE_ACTION_STATUS[action];
    if (!status) return [];
    const summary = (args.summary as string | undefined) ?? (args.reason as string | undefined);

    // The backend contract is 0-based, but models occasionally report the final
    // phase using its human-facing number (N instead of N-1). Treat exactly
    // one-past-the-end complete_phase as an explicit whole-plan completion;
    // other out-of-range values are ignored and never rendered as “task N+1”.
    if (phaseCount !== undefined && phaseIndex >= phaseCount) {
      if (action !== "complete_phase" || phaseIndex !== phaseCount || phaseCount === 0) {
        return [];
      }
      const allPhaseIndices = Array.from({ length: phaseCount }, (_, index) => index);
      const ops: ChatOp[] = [{ type: "task/complete-all", roundId }];
      if (markerCtx) {
        ops.push({
          type: "segment/add-phase-marker",
          roundId,
          messageId: markerCtx.messageId,
          action: "complete",
          phaseIndex: allPhaseIndices,
          payload: {
            summaries: summary ? [summary] : undefined,
            toolCallId: markerCtx.toolCallId,
          },
        });
      }
      return ops;
    }

    const ops: ChatOp[] = [
      {
        type: "task/update-phase",
        roundId,
        phaseIndex,
        status,
        result: summary,
      },
    ];
    if (markerCtx) {
      const markerAction =
        action === "complete_phase"
          ? ("complete" as const)
          : action === "fail_phase"
            ? ("fail" as const)
            : ("skip" as const);
      ops.push({
        type: "segment/add-phase-marker",
        roundId,
        messageId: markerCtx.messageId,
        action: markerAction,
        phaseIndex,
        payload: {
          summaries: summary ? [summary] : undefined,
          toolCallId: markerCtx.toolCallId,
        },
      });
    }
    return ops;
  }

  if (action === "add_phases") {
    const newPhases = args.new_phases as Array<{ description?: string; id?: string }> | undefined;
    if (!Array.isArray(newPhases) || newPhases.length === 0) return [];
    const addedDescriptions = newPhases
      .map((p) => (typeof p?.description === "string" ? p.description : ""))
      .filter(Boolean);
    const ops: ChatOp[] = [
      {
        type: "task/add-phases",
        roundId,
        addedPhases: newPhases.map((p, i) => ({
          id: p.id ?? `added-${i}`,
          name: p.description ?? "",
          status: "pending",
        })),
      },
    ];
    if (markerCtx) {
      ops.push({
        type: "segment/add-phase-marker",
        roundId,
        messageId: markerCtx.messageId,
        action: "add",
        payload: {
          addedPhases: addedDescriptions,
          toolCallId: markerCtx.toolCallId,
        },
      });
    }
    return ops;
  }

  return [];
}
