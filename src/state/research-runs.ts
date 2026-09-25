import { eventSessionKey, sessionKeysMatch } from "../engine";
import { applyCoreEvent, completeCore, getCore } from "./research-core";
import { useWorkspace } from "./workspace";
import type { Message } from "../types";
export type ActiveResearchRun = {
  runId: string;
  sessionId: string;
  roundId: string;
  startedAt: number;
  stage: "preparing" | "sent" | "accepted";
  sequences: Record<string, number>;
};
const runs = new Map<string, ActiveResearchRun>();
const endTimers = new Map<string, ReturnType<typeof setTimeout>>();
function persist(removed: string[] = []) {
  try {
    const saved = new Map(rememberedRuns().map((run) => [run.runId, run]));
    for (const id of removed) saved.delete(id);
    for (const { runId, sessionId, startedAt, roundId, stage } of runs.values()) {
      const user = getCore(sessionId).rounds.find((r) => r.id === roundId)?.userMessage;
      const attachments = useWorkspace
        .getState()
        .sessions.find((s) => s.id === sessionId)
        ?.messages.find((m) => m.id === user?.id)
        ?.attachments?.map((a) => ({ id: a.id, name: a.name }));
      saved.set(runId, {
        runId,
        sessionId,
        startedAt,
        stage,
        roundCount: getCore(sessionId).rounds.length,
        userMessage: user
          ? { id: user.id, role: "user", text: user.content, time: user.timestamp, attachments }
          : undefined,
      });
    }
    sessionStorage.setItem("aurora-active-research-v1", JSON.stringify([...saved.values()]));
  } catch {
    /* Execution remains usable without recovery storage. */
  }
}
export function rememberedRuns(): Array<{
  runId: string;
  sessionId: string;
  startedAt: number;
  roundCount?: number;
  stage?: "preparing" | "sent" | "accepted";
  userMessage?: Message;
}> {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem("aurora-active-research-v1") || "[]");
    return Array.isArray(data)
      ? data.filter(
          (r) =>
            r &&
            typeof r.runId === "string" &&
            typeof r.sessionId === "string" &&
            typeof r.startedAt === "number",
        )
      : [];
  } catch {
    return [];
  }
}
export function registerRun(
  run: Omit<ActiveResearchRun, "sequences" | "stage"> & { stage?: ActiveResearchRun["stage"] },
) {
  runs.set(run.runId, { ...run, stage: run.stage || "preparing", sequences: {} });
  persist();
}
export function markRunSent(runId: string) {
  const run = runs.get(runId);
  if (run) {
    run.stage = "sent";
    persist();
  }
}
export function replaceRunId(oldId: string, newId: string) {
  const run = runs.get(oldId);
  if (run) {
    runs.delete(oldId);
    runs.set(newId, { ...run, stage: "accepted", runId: newId });
    persist([oldId]);
  }
}
export function activeRun(sessionId: string) {
  return [...runs.values()].find((r) => sessionKeysMatch(r.sessionId, sessionId));
}
export function finishRun(runId: string, status: "done" | "aborted" | "failed", reason?: string) {
  clearTimeout(endTimers.get(runId));
  endTimers.delete(runId);
  const run = runs.get(runId);
  if (!run) return;
  completeCore(run.sessionId, status, reason);
  runs.delete(runId);
  persist([runId]);
  useWorkspace.setState((s) => ({
    sessions: s.sessions.map((t) =>
      t.id === run.sessionId ? { ...t, recoveryPending: false } : t,
    ),
  }));
}
export function resetRuns(clearRecovery = true) {
  for (const timer of endTimers.values()) clearTimeout(timer);
  endTimers.clear();
  runs.clear();
  if (clearRecovery) {
    try {
      sessionStorage.removeItem("aurora-active-research-v1");
    } catch {
      /* No recovery storage. */
    }
  }
}
export function ingestEvent(event: string, payload: Record<string, unknown>) {
  if (event !== "chat" && event !== "agent") return;
  const sessionId = eventSessionKey(payload);
  if (!sessionId) return;
  let run = typeof payload.runId === "string" ? runs.get(payload.runId) : undefined;
  const eventData = payload.data as Record<string, unknown> | undefined;
  if (!run && typeof eventData?.subagentId === "string") {
    const parent = activeRun(sessionId);
    if (
      parent &&
      getCore(parent.sessionId).subagents.get(eventData.subagentId)?.parentRoundId ===
        parent.roundId
    )
      run = parent;
  }
  if (!run && event === "agent" && !payload.runId) {
    const candidate = activeRun(sessionId);
    const data = payload.data as { plan?: { id?: string } } | undefined;
    const current = candidate
      ? getCore(candidate.sessionId).rounds.find((r) => r.id === candidate.roundId)
      : undefined;
    if (payload.stream === "task_update" && data?.plan?.id && data.plan.id === current?.task?.id)
      run = candidate;
  }
  if (!run || !sessionKeysMatch(run.sessionId, sessionId)) return;
  if (
    event === "agent" &&
    payload.stream === "lifecycle" &&
    !eventData?.subagentId &&
    ["end", "run.end"].includes(String(eventData?.phase || eventData?.event))
  ) {
    // A final chat frame may contain canonical text/citations after lifecycle end.
    const runId = run.runId;
    clearTimeout(endTimers.get(runId));
    endTimers.set(
      runId,
      setTimeout(() => finishRun(runId, "done"), 1500),
    );
    return;
  }
  const stream =
    event === "chat"
      ? "chat"
      : `agent:${String(payload.stream)}:${String(eventData?.subagentId || "main")}`;
  const seq = typeof payload.seq === "number" ? payload.seq : undefined;
  if (seq !== undefined) {
    if (seq <= (run.sequences[stream] ?? -1)) return;
    run.sequences[stream] = seq;
  }
  applyCoreEvent(run.sessionId, event, payload);
  const core = getCore(run.sessionId);
  const round = core.rounds.find((r) => r.id === run?.roundId);
  if (round && round.status !== "streaming") {
    clearTimeout(endTimers.get(run.runId));
    endTimers.delete(run.runId);
    runs.delete(run.runId);
    persist([run.runId]);
    useWorkspace.setState((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === run?.sessionId ? { ...t, recoveryPending: false } : t,
      ),
    }));
  }
}
export function markDisconnected() {
  for (const run of runs.values()) {
    completeCore(run.sessionId, "failed", "连接中断，后端执行状态尚未确认。重新连接后将恢复历史。");
    useWorkspace.setState((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === run.sessionId ? { ...t, recoveryPending: true } : t,
      ),
    }));
  }
  // Keep only the in-flight question in this tab until the backend transcript catches up; never credentials.
  resetRuns(false);
}
