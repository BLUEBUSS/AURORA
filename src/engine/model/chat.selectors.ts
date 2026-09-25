// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * Chat refactor §10 派生 selectors。
 *
 * 全部纯函数 (state) => derived。组件订阅 selector 并依赖 zustand 浅比较短路。
 *
 * 命名空间风格（CLAUDE.md）：
 *   import { ChatSelect } from "./chat.selectors";
 *   const text = ChatSelect.conclusionText(round);
 *
 * 同时也按命名导出单函数以便 zustand 直接订阅：
 *   const text = useChatStore(state => selectConclusionText(round));
 */

import type { Segment } from "../contracts/cards";
import { phaseOfRound } from "./chat.reducer";
import {
  type ChatState,
  type Classification,
  type LeftCard,
  type MessageContribution,
  type MessageId,
  type Phase,
  type Round,
  type SubagentId,
  isPhaseStep,
} from "./chat.types";
import type { TaskPlan, TaskStep } from "../contracts/protocol";

// ── Phase 派生（薄包装，让选择器面也持有同一接口）───────────────────────

export function selectPhase(round: Round): Phase {
  return phaseOfRound(round);
}

// ── 文本派生：按 classification 聚合 contribution text ────────────────────

const CONCLUSION_CLASSIFICATIONS: ReadonlySet<Classification> = new Set<Classification>([
  "left-conclusion",
  "report-conclusion",
  "preplan-content",
]);

function joinContribTexts(
  contribs: MessageContribution[],
  field: "contentText" | "thinkingText",
): string {
  return contribs
    .map((c) => c[field])
    .filter((s) => s.length > 0)
    .join("\n\n");
}

function sortedContribs(round: Round, predicate: (c: MessageContribution) => boolean) {
  const arr: MessageContribution[] = [];
  for (const c of round.contributions.values()) {
    if (predicate(c)) arr.push(c);
  }
  // 按 finalizedAt 升序，相同时间用 messageId 字典序
  arr.sort((a, b) => {
    if (a.finalizedAt !== b.finalizedAt) return a.finalizedAt - b.finalizedAt;
    return a.messageId.localeCompare(b.messageId);
  });
  return arr;
}

/** v1.3 §20.11：仅报告阶段读 pending contentText 让 conclusion 流式可见；
 *  pre-plan / execution 一律不读 pending text 进 conclusion——
 *   - execution 期 text 分类未定（取决于 message 内是否出现 tool）
 *   - pre-plan 期 text 也未定（含 tool 归 thinking、无 tool 归 conclusion，要等 tool args 到达才能定）
 *  pre-plan 流式默认按 thinking 样式显示（v1.3 解法 E'）。 */
function pendingTextsForReport(round: Round): string[] {
  const out: string[] = [];
  for (const p of round.pending.values()) {
    if (p.phaseAtStart !== "report") continue;
    if (p.contentText) out.push(p.contentText);
  }
  return out;
}

/** v1.3 §20.11 解法 E': pre-plan 流式期间 pending 内容按 thinking 样式显示。
 *  v1.5 修订（用户反馈）: thinking 优先——有 thinking 就只用 thinking，无 thinking 才用 content。
 *  与老路径 chat-event-handler.ts:391-401 composeThinkingCardText 行为对齐。
 *  race condition（text 先到、tool 后到）下：pending 仅有 contentText 无 thinkingText
 *    → 取 contentText 显在 thinking 卡（保留 §20.12 race 修复）。
 *  message_end 后由 classify 决定升级（无 tool → conclusion）或维持（含 tool → thinking）。 */
function pendingPreplanAsThinking(round: Round): string[] {
  const out: string[] = [];
  for (const p of round.pending.values()) {
    if (p.phaseAtStart !== "pre-plan") continue;
    const text = p.thinkingText || p.contentText;
    if (text) out.push(text);
  }
  return out;
}

function pendingThinkingForReport(round: Round): string[] {
  const out: string[] = [];
  for (const p of round.pending.values()) {
    if (p.phaseAtStart !== "report") continue;
    if (p.thinkingText) out.push(p.thinkingText);
  }
  return out;
}

function joinNonEmpty(parts: string[]): string {
  return parts.filter((s) => s.length > 0).join("\n\n");
}

export function selectConclusionText(round: Round): string {
  const contribs = sortedContribs(round, (c) => CONCLUSION_CLASSIFICATIONS.has(c.classification));
  const base = joinContribTexts(contribs, "contentText");
  // v1.3: 仅 report 期读 pending 让流式可见；pre-plan 不读 pending（race condition 修法见 selectPreplanThinkingText）
  const pendingReport = pendingTextsForReport(round);
  return joinNonEmpty([base, ...pendingReport]);
}

export function selectPreplanThinkingText(round: Round): string {
  const contribs = sortedContribs(round, (c) => c.classification === "preplan-thinking");
  // v1.5: preplan-thinking 类别 contribution 文本可能在 thinkingText（来自 thinking）
  // 或 contentText（pre-plan + text + 含 tool 的 case）。
  // thinking 优先——有 thinking 就只用 thinking，无 thinking 才用 content（与老路径 composeThinkingCardText 对齐）。
  const base = contribs
    .map((c) => c.thinkingText || c.contentText)
    .filter((s) => s.length > 0)
    .join("\n\n");
  // v1.3 §20.11 + v1.5: pre-plan pending 按 thinking 优先规则显示
  const pending = pendingPreplanAsThinking(round);
  return joinNonEmpty([base, ...pending]);
}

export function selectReportThinkingText(round: Round): string {
  const contribs = sortedContribs(round, (c) => c.classification === "report-thinking");
  const base = joinContribTexts(contribs, "thinkingText");
  const pending = pendingThinkingForReport(round);
  return joinNonEmpty([base, ...pending]);
}

// ── 左侧 cards ──────────────────────────────────────────────────────────

function sourceMessageIds(
  round: Round,
  predicate: (c: MessageContribution) => boolean,
): MessageId[] {
  return sortedContribs(round, predicate).map((c) => c.messageId);
}

export function selectLeftCards(round: Round): LeftCard[] {
  const cards: LeftCard[] = [];

  const preplanText = selectPreplanThinkingText(round);
  if (preplanText.length > 0) {
    cards.push({
      kind: "preplan-thinking",
      text: preplanText,
      sourceMessageIds: sourceMessageIds(round, (c) => c.classification === "preplan-thinking"),
    });
  }

  if (round.task) {
    cards.push({ kind: "task", task: round.task });
  }

  const reportText = selectReportThinkingText(round);
  if (reportText.length > 0) {
    cards.push({
      kind: "report-thinking",
      text: reportText,
      sourceMessageIds: sourceMessageIds(round, (c) => c.classification === "report-thinking"),
    });
  }

  const conclusionText = selectConclusionText(round);
  if (conclusionText.length > 0) {
    cards.push({
      kind: "conclusion",
      text: conclusionText,
      sourceMessageIds: sourceMessageIds(round, (c) =>
        CONCLUSION_CLASSIFICATIONS.has(c.classification),
      ),
    });
  }

  return cards;
}

// ── 右侧 segments ───────────────────────────────────────────────────────

export function selectNarrationAndToolSegments(round: Round): Segment[] {
  // 主 agent 的 round.segments 已经只含主 agent 的段（subagent 内部段在 SubagentRecord 里）
  return round.segments;
}

export function selectSubagentSegments(state: ChatState, subagentId: SubagentId): Segment[] {
  return state.subagents.get(subagentId)?.segments ?? [];
}

// ── 流式中的活跃 message（用于右侧实时 narration 暂存）────────────────────

export function selectActiveStreamingMessage(round: Round) {
  if (!round.activeMessageId) return null;
  return round.pending.get(round.activeMessageId) ?? null;
}

export function selectIsStreaming(state: ChatState): boolean {
  if (!state.activeRoundId) return false;
  const idx = state.roundsById.get(state.activeRoundId);
  if (idx === undefined) return false;
  return state.rounds[idx]?.status === "streaming";
}

// ── Phase / step 辅助 ───────────────────────────────────────────────────

function flatPhaseSteps(plan: TaskPlan | undefined): TaskStep[] {
  if (!plan) return [];
  return (plan.groups ?? []).flatMap((g) => g.steps).filter(isPhaseStep);
}

export function selectAllPhasesDone(round: Round): boolean {
  const steps = flatPhaseSteps(round.task);
  if (steps.length === 0) return false;
  return steps.every((s) => s.status === "done" || s.status === "failed" || s.status === "skipped");
}

export function selectActivePhase(round: Round): TaskStep | null {
  const steps = flatPhaseSteps(round.task);
  return steps.find((s) => s.status === "running") ?? null;
}

// ── Round 查找快捷方法 ─────────────────────────────────────────────────

export function selectRoundById(state: ChatState, roundId: string): Round | null {
  const idx = state.roundsById.get(roundId);
  if (idx === undefined) return null;
  return state.rounds[idx] ?? null;
}

export function selectActiveRound(state: ChatState): Round | null {
  if (!state.activeRoundId) return null;
  return selectRoundById(state, state.activeRoundId);
}

// ── 命名空间导出（CLAUDE.md 风格） ────────────────────────────────────

export const ChatSelect = {
  phase: selectPhase,
  conclusionText: selectConclusionText,
  preplanThinkingText: selectPreplanThinkingText,
  reportThinkingText: selectReportThinkingText,
  leftCards: selectLeftCards,
  narrationAndToolSegments: selectNarrationAndToolSegments,
  subagentSegments: selectSubagentSegments,
  activeStreamingMessage: selectActiveStreamingMessage,
  isStreaming: selectIsStreaming,
  allPhasesDone: selectAllPhasesDone,
  activePhase: selectActivePhase,
  roundById: selectRoundById,
  activeRound: selectActiveRound,
} as const;
