// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import { countPhaseSteps, normalizePlan } from "./_plan-normalize";
import { stripReasoningFormat } from "./_text-normalize";
import { translateTaskUpdateArgs } from "./live";
import { ChatId } from "../model/chat.id";
import type { ChatOp } from "../model/chat.ops";
import type { RoundId, SessionKey, SubagentId, ToolCallId } from "../model/chat.types";
import type { ChatMessage, TaskPlan } from "../contracts/protocol";



// ── 后端 history message shape（与 history-render.HistoryMessage 同形） ───

export interface HistoryMessage {
  id?: string;
  role?: string;
  content?: string | unknown[];
  text?: string;
  timestamp?: number;
  tool_calls?: HistoryToolCall[];
  toolCalls?: HistoryToolCall[];
  tool_call_id?: string;
  toolCallId?: string;
  name?: string;
  toolName?: string;
  thinkingText?: string;
  thinking_text?: string;
  result?: unknown;
  output?: unknown;
  /** 后端可能直接附 round id */
  roundId?: string;
  /** 用户消息可选附图 */
  attachments?: unknown;
  images?: unknown;
}


export interface HistoryToolCall {
  id?: string;
  toolCallId?: string;
  function?: { name?: string; arguments?: unknown };
  name?: string;
  toolName?: string;
  arguments?: unknown;
}


// ── system-injected user 检测（与 history-render isSystemInjectedRound 同形） ─

export const ANNOUNCE_REGEX =
  /\[System Message\][\s\S]*A subagent task ["“”][^"“”]+["“”]\s+(?:just\s+)?(?:completed successfully|timed out|failed|finished with unknown status)/;


export function isSystemInjectedUserMessage(content: string): boolean {
  if (ANNOUNCE_REGEX.test(content)) return true;
  if (content.startsWith("[Task Steering]")) return true;
  return false;
}


// ── 文本/工具 提取 ──────────────────────────────────────────────────────

export function extractTextContent(msg: HistoryMessage): string {
  if (typeof msg.text === "string" && msg.text) return msg.text;
  if (typeof msg.content === "string") return msg.content;
  if (!Array.isArray(msg.content)) return "";
  return msg.content
    .filter(
      (b): b is { type: string; text: string } =>
        typeof b === "object" &&
        b !== null &&
        (b as Record<string, unknown>).type === "text" &&
        typeof (b as Record<string, unknown>).text === "string",
    )
    .map((b) => b.text)
    .join("");
}


export function extractThinkingText(msg: HistoryMessage): string {
  // 与 live translator 一致：strip Reasoning: wrapper + _italic_ 标记（plan v1.5 §20.14 备忘）
  const direct = msg.thinkingText ?? msg.thinking_text;
  if (typeof direct === "string" && direct) return stripReasoningFormat(direct);
  if (!Array.isArray(msg.content)) return "";
  const joined = msg.content
    .filter(
      (b): b is { type: string; text?: string; thinking?: string } =>
        typeof b === "object" &&
        b !== null &&
        ((b as Record<string, unknown>).type === "thinking" ||
          (b as Record<string, unknown>).type === "reasoning"),
    )
    .map((b) => (typeof b.thinking === "string" ? b.thinking : (b.text ?? "")))
    .join("");
  return stripReasoningFormat(joined);
}


export interface ToolUseBlock {
  id: string;
  name: string;
  args?: Record<string, unknown>;
}


export function extractToolUses(msg: HistoryMessage): ToolUseBlock[] {
  const out: ToolUseBlock[] = [];

  // 1) flat tool_calls / toolCalls 数组
  const flat = msg.tool_calls ?? msg.toolCalls;
  if (Array.isArray(flat)) {
    for (const tc of flat) {
      const id = tc.id ?? tc.toolCallId;
      if (!id) continue;
      const fn = tc.function ?? tc;
      const name = fn.name ?? tc.name ?? tc.toolName ?? "";
      const rawArgs = fn.arguments ?? tc.arguments;
      out.push({ id, name, args: parseArgs(rawArgs) });
    }
  }

  // 2) content[].type === "tool_use" / "toolCall"
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if ((b.type === "tool_use" || b.type === "toolCall") && typeof b.id === "string") {
        out.push({
          id: b.id,
          name: (b.name as string) ?? "",
          args: parseArgs(b.input ?? b.arguments ?? b.args),
        });
      }
    }
  }
  return out;
}


export function parseArgs(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined) return undefined;
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


// ── plan 提取（task_create / task_update 的 args 或 result） ─────────────

export function extractPlanFromTool(tool: ToolUseBlock, result?: unknown): TaskPlan | null {
  if (tool.name !== "task_create" && tool.name !== "task_update") return null;
  // task_create：plan 在 args 里；task_update：plan 在 result 里（或 args）
  const fromArgs = (tool.args?.plan ?? tool.args) as unknown;
  const fromResult =
    result && typeof result === "object" ? (result as Record<string, unknown>).plan : undefined;
  const candidate = fromResult ?? fromArgs;
  if (!candidate || typeof candidate !== "object") return null;
  const plan = candidate as Record<string, unknown>;
  // 防御 backend 流式 partial flush：args.phases 可能是未完成的 JSON 字符串（实证 jsonl
  // b1c39537 #12 task_create.args.phases = "[{...}, ..."  截断字符串）。phases / groups / steps
  // 任一非 array 都视为无效 → 返回 null（避免 normalizePlan 在 string 上 .map() 抛 TypeError）。
  const hasValidPhases = Array.isArray(plan.phases) && plan.phases.length > 0;
  const hasValidGroups = Array.isArray(plan.groups) && plan.groups.length > 0;
  const hasValidSteps = Array.isArray(plan.steps) && plan.steps.length > 0;
  if (!hasValidPhases && !hasValidGroups && !hasValidSteps) return null;
  return plan as unknown as TaskPlan;
}


export function extractToolResultText(msg: HistoryMessage): Record<string, unknown> | undefined {
  const raw = msg.result ?? msg.output ?? extractTextContent(msg);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { text: raw };
    }
  }
  return undefined;
}


// ── 主入口 ───────────────────────────────────────────────────────────────

export interface RoundCursor {
  /** 当前活跃 round id（最近一条非 system-injected user 消息开启的） */
  activeRoundId: RoundId | null;
  /** roundIndex 从 0 开始单调 ++（system-injected user 也 ++ 但不开新 round） */
  nextRoundIndex: number;
  /** 当前 round 内已 emit 的 message 数（用于派生 messageId） */
  messageCountInRound: number;
  /** 当前任务计划的 phase 数量，用于校验历史 task_update 下标。 */
  phaseCount?: number;
}


export function emitRoundStart(
  cursor: RoundCursor,
  sessionKey: SessionKey,
  userMessage: ChatMessage,
  ts: number,
): { ops: ChatOp[]; roundId: RoundId } {
  const idx = cursor.nextRoundIndex++;
  const roundId = ChatId.round(sessionKey, idx);
  cursor.activeRoundId = roundId;
  cursor.messageCountInRound = 0;
  const op: ChatOp = {
    type: "round/start",
    roundId,
    userMessage,
    sessionKey,
    roundIndex: idx,
    timestamp: ts,
  };
  return { ops: [op], roundId };
}


export function buildUserMessage(msg: HistoryMessage): ChatMessage {
  const content = extractTextContent(msg) || (typeof msg.content === "string" ? msg.content : "");
  return {
    id: msg.id || `hist-u-${Math.random().toString(36).slice(2, 10)}`,
    role: "user",
    content,
    timestamp: msg.timestamp ?? 0,
  };
}


export function translateAssistantMessage(
  msg: HistoryMessage,
  cursor: RoundCursor,
  toolNameById: Record<string, string>,
  toolArgsByCallId: Record<string, Record<string, unknown> | undefined>,
): ChatOp[] {
  if (!cursor.activeRoundId) return []; // assistant 无 round 上下文，跳过
  const ops: ChatOp[] = [];
  const roundId = cursor.activeRoundId;
  const messageId = ChatId.message(roundId, cursor.messageCountInRound++);
  const ts = msg.timestamp ?? 0;

  ops.push({ type: "message/start", roundId, messageId, timestamp: ts });

  const thinking = extractThinkingText(msg);
  if (thinking) {
    ops.push({ type: "message/set-thinking", roundId, messageId, fullText: thinking });
  }

  const text = extractTextContent(msg);
  if (text) {
    ops.push({ type: "message/set-text", roundId, messageId, fullText: text });
  }

  // tool uses：record-tool + tool/start（结构性 tool 标记由 reducer 内 STRUCTURAL_TOOL_NAMES 兜底）
  const toolUses = extractToolUses(msg);
  for (const tu of toolUses) {
    toolNameById[tu.id] = tu.name;
    toolArgsByCallId[tu.id] = tu.args;
    ops.push({
      type: "message/record-tool",
      roundId,
      messageId,
      toolName: tu.name,
      toolCallId: tu.id,
      isStructural: false,
    });
    ops.push({ type: "tool/start", toolCallId: tu.id, toolName: tu.name, args: tu.args });
  }

  ops.push({ type: "message/end", roundId, messageId, timestamp: ts });

  // 提取 task_create / task_update plan（args 在 tool_use block 里），normalize 后 emit。
  // op 顺序保证：message_end 之后 → task/set-plan → task/update-phase → 下一条 message_start
  // 这样下一条 message 的 phaseAtStart snapshot 反映最新 phase 状态（plan v1.8 §3.4 不变性）。
  // S4.4-T: task_create 同时 emit phase-marker(create) 段
  for (const tu of toolUses) {
    if (tu.name === "task_create") {
      const plan = extractPlanFromTool(tu);
      const normalized = normalizePlan(plan);
      if (normalized) {
        ops.push({ type: "task/set-plan", roundId, plan: normalized });
        const phaseCount = countPhaseSteps(normalized);
        cursor.phaseCount = phaseCount > 0 ? phaseCount : undefined;
        const phasesArr = (tu.args as { plan?: { phases?: unknown }; phases?: unknown } | undefined)
          ?.plan
          ? ((tu.args as { plan?: { phases?: unknown } }).plan?.phases as unknown)
          : (tu.args?.phases as unknown);
        const planPhaseCount = Array.isArray(phasesArr) ? phasesArr.length : undefined;
        ops.push({
          type: "segment/add-phase-marker",
          roundId,
          messageId,
          action: "create",
          payload: { planPhaseCount, toolCallId: tu.id },
        });
      }
    } else if (tu.name === "task_update") {
      const plan = extractPlanFromTool(tu);
      const normalized = normalizePlan(plan);
      if (normalized) {
        ops.push({ type: "task/set-plan", roundId, plan: normalized });
        const phaseCount = countPhaseSteps(normalized);
        cursor.phaseCount = phaseCount > 0 ? phaseCount : undefined;
      }
    }
  }

  // 翻译 task_update.action（complete_phase / fail_phase / skip_phase / add_phases）
  // 让 phaseStatuses 在历史重放后正确推进 → phaseOfRound 派生正确 → 后续 message phaseAtStart
  // 反映真实 phase 状态。task_checkpoint 不在 history 翻译（避免 round/checkpoint-silence 让历史
  // 重放时 silence 后续 set-text 跳过）。
  // S4.4-T: 同时 emit phase-marker(complete/fail/skip/add) 段
  for (const tu of toolUses) {
    if (tu.name !== "task_update" || !tu.args) continue;
    ops.push(
      ...translateTaskUpdateArgs(
        roundId,
        tu.args,
        { messageId, toolCallId: tu.id },
        cursor.phaseCount,
      ),
    );
  }

  // sessions_spawn 不在 assistant message 阶段 emit subagent/spawn——
  //   tu.id 是 tool call id（不是 subagent runId），用它作占位会让 reducer 创建一条
  //   "假的" SubagentRecord（无 childSessionKey、label=callId 长字符串），后续 toolResult
  //   翻译用真实 runId emit spawn 时 reducer 看到 subagentId 不同认为是新 record，结果
  //   chatV2.subagents 同 sub-agent 留下两条记录：
  //     - callId record：缺 childSessionKey → drill-down 视图报"缺少 childSessionKey"
  //     - runId record：正常 record
  //   主视图右栏 subagent-card segment 派生两次（每条 record 一个 card）。
  // 修法（2026-05-20）：跟 live 路径对齐——只在 toolResult 翻译（拿到真实 runId 与
  //   childSessionKey）时 emit 一次 subagent/spawn。assistant message 阶段不 emit。
  //   边角 case：sessions_spawn 失败时 backend 仍会写 toolResult（含 error），阶段 2
  //   同样能处理；tool 完全没 result 的极端中断场景下子 agent 不显示，符合"无 transcript"语义。

  return ops;
}


export function translateToolResultMessage(
  msg: HistoryMessage,
  toolNameById: Record<string, string>,
  toolArgsByCallId: Record<string, Record<string, unknown> | undefined>,
  cursor: RoundCursor,
): ChatOp[] {
  const callId = msg.tool_call_id ?? msg.toolCallId;
  if (!callId) return [];
  const result = extractToolResultText(msg);
  const ops: ChatOp[] = [
    { type: "tool/result", toolCallId: callId as ToolCallId, status: "success", result },
  ];

  // 若是 task_create / task_update：从 result 里再尝试拉一次 plan，normalize 后 emit
  const toolName = toolNameById[callId];
  if ((toolName === "task_create" || toolName === "task_update") && cursor.activeRoundId) {
    const planFromResult =
      result && typeof result === "object"
        ? ((result as Record<string, unknown>).plan as TaskPlan | undefined)
        : undefined;
    const normalized = normalizePlan(planFromResult);
    if (normalized) {
      ops.push({ type: "task/set-plan", roundId: cursor.activeRoundId, plan: normalized });
      const phaseCount = countPhaseSteps(normalized);
      cursor.phaseCount = phaseCount > 0 ? phaseCount : undefined;
    }
  }

  // 若是 sessions_spawn：从 result 提真实 runId 注册唯一一条 SubagentRecord（详见
  // translateAssistantMessage 注释）。label 优先级：
  //   1. tool_use args.label —— 这是 model 调用 sessions_spawn 时的 label 参数（通常中文，
  //      跟用户 UI 显示对齐）
  //   2. tool result details.label —— backend 默认 label（通常英文 agentId）
  //   3. tool result details.agentId / runId 兜底
  // 不优先 args.label 会让历史会话刷新后右栏 subagent-card 显示英文 agentId（live 期间是中文）。
  if (toolName === "sessions_spawn" && cursor.activeRoundId) {
    // jsonl 里 sessions_spawn 的 toolResult 是**平铺结构**——runId / childSessionKey / label
    // 直接在 result 顶层（实测 37f7f842 jsonl line 15/16）。早期版本可能嵌套在 .details 下，
    // 兼容两种 schema：先读 .details，否则 fallback 用 result 顶层。
    const fromDetails =
      result && typeof result === "object"
        ? ((result as Record<string, unknown>).details as Record<string, unknown> | undefined)
        : undefined;
    const details = fromDetails ?? (result as Record<string, unknown> | undefined);
    const runId = details?.runId as SubagentId | undefined;
    if (runId) {
      const args = toolArgsByCallId[callId];
      const argsLabel =
        (args?.label as string | undefined) ?? (args?.agentId as string | undefined);
      const label =
        argsLabel ??
        (details?.label as string | undefined) ??
        (details?.agentId as string | undefined) ??
        runId;
      const childSessionKey = details?.childSessionKey as SessionKey | undefined;
      ops.push({
        type: "subagent/spawn",
        parentRoundId: cursor.activeRoundId,
        subagentId: runId,
        label,
        childSessionKey,
        timestamp: msg.timestamp ?? 0,
      });
    }
  }

  return ops;
}


export function emitFinalRoundComplete(cursor: RoundCursor, lastTs: number): ChatOp[] {
  if (!cursor.activeRoundId) return [];
  return [
    { type: "round/complete", roundId: cursor.activeRoundId, status: "done", timestamp: lastTs },
  ];
}
