// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * 稳定 ID 派生工具（refactor-plan §11）。
 *
 * 不变性：
 *  - 同一逻辑实体在 live 和 history 路径下生成相同 ID
 *  - 跨页面刷新一致
 *  - 重复 dispatch 同一逻辑事件 → 派生同 ID → 幂等去重
 *  - 与老 store startRound 派生算法字节级一致（dual-write parity 前提）
 *
 * 使用命名空间风格（CLAUDE.md 编码规范）：
 *   import { ChatId } from "./chat.id";
 *   const rid = ChatId.round(sessionKey, 0);
 *   const mid = ChatId.message(rid, 2);
 *   const sid = ChatId.segment(rid, mid, "narration", 0);
 */

import { generateDeterministicUUID } from "../pure/text";

export type SegmentKindForId = "narration" | "tool-batch" | "phase-marker" | "subagent-card";

/** Round ID = deterministic UUID derived from `${sessionKey}-round-${roundIndex}` 种子。
 *  后端有 roundId 时优先后端。算法跟 chat.store.ts:344-348 完全一致。 */
function round(sessionKey: string, roundIndex: number): string {
  return generateDeterministicUUID(`${sessionKey}-round-${roundIndex}`);
}

/** Message ID = `${roundId}:msg-${messageIndex}`。后端 message.id 优先。 */
function message(roundId: string, messageIndex: number): string {
  return `${roundId}:msg-${messageIndex}`;
}

/** Segment ID = `${roundId}:${messageId}:${kind}:${seqInMessage}`。
 *  注：`${roundId}` 已存在于 `${messageId}` 中，但显式重复以便日志可读 + 直接定位。
 *  逻辑等价由 (messageId, kind, seqInMessage) 决定，roundId 是冗余前缀。 */
function segment(
  roundId: string,
  messageId: string,
  kind: SegmentKindForId,
  seqInMessage: number,
): string {
  return `${roundId}:${messageId}:${kind}:${seqInMessage}`;
}

/** Subagent 内部 segment ID。subagent 自身有独立 runId，segment 不归属任何 round。 */
function subagentSegment(
  subagentId: string,
  messageId: string,
  kind: SegmentKindForId,
  seqInMessage: number,
): string {
  return `${subagentId}:${messageId}:${kind}:${seqInMessage}`;
}

/** 解析 message ID 回 (roundId, messageIndex)，找不到时返回 null。
 *  仅用于诊断 / 测试，不在 reducer 路径使用。 */
function parseMessage(messageId: string): { roundId: string; messageIndex: number } | null {
  const m = messageId.match(/^(.+):msg-(\d+)$/);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { roundId: m[1], messageIndex: Number.parseInt(m[2], 10) };
}

// 注：roundId 为 deterministic UUID（不可逆），不再提供 parseRound。
// 历史路径若需要追溯 sessionKey/roundIndex，从 Round 字段直接读，不要试图反解 id。

export const ChatId = {
  round,
  message,
  segment,
  subagentSegment,
  parseMessage,
} as const;
