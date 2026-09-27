import { AsyncLocalStorage } from "node:async_hooks";
export interface ResearchContext {
  runId: string;
  emit: (event: Record<string, unknown>) => void;
  childEnded: (runId: string) => boolean | undefined;
}
export const researchContext = new AsyncLocalStorage<ResearchContext>();
export function emitAgentEvent(event: Record<string, unknown>) {
  const context = researchContext.getStore();
  context?.emit({ ...event, runId: context.runId });
}
