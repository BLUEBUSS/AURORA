import { useWorkspace } from "./workspace";
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function recordGeneratedFile(sessionId: string, raw: unknown, roundIndex?: number) {
  const artifact = record(raw);
  const state = useWorkspace.getState();
  const session = state.sessions.find((session) => session.id === sessionId);
  if (state.mode !== "live" || !session || !artifact || typeof artifact.path !== "string" || typeof artifact.name !== "string" || typeof artifact.content !== "string" || artifact.content.length > 2 * 1024 * 1024) return;
  const answers = session.messages.filter((message) => message.role === "assistant");
  const answer = roundIndex === undefined ? answers.at(-1) : answers[roundIndex];
  if (!answer) return;
  const id = `runtime-report:${sessionId}:${artifact.path}`;
  if (!state.files.some((file) => file.id === id)) state.saveFile({ id, name: artifact.name, folder: "研究报告", content: artifact.content, kind: "markdown", report: true, readOnly: true, sessionId, updatedAt: Date.now() });
  state.updateMessage(sessionId, answer.id, { fileIds: [...new Set([...(answer.fileIds || []), id])] });
}
export function recordArtifactEvent(event: string, payload: Record<string, unknown>) {
  const data = record(payload.data);
  if (event !== "agent" || payload.stream !== "tool" || data?.phase !== "result" || data.name !== "write_report" || typeof payload.sessionKey !== "string" || typeof payload.runId !== "string") return;
  const state = useWorkspace.getState();
  if (!state.sessions.find((session) => session.id === payload.sessionKey)?.messages.some((message) => message.runId === payload.runId)) return;
  recordGeneratedFile(payload.sessionKey, record(record(data.result)?.details)?.artifact);
}
export function restoreGeneratedFiles(sessionId: string, messages: unknown[]) {
  let round = -1;
  for (const value of messages) {
    const message = record(value);
    if (message?.role === "user") round++;
    if (message?.role === "toolResult" && message.toolName === "write_report") recordGeneratedFile(sessionId, record(message.details)?.artifact, round);
  }
}
