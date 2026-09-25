// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * chat.reducer 内部子 reducer。
 * 公开入口在 chat.reducer.ts；本文件只输出辅助函数与 helper utilities，不构成对外 API。
 */

import type {
  NarrationSegment,
  PhaseMarkerSegment,
  Segment,
  ToolBatchSegment,
} from "../contracts/cards";
import { ChatId } from "./chat.id";
import { isMergeablePhaseAction, mergePhaseIndexValues } from "./chat.merge-helpers";
import type { ChatOp } from "./chat.ops";
import {
  type ChatState,
  type MessageContribution,
  type PendingMessage,
  type Round,
  type RoundId,
  type SubagentId,
  type SubagentRecord,
  isPhaseStep,
} from "./chat.types";
import type { TaskPlan, ToolCallData } from "../contracts/protocol";

// ── 不可变更新 helpers ─────────────────────────────────────────────────────

export function getRound(state: ChatState, roundId: RoundId): Round | null {
  const idx = state.roundsById.get(roundId);
  if (idx === undefined) return null;
  return state.rounds[idx] ?? null;
}

export function withRound(
  state: ChatState,
  roundId: RoundId,
  mutator: (round: Round) => Round,
): ChatState {
  const idx = state.roundsById.get(roundId);
  if (idx === undefined) return state;
  const prev = state.rounds[idx];
  if (!prev) return state;
  const next = mutator(prev);
  if (next === prev) return state;
  const rounds = state.rounds.slice();
  rounds[idx] = next;
  return { ...state, rounds };
}

export function withSubagent(
  state: ChatState,
  subagentId: SubagentId,
  mutator: (rec: SubagentRecord) => SubagentRecord,
): ChatState {
  const prev = state.subagents.get(subagentId);
  if (!prev) return state;
  const next = mutator(prev);
  if (next === prev) return state;
  const subagents = new Map(state.subagents);
  subagents.set(subagentId, next);
  return { ...state, subagents };
}

export function freezeContribution(c: MessageContribution): MessageContribution {
  // v1.4: contentText/thinkingText 是 immutable string，无需深拷贝；只防御性拷 toolCallIds
  return {
    ...c,
    toolCallIds: [...c.toolCallIds],
  };
}

export function makePending(
  messageId: string,
  ts: number,
  phaseAtStart: import("./chat.types").Phase,
): PendingMessage {
  return {
    messageId,
    startedAt: ts,
    contentText: "",
    thinkingText: "",
    toolCallIds: [],
    toolNamesSeen: new Set<string>(),
    hasStructuralTool: false,
    phaseAtStart,
  };
}

export function nextSegmentSeq(round: Round, kind: string): number {
  return round.segmentSeqByKind.get(kind) ?? 0;
}

export function withSegmentSeqIncremented(round: Round, kind: string): Map<string, number> {
  const next = new Map(round.segmentSeqByKind);
  next.set(kind, (next.get(kind) ?? 0) + 1);
  return next;
}

export const STRUCTURAL_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  "task_create",
  "task_update",
  "sessions_spawn",
  "subagents",
  "task_checkpoint",
]);

// ── Task 子 reducers ────────────────────────────────────────────────────

export function reduceTaskSetPlan(
  state: ChatState,
  op: Extract<ChatOp, { type: "task/set-plan" }>,
): ChatState {
  // 注意：op.plan 应已在 translator 层经过 normalizePlan，含 groups + phase- id steps
  return withRound(state, op.roundId, (r) => {
    const expectedLen = countPhases(op.plan);
    const planInitial = derivePlanInitialStatuses(op.plan);
    const current = r.phaseStatuses ?? [];

    // phaseStatuses 只扩展，永不缩短（v1.7 撤回教训：plan 形态切换会让 phaseStatuses 被空覆盖）
    let newStatuses: import("./chat.types").PhaseStatus[];
    if (expectedLen <= current.length) {
      // 不缩短：保留 current。但若 current 末尾是 pending 而 planInitial 提供了非 pending → 用 plan 提供的
      newStatuses = current.map((s, i) =>
        s === "pending" && planInitial[i] && planInitial[i] !== "pending" ? planInitial[i]! : s,
      );
    } else {
      // 扩展：保留前 N 个 current，后面用 planInitial 填充
      newStatuses = [...current];
      while (newStatuses.length < expectedLen) {
        const i = newStatuses.length;
        newStatuses.push(planInitial[i] ?? "pending");
      }
    }

    const planSame = !!r.task && plansEqual(r.task, op.plan);
    const statusesSame =
      newStatuses.length === current.length && newStatuses.every((s, i) => s === current[i]);
    if (planSame && statusesSame) return r;
    return { ...r, task: op.plan, phaseStatuses: newStatuses };
  });
}

export function countPhases(plan: TaskPlan): number {
  if (!plan.groups) return 0;
  let total = 0;
  for (const g of plan.groups) {
    for (const s of g.steps) {
      if (isPhaseStep(s)) total++;
    }
  }
  return total;
}

function derivePlanInitialStatuses(plan: TaskPlan): import("./chat.types").PhaseStatus[] {
  if (!plan.groups) return [];
  const out: import("./chat.types").PhaseStatus[] = [];
  for (const g of plan.groups) {
    for (const s of g.steps) {
      if (isPhaseStep(s)) {
        out.push(toPhaseStatusInternal(s.status));
      }
    }
  }
  return out;
}

function toPhaseStatusInternal(s: string | undefined): import("./chat.types").PhaseStatus {
  if (s === "running" || s === "done" || s === "failed" || s === "skipped") return s;
  if (s === "paused") return "running";
  return "pending";
}

function plansEqual(a: TaskPlan, b: TaskPlan): boolean {
  if (a === b) return true;
  if (a.id !== b.id) return false;
  if (a.title !== b.title) return false;
  const ag = a.groups ?? [];
  const bg = b.groups ?? [];
  if (ag.length !== bg.length) return false;
  for (let i = 0; i < ag.length; i++) {
    const ai = ag[i];
    const bi = bg[i];
    if (!ai || !bi) return false;
    if (ai.steps.length !== bi.steps.length) return false;
  }
  return true;
}

export function reduceTaskUpdatePhase(
  state: ChatState,
  op: Extract<ChatOp, { type: "task/update-phase" }>,
): ChatState {
  return withRound(state, op.roundId, (r) => {
    if (!r.task) return r;
    if (op.phaseIndex < 0) return r;

    // 写 phaseStatuses（独立字段）
    const current = r.phaseStatuses ?? [];
    const planPhaseCount = countPhases(r.task);
    const phaseCount = planPhaseCount > 0 ? planPhaseCount : current.length;
    // phase_index 是 0-based。错误输入不能扩展状态数组，否则会出现
    // 左侧 1/5、右侧“任务 6”这种跨组件状态分裂。
    if (op.phaseIndex >= phaseCount) return r;
    const newStatuses = [...current];
    while (newStatuses.length < phaseCount) newStatuses.push("pending");
    const newStatus = toPhaseStatusInternal(op.status);
    const phaseStatusChanged = newStatuses[op.phaseIndex] !== newStatus;
    if (phaseStatusChanged) newStatuses[op.phaseIndex] = newStatus;

    // 同时同步 plan.groups[].steps[].status（保持 plan 与 phaseStatuses 一致）
    let nextTask = r.task;
    if (r.task.groups) {
      let cursor = 0;
      let planTouched = false;
      const newGroups = r.task.groups.map((g) => {
        const newSteps = g.steps.map((s) => {
          if (!isPhaseStep(s)) return s;
          if (cursor === op.phaseIndex) {
            planTouched = true;
            cursor++;
            return op.status === "paused"
              ? { ...s, status: "running" as const }
              : { ...s, status: op.status, output_summary: op.result ?? s.output_summary };
          }
          cursor++;
          return s;
        });
        return { ...g, steps: newSteps };
      });
      if (planTouched) nextTask = { ...r.task, groups: newGroups };
    }

    if (!phaseStatusChanged && nextTask === r.task) return r;
    return { ...r, task: nextTask, phaseStatuses: newStatuses };
  });
}

export function reduceTaskAddPhases(
  state: ChatState,
  op: Extract<ChatOp, { type: "task/add-phases" }>,
): ChatState {
  if (op.addedPhases.length === 0) return state;
  return withRound(state, op.roundId, (r) => {
    if (!r.task) return r;
    // 末尾扩展 phaseStatuses
    const currentStatuses = r.phaseStatuses ?? [];
    const newStatuses = [...currentStatuses];
    for (const p of op.addedPhases) {
      newStatuses.push(toPhaseStatusInternal(p.status));
    }
    // 同时 append plan.groups 末尾保持一致
    const groups = r.task.groups ?? [];
    const lastIdx = groups.length - 1;
    if (lastIdx < 0) {
      return {
        ...r,
        task: {
          ...r.task,
          groups: [{ id: "added", title: "新增任务", type: "serial", steps: op.addedPhases }],
        },
        phaseStatuses: newStatuses,
      };
    }
    const lastGroup = groups[lastIdx];
    if (!lastGroup) return r;
    const newGroups = groups.slice();
    newGroups[lastIdx] = {
      ...lastGroup,
      steps: [...lastGroup.steps, ...op.addedPhases],
    };
    return { ...r, task: { ...r.task, groups: newGroups }, phaseStatuses: newStatuses };
  });
}

export function reduceTaskCheckpoint(
  state: ChatState,
  op: Extract<ChatOp, { type: "task/checkpoint" }>,
): ChatState {
  return withRound(state, op.roundId, (r) => {
    // 路径 1: 已有 task → 写 checkpoint string + checkpointData 结构化
    if (r.task) {
      return {
        ...r,
        task: { ...r.task, checkpoint: op.data.message },
        checkpointData: op.data,
      };
    }
    // 路径 2: 前置澄清场景（task_create 之前）→ placeholder task
    return {
      ...r,
      task: { title: "需求澄清", groups: [], phases: [], checkpoint: op.data.message },
      phaseStatuses: [],
      checkpointData: op.data,
    };
  });
}

// ── Sub-agent 子 reducers ───────────────────────────────────────────────

export function reduceSubagentSpawn(
  state: ChatState,
  op: Extract<ChatOp, { type: "subagent/spawn" }>,
): ChatState {
  const existing = state.subagents.get(op.subagentId);
  if (existing) {
    // 单调合并（monotonic merge）：op 仅补全 existing 中"未设"（undefined）的字段，
    // 不覆盖已设字段。这是通用 race 防御：
    //   - tool/start 走 ensureSubagentSpawnOps 用 broadcast payload 信息创建 record（可能
    //     缺 childSessionKey，因为 tool event payload 没这个字段）
    //   - 随后 lifecycle.start 携带 childSessionKey 重新 dispatch spawn → 单调合并补 undefined 字段
    //   - 反向 race（lifecycle.start 先到，tool 后到）：existing 已有 childSessionKey → 不覆盖
    // 不依赖任何 fallback pattern matching（如 subId.slice(-8)），跟调用方实现解耦。
    // Label 不做合并升级：first-seen wins。如调用方用了不准确 label，应在调用方修正而不是
    // 让 reducer 启发式判断什么 label 算"假的"——后者会随 fallback 实现细节漂移。
    const needsChildSessionKey =
      op.childSessionKey !== undefined && existing.childSessionKey === undefined;
    if (!needsChildSessionKey) return state;
    const updated: SubagentRecord = {
      ...existing,
      childSessionKey: op.childSessionKey,
    };
    const subagents = new Map(state.subagents);
    subagents.set(op.subagentId, updated);
    return { ...state, subagents };
  }
  const rec: SubagentRecord = {
    id: op.subagentId,
    parentRoundId: op.parentRoundId,
    label: op.label,
    status: "pending",
    childSessionKey: op.childSessionKey,
    segments: [],
    startedAt: op.timestamp,
    pendingThinking: undefined,
    openBatchId: null,
    activeMessageIndex: 0,
    segmentSeqByKind: new Map(),
  };
  const subagents = new Map(state.subagents);
  subagents.set(op.subagentId, rec);
  return { ...state, subagents };
}

/** Drill-down lazy load 触发的 reset：清空 sub-agent 瞬时 state，保留 spawn 元数据。
 *  详见 SubagentResetStateOp 注释。 */
export function reduceSubagentResetState(
  state: ChatState,
  op: Extract<ChatOp, { type: "subagent/reset-state" }>,
): ChatState {
  return withSubagent(state, op.subagentId, (rec) => ({
    ...rec,
    segments: [],
    activeMessageIndex: 0,
    segmentSeqByKind: new Map(),
    pendingThinking: undefined,
    openBatchId: null,
  }));
}

/** S4.5-T mirror 老路径 closeOpenSubagentBatch + 推 message 边界。
 *  reducer 行为：close openBatchId（设回 null）+ activeMessageIndex++ + 清空 segmentSeqByKind
 *  （seq 是 per-message 计数）。
 *  幂等保证：每次 backend message_start 都触发，活跃 batch 即时关闭。 */
export function reduceSubagentMessageStart(
  state: ChatState,
  op: Extract<ChatOp, { type: "subagent/message-start" }>,
): ChatState {
  return withSubagent(state, op.subagentId, (rec) => ({
    ...rec,
    openBatchId: null,
    // pendingThinking 不在 message-start 清——保留到 tool-start flush 或 text 到达 clear
    activeMessageIndex: rec.activeMessageIndex + 1,
    segmentSeqByKind: new Map(),
  }));
}

/** S4.5-T pending thinking 控制 op 的 reducer。
 *  - set：覆盖式写入 pendingThinking（mirror 老 pendingSubagentThinking.set）
 *  - clear：text 到达时清掉，保证 flush 触发 ⟺ 本 message 真的无 text
 *  - flush：tool-start 触发；若 pendingThinking 非空 → 派生 narration with isThinkingFallback=true，
 *           segment id = `${subagentId}:${activeMessageIndex}:narration:${seq}`，
 *           bump seq, openBatchId 设 null，pendingThinking 清空。 */
export function reduceSubagentPendingThinking(
  state: ChatState,
  op: Extract<ChatOp, { type: "subagent/pending-thinking" }>,
): ChatState {
  return withSubagent(state, op.subagentId, (rec) => {
    if (op.action === "set") {
      const text = op.text ?? "";
      if (text === (rec.pendingThinking ?? "")) return rec; // 幂等短路
      return { ...rec, pendingThinking: text };
    }
    if (op.action === "clear") {
      if (!rec.pendingThinking) return rec;
      return { ...rec, pendingThinking: undefined };
    }
    // flush：仅当 pendingThinking 非空时派生 thinking-fallback narration
    const pending = rec.pendingThinking ?? "";
    if (!pending) return rec;
    const kind = "narration";
    const seq = rec.segmentSeqByKind.get(kind) ?? 0;
    const segmentId = `${rec.id}:${rec.activeMessageIndex}:${kind}:${seq}`;
    const ts = op.timestamp ?? Date.now();
    const fallback: NarrationSegment = {
      kind: "narration",
      id: segmentId,
      text: pending,
      startedAt: ts,
      isThinkingFallback: true,
      context: { phaseIndex: undefined, subagentId: rec.id },
    };
    const newSeqMap = new Map(rec.segmentSeqByKind);
    newSeqMap.set(kind, seq + 1);
    return {
      ...rec,
      segments: [...rec.segments, fallback],
      segmentSeqByKind: newSeqMap,
      openBatchId: null,
      pendingThinking: undefined,
    };
  });
}

/** S4.5-T 改造：subagent/append-segment 在新 push 时除了写 segments 还要：
 *  1. bump segmentSeqByKind[kind]（为下一段派生 id 做准备）
 *  2. 根据 kind 维护 openBatchId（tool-batch 新 push → 设；narration / phase-marker / subagent-card 新 push → 清）
 *  patch（findIndex 命中）路径不动 seq / openBatchId——纯属内容更新。 */
export function reduceSubagentAppendSegment(
  state: ChatState,
  op: Extract<ChatOp, { type: "subagent/append-segment" }>,
): ChatState {
  return withSubagent(state, op.subagentId, (rec) => {
    const idx = rec.segments.findIndex((s) => s.id === op.segment.id);
    if (idx >= 0) {
      const segments = rec.segments.slice();
      segments[idx] = op.segment;
      return { ...rec, segments };
    }
    // 新 push：bump seq + 维护 openBatchId
    const kind = op.segment.kind;
    const newSeqMap = new Map(rec.segmentSeqByKind);
    const currentSeq = newSeqMap.get(kind) ?? 0;
    newSeqMap.set(kind, currentSeq + 1);
    let openBatchId: string | null = rec.openBatchId ?? null;
    if (kind === "tool-batch") {
      openBatchId = op.segment.id;
    } else if (kind === "narration" || kind === "phase-marker" || kind === "subagent-card") {
      openBatchId = null;
    }
    return {
      ...rec,
      segments: [...rec.segments, op.segment],
      segmentSeqByKind: newSeqMap,
      openBatchId,
    };
  });
}

export function reduceSubagentUpdateStatus(
  state: ChatState,
  op: Extract<ChatOp, { type: "subagent/update-status" }>,
): ChatState {
  return withSubagent(state, op.subagentId, (rec) => ({
    ...rec,
    status: op.status,
    currentTool: op.currentTool ?? rec.currentTool,
  }));
}

export function reduceSubagentLifecycleEnd(
  state: ChatState,
  op: Extract<ChatOp, { type: "subagent/lifecycle-end" }>,
): ChatState {
  return withSubagent(state, op.subagentId, (rec) => ({
    ...rec,
    status: op.status,
    completedAt: op.timestamp,
  }));
}

// ── Segment direct（history-only）子 reducers ──────────────────────────

export function reduceSegmentAppendNarration(
  state: ChatState,
  op: Extract<ChatOp, { type: "segment/append-narration" }>,
): ChatState {
  return withRound(state, op.roundId, (r) => {
    const seq = nextSegmentSeq(r, "narration");
    const segId = ChatId.segment(r.id, op.messageId, "narration", seq);
    const idx = r.segments.findIndex((s) => s.id === segId);
    if (idx >= 0) {
      const prev = r.segments[idx];
      if (!prev || prev.kind !== "narration") return r;
      const segments = r.segments.slice();
      segments[idx] = { ...prev, text: prev.text + op.text };
      return { ...r, segments };
    }
    const narration: NarrationSegment = {
      kind: "narration",
      id: segId,
      text: op.text,
      startedAt: Date.now(),
      context: { phaseIndex: undefined, subagentId: undefined },
    };
    return {
      ...r,
      segments: [...r.segments, narration],
      segmentSeqByKind: withSegmentSeqIncremented(r, "narration"),
    };
  });
}

export function reduceSegmentCloseBatch(
  state: ChatState,
  op: Extract<ChatOp, { type: "segment/close-batch" }>,
): ChatState {
  return withRound(state, op.roundId, (r) => {
    const seq = nextSegmentSeq(r, "tool-batch");
    const segId = ChatId.segment(r.id, op.messageId, "tool-batch", seq);
    if (r.segments.some((s) => s.id === segId)) return r;
    const pending = r.pending.get(op.messageId);
    const toolCallIds = pending?.toolCallIds ?? [];
    const batch: ToolBatchSegment = {
      kind: "tool-batch",
      id: segId,
      toolCallIds: [...toolCallIds],
      startedAt: Date.now(),
      context: { phaseIndex: undefined, subagentId: undefined },
    };
    return {
      ...r,
      segments: [...r.segments, batch],
      segmentSeqByKind: withSegmentSeqIncremented(r, "tool-batch"),
    };
  });
}

export function reduceSegmentAddPhaseMarker(
  state: ChatState,
  op: Extract<ChatOp, { type: "segment/add-phase-marker" }>,
): ChatState {
  return withRound(state, op.roundId, (r) => {
    // ── 合并启发式（mirror 老 segment-builder.ts:281-298 recordPhaseMarker）──
    // 相邻 same-action mergeable（complete / fail / skip）+ phaseIndex 是单值 → patch last
    // segment：phaseIndex 合并成数组（去重升序）+ summaries 累加。不 bump seq。
    //
    // 修法背景：S4.4-T 漏了合并启发式 → 每次 emit 都新段 → history 重放 N 个相邻 complete
    // 时新 path 段数 > 老 path（老 path 在 segment-builder 端合并），刷新后 parity 报
    // segment-kind-divergence kind=phase-marker。
    //
    // 跟 subagent 路径 translateSubagentPhaseMarker 共用 stores/chat.merge-helpers。
    const last = r.segments[r.segments.length - 1];
    if (
      isMergeablePhaseAction(op.action) &&
      last &&
      last.kind === "phase-marker" &&
      last.action === op.action &&
      typeof op.phaseIndex === "number"
    ) {
      const newPhaseIndex = mergePhaseIndexValues(last.phaseIndex, op.phaseIndex);
      const newSummaries = [...(last.summaries ?? [])];
      if (op.payload.summaries) newSummaries.push(...op.payload.summaries);
      const patched: PhaseMarkerSegment = {
        ...last,
        phaseIndex: newPhaseIndex,
        summaries: newSummaries.length > 0 ? newSummaries : undefined,
      };
      const segments = r.segments.slice();
      segments[segments.length - 1] = patched;
      return { ...r, segments }; // 不 bump seq——patch 不消耗新 seq
    }

    // 否则：新 push（原逻辑）
    const seq = nextSegmentSeq(r, "phase-marker");
    const segId = ChatId.segment(r.id, op.messageId, "phase-marker", seq);
    if (r.segments.some((s) => s.id === segId)) return r;
    // startedAt 用对应 message 的时间序而不是 reducer 处理时刻——task_create / task_update
    // 的 tool/result event 通常比同 round 后续 message 的 chat:delta narration 后到达 frontend，
    // 用 Date.now() 会让 phase-marker 排在后面，渲染时 "计划生成: X 个任务" 被业务工具卡片
    // 顶到下方。改用 pending.startedAt（still in-flight）/ contribution.finalizedAt（已 finalize）/
    // 最后回退 Date.now()。同 message 内 narration / tool-batch 段也用 pending.startedAt，时序一致。
    const pendingMsg = r.pending.get(op.messageId);
    const finalizedContrib = r.contributions.get(op.messageId);
    const messageStartedAt = pendingMsg?.startedAt ?? finalizedContrib?.finalizedAt ?? Date.now();
    const marker: Segment = {
      kind: "phase-marker",
      id: segId,
      action: op.action,
      phaseIndex: op.phaseIndex,
      summaries: op.payload.summaries,
      addedPhases: op.payload.addedPhases,
      planPhaseCount: op.payload.planPhaseCount,
      toolCallId: op.payload.toolCallId,
      startedAt: messageStartedAt,
      context: { phaseIndex: undefined, subagentId: undefined },
    };
    return {
      ...r,
      segments: [...r.segments, marker],
      segmentSeqByKind: withSegmentSeqIncremented(r, "phase-marker"),
    };
  });
}

// ── Tool 子 reducers ────────────────────────────────────────────────────

export function reduceToolStart(
  state: ChatState,
  op: Extract<ChatOp, { type: "tool/start" }>,
): ChatState {
  if (state.toolCalls.has(op.toolCallId)) return state;
  const data: ToolCallData = {
    callId: op.toolCallId,
    toolName: op.toolName,
    status: "running",
    params: op.args,
    startedAt: Date.now(),
  };
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(op.toolCallId, data);
  return { ...state, toolCalls };
}

export function reduceToolResult(
  state: ChatState,
  op: Extract<ChatOp, { type: "tool/result" }>,
): ChatState {
  const prev = state.toolCalls.get(op.toolCallId);
  if (!prev) return state;
  const next: ToolCallData = {
    ...prev,
    status: op.status,
    result: op.result,
    completedAt: Date.now(),
  };
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(op.toolCallId, next);
  return { ...state, toolCalls };
}

export function reduceToolProvenancePatch(
  state: ChatState,
  op: Extract<ChatOp, { type: "tool/provenance-patch" }>,
): ChatState {
  const prev = state.toolCalls.get(op.toolCallId);
  if (!prev) return state;
  const next: ToolCallData = {
    ...prev,
    result: { ...prev.result, ...op.patch },
  };
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(op.toolCallId, next);
  return { ...state, toolCalls };
}

// ── Contribution rewrite（受限）─────────────────────────────────────────

export function reduceContributionRewrite(
  state: ChatState,
  op: Extract<ChatOp, { type: "contribution/rewrite-text" }>,
): ChatState {
  return withRound(state, op.roundId, (r) => {
    const candidates = [op.messageId, `${op.messageId}:text`];
    for (const key of candidates) {
      const c = r.contributions.get(key);
      if (!c) continue;
      const newContribs = new Map(r.contributions);
      newContribs.set(key, freezeContribution({ ...c, contentText: op.newText }));
      return { ...r, contributions: newContribs };
    }
    return r;
  });
}
