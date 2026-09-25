// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/** Standalone extraction of the source translator; see docs/chat-core-migration.md. */
import type { Segment } from "../contracts/cards";
import { normalizePlan } from "./_plan-normalize";
import type { ChatOp } from "../model/chat.ops";
import type { ChatState, SessionKey, SubagentId, SubagentRecord } from "../model/chat.types";
import type { TaskPlan } from "../contracts/protocol";
import { activeRound } from "./live.common";
import { PHASE_ACTION_STATUS, extractPlanFromResult, parseArgsField, translateTaskUpdateArgs } from "./live.tasks";
import { ensureSubagentSpawnOps, translateSubagentPhaseMarker, translateSubagentToolStart } from "./live.subagent";


export function translateAgentTool(state: ChatState, data: Record<string, unknown>): ChatOp[] {
  const toolCallId = (data.toolCallId || data.callId || data.id) as string | undefined;
  const toolName = (data.toolName || data.name) as string | undefined;
  if (!toolCallId || !toolName) return [];

  const round = activeRound(state);
  const messageId = round?.activeMessageId ?? null;
  const subagentId = data.subagentId as SubagentId | undefined;

  // S2.5 hotfix: 跟老 chat-event-handler.ts:1246 对齐用 **data shape** 判断阶段，
  // 不靠 `phase` 字段值（实测 backend 推过来 phase 字段不稳定，
  // 用字符串值匹配会漏整段 tool 事件 → record-tool 不发 → execution 期 task_update
  // message text 被错归 left-conclusion）。
  // 阶段判定：
  //   tool start: 有 args 且无 result/output/content
  //   tool result: 有 result/output/content（args 可有可无）
  const hasArgs = data.args !== undefined && data.args !== null;
  const hasResult =
    data.result !== undefined || data.output !== undefined || data.content !== undefined;
  const isToolStart = hasArgs && !hasResult;
  const isToolResult = hasResult;
  const knownToolCall = state.toolCalls.has(toolCallId);

  const ops: ChatOp[] = [];

  // A toolCallId is a global event identity, not a per-message identity. Replay
  // and cross-message result delivery must never create a second timeline row.
  if (isToolStart && knownToolCall) return [];

  // ── Subagent 内部 tool start：写 toolCalls map + subagent 桶 segment（不动主 round.segments）──
  if (isToolStart && subagentId && round) {
    const argsObj = parseArgsField(data.args);
    // toolCalls map 共享一个 slice（drilldown 通过 callId 反查 ToolCallData），
    // 跟老路径 chat-event-handler.ts:1642-1659 行为对齐
    ops.push({ type: "tool/start", toolCallId, toolName, args: argsObj, subagentId });
    ops.push(
      ...ensureSubagentSpawnOps(state, round.id, subagentId, {
        label: data.subagentLabel as string | undefined,
        childSessionKey: data.childSessionKey as SessionKey | undefined,
      }),
    );
    const rec =
      state.subagents.get(subagentId) ??
      ({
        id: subagentId,
        parentRoundId: round.id,
        label: subagentId.slice(-8),
        status: "pending" as const,
        segments: [] as Segment[],
        startedAt: Date.now(),
        openBatchId: null,
        activeMessageIndex: 0,
        segmentSeqByKind: new Map<string, number>(),
      } satisfies SubagentRecord);

    // task_create / task_update / task_checkpoint：在 subagent 桶里写 phase-marker，
    // 不动主 agent task slot（mirror chat-event-handler.ts:1354-1442）
    if (toolName === "task_create" && argsObj) {
      const phasesArr = (argsObj as { phases?: unknown }).phases;
      const planPhaseCount = Array.isArray(phasesArr) ? phasesArr.length : undefined;
      ops.push(
        ...translateSubagentPhaseMarker(rec, {
          action: "create",
          planPhaseCount,
          toolCallId,
        }),
      );
      return ops;
    }
    if (toolName === "task_update" && argsObj) {
      const action = argsObj.action as string | undefined;
      if (action && action in PHASE_ACTION_STATUS) {
        const markerAction =
          action === "complete_phase"
            ? ("complete" as const)
            : action === "fail_phase"
              ? ("fail" as const)
              : ("skip" as const);
        ops.push(
          ...translateSubagentPhaseMarker(rec, {
            action: markerAction,
            phaseIndex: argsObj.phase_index as number | undefined,
            summary:
              (argsObj.summary as string | undefined) ?? (argsObj.reason as string | undefined),
            toolCallId,
          }),
        );
        return ops;
      }
      if (action === "add_phases") {
        const newPhases = argsObj.new_phases as Array<{ description?: string }> | undefined;
        const addedDescriptions = Array.isArray(newPhases)
          ? newPhases
              .map((p) => (typeof p?.description === "string" ? p.description : ""))
              .filter(Boolean)
          : [];
        ops.push(
          ...translateSubagentPhaseMarker(rec, {
            action: "add",
            addedPhases: addedDescriptions,
            toolCallId,
          }),
        );
        return ops;
      }
      // 其他 task_update action 不发 phase-marker；fall through 不进 batch（structural tool）
      return ops;
    }
    // 普通 tool（含 task_checkpoint，老路径子 agent 不特判 task_checkpoint）→ 进 subagent tool-batch
    ops.push(...translateSubagentToolStart(rec, toolCallId));
    return ops;
  }

  // ── Subagent 内部 tool result：仅写 toolCalls map，不动 segments（与 main 同形）──
  if (isToolResult && subagentId) {
    const status: "success" | "error" = data.error ? "error" : "success";
    const rawResult = data.result ?? data.output ?? data.content;
    const result = parseArgsField(rawResult) ?? (rawResult as Record<string, unknown> | undefined);
    ops.push({ type: "tool/result", toolCallId, result, status });
    return ops;
  }

  if (isToolStart) {
    const argsObj = parseArgsField(data.args);
    ops.push({
      type: "tool/start",
      toolCallId,
      toolName,
      args: argsObj,
    });
    if (round && messageId) {
      ops.push({
        type: "message/record-tool",
        roundId: round.id,
        messageId,
        toolName,
        toolCallId,
        isStructural: false, // STRUCTURAL_TOOL_NAMES 在 reducer 内做最终判定
      });
    }
    // task_create 在 args 阶段就有 plan（与老 chat-event-handler.ts:1366 一致）；
    // result 阶段再补一次 plan（stepId 完整版）。reducer 的 plansEqual 短路重复 set。
    // 兼容两种形态：args 直接是 plan（live 路径）/ args.plan 是 plan（history 嵌套）。
    if (toolName === "task_create" && round && argsObj) {
      const candidate = (argsObj.plan ?? argsObj) as Record<string, unknown>;
      if (candidate.groups || candidate.phases || candidate.steps) {
        // 在 translator 层做一次 normalize，让 reducer 接收的 plan 总是规范形态
        const normalized = normalizePlan(candidate as TaskPlan);
        if (normalized) {
          ops.push({ type: "task/set-plan", roundId: round.id, plan: normalized });
          // S4.4-T: phase-marker(create)——右栏顶部"📋 计划"标记
          if (messageId) {
            const phasesArr = (candidate as { phases?: unknown }).phases;
            const planPhaseCount = Array.isArray(phasesArr) ? phasesArr.length : undefined;
            ops.push({
              type: "segment/add-phase-marker",
              roundId: round.id,
              messageId,
              action: "create",
              payload: {
                planPhaseCount,
                toolCallId,
              },
            });
          }
        }
      }
    }
    // task_update 的 phase 推进信号在 args 阶段
    if (toolName === "task_update" && round && argsObj) {
      ops.push(
        ...translateTaskUpdateArgs(
          round.id,
          argsObj,
          messageId ? { messageId, toolCallId } : undefined,
          round.phaseStatuses?.length,
        ),
      );
    }
    // task_checkpoint 独立 tool（非 task_update.action）→ checkpoint UI + silence
    if (toolName === "task_checkpoint" && round && argsObj && argsObj.message) {
      const checkpointData: import("../model/chat.types").CheckpointData = {
        type: (argsObj.type as "confirm" | "suggest" | "warn") ?? "suggest",
        message: argsObj.message as string,
        options: Array.isArray(argsObj.options) ? (argsObj.options as string[]) : undefined,
      };
      ops.push({
        type: "task/checkpoint",
        roundId: round.id,
        phaseIndex: 0,
        data: checkpointData,
      });
      ops.push({ type: "round/checkpoint-silence", roundId: round.id });
    }
    return ops;
  }

  if (isToolResult) {
    const status: "success" | "error" = data.error ? "error" : "success";
    const rawResult = data.result ?? data.output ?? data.content;
    const result = parseArgsField(rawResult) ?? (rawResult as Record<string, unknown> | undefined);
    if (!knownToolCall) {
      ops.push({
        type: "tool/start",
        toolCallId,
        toolName,
        args: parseArgsField(data.args),
      });
    }
    ops.push({ type: "tool/result", toolCallId, result, status });
    // A result-only frame needs a synthetic start + one message association.
    // A known call only patches its existing row, even if activeMessageId moved.
    if (!knownToolCall && round && messageId) {
      const pending = round.pending.get(messageId);
      const seen = pending?.toolCallIds.includes(toolCallId);
      if (!seen) {
        ops.push({
          type: "message/record-tool",
          roundId: round.id,
          messageId,
          toolName,
          toolCallId,
          isStructural: false,
        });
      }
    }
    // task_create 的 plan 从 result 提取（老路径用 syncPlanFromToolResult），同样 normalize
    if (toolName === "task_create" && round) {
      const plan = extractPlanFromResult(rawResult);
      const normalized = normalizePlan(plan);
      if (normalized) ops.push({ type: "task/set-plan", roundId: round.id, plan: normalized });
    }
    // task_update 的 result 阶段也可能携带新 plan 快照（add_phases 后 backend 重发）
    if (toolName === "task_update" && round) {
      const plan = extractPlanFromResult(rawResult);
      const normalized = normalizePlan(plan);
      if (normalized) ops.push({ type: "task/set-plan", roundId: round.id, plan: normalized });
      // 兜底：args+result 同帧发时，args 分支 isToolStart=false 不走 translateTaskUpdateArgs，
      // result 分支补一次。reducer task/update-phase 幂等（status 已是目标值会短路），无副作用。
      const argsObj = parseArgsField(data.args);
      if (argsObj)
        ops.push(
          ...translateTaskUpdateArgs(
            round.id,
            argsObj,
            messageId ? { messageId, toolCallId } : undefined,
            round.phaseStatuses?.length,
          ),
        );
    }
    return ops;
  }

  return [];
}
