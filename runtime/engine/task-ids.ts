// Adapted from ANLYST/OpenClaw (MIT). See docs/licenses/OpenClaw-MIT.txt.
let planSeq = 1;
let groupSeq = 1;
let stepSeq = 1;

/**
 * 从 sessionKey 提取 sessionId（最后一段）
 * sessionKey 格式: "agent:main:webuser:xxx:antlyst-123" → "antlyst-123"
 */
function extractSessionId(sessionKey?: string): string | undefined {
  if (!sessionKey) return undefined;
  const parts = sessionKey.split(":");
  return parts[parts.length - 1] || undefined;
}

export function genPlanId(sessionKey?: string): string {
  const sessionId = extractSessionId(sessionKey);
  // 使用 sessionId 前缀确保不同会话的 planId 唯一
  return sessionId ? `${sessionId}-plan-${planSeq++}` : `plan-${planSeq++}`;
}
export function genGroupId(planId?: string): string {
  // 如果有 planId，使用 planId 前缀确保全局唯一
  return planId ? `${planId}-g${groupSeq++}` : `g${groupSeq++}`;
}
export function genStepId(planId?: string): string {
  // 如果有 planId，使用 planId 前缀确保全局唯一
  return planId ? `${planId}-s${stepSeq++}` : `s${stepSeq++}`;
}
export function resetSeqCounters(): void {
  groupSeq = 1;
  stepSeq = 1;
}

