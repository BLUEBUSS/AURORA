import { create } from "zustand";
import {
  applyOps,
  createInitialChatState,
  deriveRoundStartOp,
  historyToOps,
  liveToOps,
  selectConclusionText,
  ChatId,
  type ChatState,
  type ChatOp,
  type HistoryMessage,
} from "../engine";
import type { Message } from "../types";
import { useWorkspace } from "./workspace";
import { displayUserText, sourcesFromText } from "./research-content";
import { applyPatchToText, type ProvenancePatchInput } from "../components/provenance/apply-patch";

export const useResearchCore = create<{ sessions: Record<string, ChatState> }>(() => ({
  sessions: {},
}));
const provenancePatches = new Map<string, ProvenancePatchInput>();
export function getCore(sessionId: string) {
  return useResearchCore.getState().sessions[sessionId] ?? createInitialChatState();
}
function projectMessages(sessionId: string, core: ChatState): Message[] {
  const previous = useWorkspace.getState().sessions.find((s) => s.id === sessionId)?.messages || [];
  const oldAnswers = previous.filter((m) => m.role === "assistant");
  const demo = useWorkspace.getState().sessions.find((s) => s.id === sessionId)?.origin === "demo";
  return core.rounds.flatMap((round, index) => {
    const exactUser = previous.find((m) => m.role === "user" && m.id === round.userMessage.id);
    // History can replace message IDs; preserve per-round attachment identity
    // before matching text, since repeated prompts may refer to different files.
    const indexedUser = previous.filter((m) => m.role === "user")[index];
    const oldUser = exactUser || (indexedUser?.text === displayUserText(round.userMessage.content) ? indexedUser : undefined);
    const oldAnswer = previous.find((m) => m.engineRoundId === round.id) ?? oldAnswers[index];
    const text = applyPatchToText(
      selectConclusionText(round),
      provenancePatches.get(sessionId) || {},
    );
    const phase =
      round.status === "streaming"
        ? "running"
        : round.status === "done"
          ? "completed"
          : round.status === "aborted"
            ? "stopped"
            : "failed";
    return [
      {
        id: round.userMessage.id,
        role: "user",
        text: displayUserText(round.userMessage.content),
        time: round.userMessage.timestamp,
        attachments: oldUser?.attachments,
      },
      {
        id: round.assistantMessageId || `${round.id}:answer`,
        role: "assistant",
        text,
        time: round.startedAt,
        phase,
        engineRoundId: round.id,
        error: round.failureReason,
        sources: demo && oldAnswer?.sources?.length ? oldAnswer.sources : sourcesFromText(text),
        runId: oldAnswer?.runId,
        fileIds: oldAnswer?.fileIds,
        steps: oldAnswer?.steps,
      },
    ] satisfies Message[];
  });
}
export function saveCore(sessionId: string, core: ChatState) {
  useResearchCore.setState((s) => ({ sessions: { ...s.sessions, [sessionId]: core } }));
  useWorkspace.setState((s) => ({
    sessions: s.sessions.map((session) =>
      session.id === sessionId
        ? { ...session, messages: projectMessages(sessionId, core) }
        : session,
    ),
  }));
}
export function startCoreRound(sessionId: string, user: Message) {
  const core = getCore(sessionId);
  const op = deriveRoundStartOp(core, sessionId, {
    id: user.id,
    role: "user",
    content: user.text,
    timestamp: user.time,
  });
  const next = applyOps(core, [op]);
  saveCore(sessionId, next);
  return next.activeRoundId!;
}
export function applyCoreEvent(sessionId: string, event: string, payload: Record<string, unknown>) {
  let core = getCore(sessionId);
  // Terminal frames can carry the final canonical text after the last delta.
  if (event === "chat" && ["final", "aborted", "error"].includes(String(payload.state))) {
    const message = payload.message as { content?: unknown; text?: string } | undefined;
    const text =
      message?.text ||
      (typeof message?.content === "string"
        ? message.content
        : Array.isArray(message?.content)
          ? message.content
              .flatMap((p: unknown) =>
                p && typeof p === "object" && (p as { type?: string }).type === "text"
                  ? String((p as { text?: string }).text || "")
                  : [],
              )
              .join("")
          : "");
    const round = core.rounds.find((r) => r.id === core.activeRoundId);
    if (text && round) {
      if (!round.activeMessageId)
        core = applyOps(core, [
          {
            type: "message/start",
            roundId: round.id,
            messageId: ChatId.message(round.id, round.nextMessageIndex),
            timestamp: Date.now(),
          },
        ]);
      // A final frame is canonical, not another cumulative/independent streaming block.
      // It may have citation corrections that no longer share the streamed prefix.
      core = {
        ...core,
        rounds: core.rounds.map((current) => {
          if (current.id !== round.id || !current.activeMessageId) return current;
          const pending = new Map(current.pending);
          const message = pending.get(current.activeMessageId);
          if (message) pending.set(current.activeMessageId, { ...message, contentText: text });
          return { ...current, pending };
        }),
      };
    }
  }
  const normalized =
    event === "chat" && payload.errorMessage
      ? { ...payload, error: payload.errorMessage }
      : payload;
  saveCore(sessionId, applyOps(core, liveToOps({ event, payload: normalized }, core)));
}
export function completeCore(
  sessionId: string,
  status: "done" | "aborted" | "failed",
  reason?: string,
) {
  const core = getCore(sessionId);
  const round = core.rounds.find((r) => r.id === core.activeRoundId);
  if (!round) return;
  const ops: ChatOp[] = [];
  if (round.activeMessageId)
    ops.push({
      type: "message/end",
      roundId: round.id,
      messageId: round.activeMessageId,
      timestamp: Date.now(),
    });
  ops.push({ type: "round/complete", roundId: round.id, status, reason, timestamp: Date.now() });
  saveCore(sessionId, applyOps(core, ops));
}
export function restoreCore(sessionId: string, messages: unknown[], resume = false, states: Array<{ userTimestamp: number; status: string }> = []) {
  let ops = historyToOps(
    messages.filter((m): m is HistoryMessage => !!m && typeof m === "object"),
    sessionId,
  );
  if (resume) {
    const lastStart = ops.findLast((op) => op.type === "round/start");
    if (lastStart?.type === "round/start") {
      const ends = ops.filter(
        (op) => op.type === "message/end" && op.roundId === lastStart.roundId,
      );
      const lastEnd = ends.at(-1);
      ops = ops.filter(
        (op) =>
          !(op.type === "round/complete" && op.roundId === lastStart.roundId) && op !== lastEnd,
      );
    }
  }
  const core = applyOps(createInitialChatState(), ops);
  if (states.length) core.rounds = core.rounds.map((round) => {
    if (resume && round.id === core.activeRoundId) return round;
    const state = states.find((state) => state.userTimestamp === round.userMessage.timestamp);
    return state?.status === "aborted" ? { ...round, status: "aborted" as const } : state?.status === "error" ? { ...round, status: "failed" as const, failureReason: "该轮研究未完成。" } : round;
  });
  saveCore(sessionId, core);
}
export function recordProvenancePatch(sessionId: string, data: Record<string, unknown>) {
  const prior = provenancePatches.get(sessionId) || {};
  const raw =
    data.rewriteMap && typeof data.rewriteMap === "object"
      ? (data.rewriteMap as Record<string, unknown>)
      : {};
  const rewrite = Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] =>
        /^p_[0-9a-f]{4}$/.test(entry[0]) &&
        typeof entry[1] === "string" &&
        /^p_[0-9a-f]{4}$/.test(entry[1]),
    ),
  );
  const strip = Array.isArray(data.stripTokens)
    ? data.stripTokens.filter((v): v is string => typeof v === "string" && v.length < 100)
    : [];
  provenancePatches.set(sessionId, {
    rewriteMap: { ...prior.rewriteMap, ...rewrite },
    stripTokens: [...new Set([...(prior.stripTokens || []), ...strip])],
  });
  saveCore(sessionId, getCore(sessionId));
}
export function clearCore() {
  provenancePatches.clear();
  useResearchCore.setState({ sessions: {} });
}
