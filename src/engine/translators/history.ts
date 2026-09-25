// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
import type { ChatOp } from "../model/chat.ops";
import type { SessionKey } from "../model/chat.types";
import { HistoryMessage, RoundCursor, buildUserMessage, emitFinalRoundComplete, emitRoundStart, extractTextContent, isSystemInjectedUserMessage, translateAssistantMessage, translateToolResultMessage } from "./history.message";


/** History payload → ChatOp[]。 */
export function historyToOps(messages: HistoryMessage[], sessionKey: SessionKey): ChatOp[] {
  const ops: ChatOp[] = [];
  const cursor: RoundCursor = {
    activeRoundId: null,
    nextRoundIndex: 0,
    messageCountInRound: 0,
  };
  const toolNameById: Record<string, string> = {};
  const toolArgsByCallId: Record<string, Record<string, unknown> | undefined> = {};
  let lastTs = 0;

  for (const msg of messages) {
    const role = (msg.role ?? "").toLowerCase();
    lastTs = msg.timestamp ?? lastTs;

    if (role === "user") {
      const userContent =
        extractTextContent(msg) || (typeof msg.content === "string" ? msg.content : "");
      if (isSystemInjectedUserMessage(userContent)) {
        // §20.4：system-injected user 不开新 round，但 roundIndex 仍 ++ 以与老 store 派生算法对齐
        cursor.nextRoundIndex++;
        continue;
      }
      // 真实 user → 收尾上一个 round（如有）
      if (cursor.activeRoundId) {
        ops.push(...emitFinalRoundComplete(cursor, lastTs));
      }
      const userMessage = buildUserMessage(msg);
      const { ops: startOps } = emitRoundStart(cursor, sessionKey, userMessage, msg.timestamp ?? 0);
      ops.push(...startOps);
      continue;
    }

    // 防御兜底：单条 message 翻译抛错（如 backend partial flush 让 normalizePlan / extractor 内部
    // 出现 unexpected shape）不应阻断整批 batch——记录 warn 后跳过该条，下一条继续翻译。
    // 实证 b1c39537 jsonl #12 task_create.args.phases 是截断 JSON string，老路径 normalizePlan
    // 在 string 上 .map() 抛 TypeError → applyOps 不被调用 → conclusion 卡空白 + 右栏卡片消失。
    if (role === "assistant") {
      try {
        ops.push(...translateAssistantMessage(msg, cursor, toolNameById, toolArgsByCallId));
      } catch (err) {
        console.warn("[historyToOps] translateAssistantMessage threw, skipping message", {
          messageId: msg.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    if (role === "tool" || role === "toolresult") {
      try {
        ops.push(...translateToolResultMessage(msg, toolNameById, toolArgsByCallId, cursor));
      } catch (err) {
        console.warn("[historyToOps] translateToolResultMessage threw, skipping message", {
          messageId: msg.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }
    // 其他 role 略过（system 等）
  }

  // 收尾最后一个 round
  ops.push(...emitFinalRoundComplete(cursor, lastTs));

  return ops;
}
export type { HistoryMessage, HistoryToolCall } from "./history.message";
export { historyToSubagentOps } from "./history.subagent";
