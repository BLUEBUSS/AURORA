import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
export type Publish = (event: string, payload: Record<string, unknown>) => void;
export function messageText(message?: AgentMessage) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
}
export class RunEvents {
  private seq = 0;
  private messageIndex = 0;
  constructor(readonly runId: string, readonly sessionKey: string, private publish: Publish, private child?: { id: string; label: string }) {}
  agent(stream: string, data: Record<string, unknown>) {
    this.publish("agent", { runId: this.runId, sessionKey: this.sessionKey, seq: ++this.seq, stream, data: { ...data, ...(this.child ? { subagentId: this.child.id, subagentLabel: this.child.label } : {}) } });
  }
  task(data: Record<string, unknown>) { this.agent("task_update", data); }
  accept(event: AgentEvent) {
    if (event.type === "agent_start") this.agent("lifecycle", { phase: "start" });
    if (event.type === "message_start" && event.message.role === "assistant") this.agent("assistant", { phase: "message_start", messageIndex: this.messageIndex++ });
    if (event.type === "message_update" && event.message.role === "assistant") {
      const text = messageText(event.message);
      const thinking = event.message.content.filter((part) => part.type === "thinking").map((part) => part.thinking).join("");
      if (text) this.agent("assistant", { text });
      if (thinking) this.agent("thinking", { text: thinking });
    }
    if (event.type === "tool_execution_start") this.agent("tool", { phase: "start", name: event.toolName, toolCallId: event.toolCallId, args: event.args as unknown });
    if (event.type === "tool_execution_end") this.agent("tool", { phase: "result", name: event.toolName, toolCallId: event.toolCallId, result: event.result as unknown, error: event.isError });
  }
  terminal(state: "final" | "error" | "aborted", message?: AgentMessage, errorMessage?: string) {
    if (this.child) this.agent("lifecycle", { phase: state === "final" ? "end" : "error" });
    else this.publish("chat", { runId: this.runId, sessionKey: this.sessionKey, seq: ++this.seq, state, ...(message ? { message } : {}), ...(errorMessage ? { errorMessage } : {}) });
  }
}
