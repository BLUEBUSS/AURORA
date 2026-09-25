import { create } from "zustand";
import {
  gateway,
  GatewayError,
  type Bootstrap,
  type ModelRecord,
  type GatewayStatus,
} from "../services";
import type { Message, Session } from "../types";
import { useWorkspace } from "./workspace";
import { runDemo, stopAllDemo, stopDemo } from "./demo-runner";
import { inferCompany } from "../data/demo";
import { readStorage, writeStorage } from "./storage";
import {
  applyCoreEvent,
  clearCore,
  getCore,
  recordProvenancePatch,
  restoreCore,
  startCoreRound,
} from "./research-core";
import { eventSessionKey } from "../engine";
import {
  activeRun,
  registerRun,
  markRunSent,
  replaceRunId,
  finishRun,
  ingestEvent,
  markDisconnected,
  rememberedRuns,
  resetRuns,
} from "./research-runs";
import { displayUserText, withResearchMode } from "./research-content";
type ConnectionState = {
  status: GatewayStatus;
  user: Bootstrap["currentUser"];
  models: ModelRecord[];
  error: string;
  busy: boolean;
};
export const useConnection = create<ConnectionState>(() => ({
  status: "idle",
  user: null,
  models: [],
  error: "",
  busy: false,
}));
let generation = 0;
let connectionPromise: Promise<boolean> | null = null;
let bootstrapped = false;
const historyRequests = new Map<string, Promise<void>>();
const historyEvents = new Map<string, Array<{ event: string; payload: Record<string, unknown> }>>();
const errText = (error: unknown) =>
  error instanceof Error ? error.message : "请求失败，请稍后重试。";
const viewKey = (user: Bootstrap["currentUser"]) =>
  `aurora-live-view:${user?.id || "none"}:${user?.agentId || "main"}`;

export function connectResearch(credentials?: {
  username: string;
  password: string;
}): Promise<boolean> {
  if (connectionPromise) return connectionPromise;
  if (credentials) {
    // An account switch invalidates the old transport even if the new login
    // fails; don't leave the previous account's research visible afterward.
    switchToDemo();
    useConnection.setState({ user: null, models: [] });
  }
  const epoch = ++generation;
  historyRequests.clear();
  historyEvents.clear();
  useConnection.setState({ busy: true, error: "" });
  connectionPromise = (async () => {
    try {
      const bootstrap = credentials
        ? await gateway.login(credentials.username, credentials.password)
        : await gateway.bootstrap();
      await gateway.connect();
      const [rows, catalog] = await Promise.all([gateway.listSessions(), gateway.listModels()]);
      if (epoch !== generation) return false;
      const sessions: Session[] = rows.sessions.map((s) => ({
        id: s.key,
        title: displayUserText(s.derivedTitle || s.displayName || s.label || "研究会话"),
        updatedAt: s.updatedAt || Date.now(),
        messages: [],
        origin: "live",
        company: inferCompany(s.derivedTitle || s.displayName || ""),
        model:
          s.providerOverride && s.modelOverride
            ? `${s.providerOverride}/${s.modelOverride}`
            : s.modelProvider && s.model
              ? `${s.modelProvider}/${s.model}`
              : s.model,
      }));
      const user = bootstrap.currentUser;
      const allowedAgents = new Set([user?.agentId || "main", ...(user?.allowedAgents || [])]);
      const pending = rememberedRuns().filter(
        (run) =>
          user &&
          [...allowedAgents].some((agent) =>
            run.sessionId.startsWith(`agent:${agent}:webuser:${user.id}:`),
          ),
      );
      for (const run of pending)
        if (!sessions.some((s) => s.id === run.sessionId))
          sessions.unshift({
            id: run.sessionId,
            title: run.userMessage?.text.slice(0, 50) || "待恢复研究",
            messages: [],
            origin: "live",
            updatedAt: run.startedAt,
          });
      stopAllDemo();
      clearCore();
      resetRuns(false);
      useConnection.setState({ user: bootstrap.currentUser, models: catalog.models });
      useWorkspace.getState().enterLive(
        sessions,
        user ? { userId: user.id, agentId: user.agentId || "main" } : null,
      );
      useWorkspace.setState({
        model: catalog.defaultModel
          ? `${catalog.defaultModel.provider}/${catalog.defaultModel.model}`
          : "",
        researchMode: readStorage("aurora-research-mode", "深度研究"),
      });
      writeStorage("aurora-data-mode", "live");
      const last = readStorage<string | null>(viewKey(bootstrap.currentUser), null);
      const target = useWorkspace.getState().currentSessionId ||
        (last && sessions.some((s) => s.id === last) ? last : pending[0]?.sessionId);
      await Promise.all(
        pending.map((run) => selectResearch(run.sessionId, true, run.sessionId === target)),
      );
      if (target && !pending.some((run) => run.sessionId === target))
        await selectResearch(target, true);
      return true;
    } catch (error) {
      if (epoch === generation) useConnection.setState({ error: errText(error) });
      return false;
    } finally {
      if (epoch === generation) useConnection.setState({ busy: false });
      connectionPromise = null;
    }
  })();
  return connectionPromise;
}
export function initializeResearch() {
  if (bootstrapped) return;
  bootstrapped = true;
  if (readStorage<"live" | "demo">("aurora-data-mode", "live") !== "demo")
    void connectResearch().then((ok) => {
      if (!ok)
        useWorkspace.getState().notify(useConnection.getState().error || "研究后端尚未连接，可在账户与连接中重试或登录。", "error");
    });
}
export function switchToDemo() {
  ++generation;
  resetRuns();
  gateway.disconnect();
  clearCore();
  historyRequests.clear();
  historyEvents.clear();
  writeStorage("aurora-data-mode", "demo");
  useWorkspace.getState().enterDemo();
  useConnection.setState({ busy: false });
}
export async function logoutResearch() {
  let errorMessage = "";
  try {
    await gateway.logout();
  } catch (error) {
    errorMessage = `本机账户内容已清除，但服务端退出尚未确认：${errText(error)}`;
  } finally {
    // Gateway clears its token even when the HTTP logout fails. UI state must
    // follow that local boundary instead of retaining the previous user's data.
    switchToDemo();
    useConnection.setState({ user: null, models: [], error: errorMessage });
  }
}
export async function selectResearch(id: string, force = false, activate = true) {
  const state = useWorkspace.getState();
  if (activate) state.selectSession(id);
  const session = state.sessions.find((s) => s.id === id);
  if (session?.origin !== "live" || id.startsWith("pending-")) return;
  if (activate) writeStorage(viewKey(useConnection.getState().user), id);
  if (!force && getCore(id).rounds.length) return;
  if (historyRequests.has(id)) return historyRequests.get(id);
  const epoch = generation;
  useWorkspace.setState((s) => ({
    sessions: s.sessions.map((t) =>
      t.id === id ? { ...t, loadingHistory: true, historyError: undefined } : t,
    ),
  }));
  const promise = (async () => {
    try {
      const pending = rememberedRuns().find((r) => r.sessionId === id);
      const [result, runStatus] = await Promise.all([
        gateway.history(id, 500),
        pending
          ? gateway
              .request<{ status: string; error?: string }>("agent.wait", {
                runId: pending.runId,
                timeoutMs: 0,
              })
              .catch(() => ({ status: "unknown" }))
          : Promise.resolve(null),
      ]);
      if (epoch !== generation || useWorkspace.getState().mode !== "live") return;
      const unsent = pending?.stage === "preparing";
      const resume =
        !!pending && (unsent || runStatus?.status === "timeout" || runStatus?.status === "unknown");
      restoreCore(id, result.messages, false);
      const existing = getCore(id);
      const lastRound = existing.rounds.at(-1);
      const sameQuestion =
        !!pending?.userMessage &&
        !!lastRound &&
        displayUserText(lastRound.userMessage.content) ===
          displayUserText(pending.userMessage.text);
      const enoughRounds = pending?.roundCount
        ? existing.rounds.length >= pending.roundCount
        : false;
      const matchingTime =
        !!pending?.userMessage &&
        typeof lastRound?.userMessage.timestamp === "number" &&
        lastRound.userMessage.timestamp >= pending.userMessage.time;
      const pendingInHistory = sameQuestion && (enoughRounds || matchingTime);
      if (resume && pendingInHistory) restoreCore(id, result.messages, true);
      else if (resume && pending?.userMessage) startCoreRound(id, pending.userMessage);
      if (resume && getCore(id).activeRoundId && !getCore(id).activeMessageId) {
        applyCoreEvent(id, "agent", { stream: "assistant", data: { phase: "message_start" } });
      }
      if (pending) {
        const round = getCore(id).rounds.at(-1);
        if (round) {
          registerRun({ ...pending, roundId: round.id });
          if (unsent) {
            finishRun(pending.runId, "aborted");
            const draft = useWorkspace.getState().drafts[id];
            const hasNextDraft = !!draft && (!!draft.text || draft.attachments.length > 0);
            if (!hasNextDraft)
              useWorkspace.setState((s) => ({
                drafts: {
                  ...s.drafts,
                  [id]: {
                    text: pending.userMessage?.text || "",
                    attachments: pending.userMessage?.attachments || [],
                  },
                },
              }));
            useWorkspace.getState().notify(hasNextDraft
              ? "上一轮尚未发出请求，下一条草稿已保留；发送或清空草稿后可重试上一轮。"
              : "刷新前尚未发出请求，草稿已恢复；如有附件请重新选择。");
          } else if (!resume)
            finishRun(
              pending.runId,
              runStatus?.status === "error" ? "failed" : "done",
              runStatus?.status === "error" ? "后端执行失败，请核对历史。" : undefined,
            );
        }
      }
      useWorkspace.setState((s) => ({
        sessions: s.sessions.map((t) =>
          t.id === id ? { ...t, loadingHistory: false, recoveryPending: resume && !unsent } : t,
        ),
      }));
    } catch (error) {
      if (epoch === generation)
        useWorkspace.setState((s) => ({
          sessions: s.sessions.map((t) =>
            t.id === id ? { ...t, loadingHistory: false, historyError: errText(error) } : t,
          ),
        }));
    } finally {
      if (epoch === generation) {
        historyRequests.delete(id);
        const events = historyEvents.get(id) || [];
        historyEvents.delete(id);
        for (const frame of events) ingestEvent(frame.event, frame.payload);
      }
    }
  })();
  historyRequests.set(id, promise);
  return promise;
}
export async function sendResearch() {
  const state = useWorkspace.getState();
  const draftKey = state.currentSessionId || "new";
  const draft = state.drafts[draftKey] || { text: "", attachments: [] };
  let session = state.sessions.find((s) => s.id === state.currentSessionId);
  if (
    session?.messages.some((m) => m.phase === "running") ||
    (!draft.text.trim() && !draft.attachments.length)
  )
    return;
  if (state.mode === "demo") {
    const round = state.beginRound(draft.text, draft.attachments);
    runDemo(round.sessionId, round.messageId);
    return;
  }
  if (session?.loadingHistory || session?.historyError || session?.recoveryPending) {
    state.notify("请先恢复并核对当前研究记录，再发送新消息。", "error");
    return;
  }
  if (gateway.getStatus() !== "connected") {
    state.notify("后端已断开，请先重新连接。", "error");
    return;
  }
  const user = useConnection.getState().user;
  if (!user?.id || !user.agentId) {
    state.notify("未获得研究身份，请重新连接或登录。", "error");
    return;
  }
  const epoch = generation;
  let id = session?.id;
  if (!id || id.startsWith("pending-")) {
    const oldId = id;
    id = `agent:${user.agentId}:webuser:${user.id}:antlyst-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    session = {
      id,
      title: draft.text.slice(0, 50) || "附件研究",
      messages: [],
      origin: "live",
      updatedAt: Date.now(),
      company: session?.company || inferCompany(draft.text),
      projectId: session?.projectId,
      model: state.model,
    };
    const created = session;
    useWorkspace.setState((s) => ({
      sessions: [created, ...s.sessions.filter((t) => t.id !== oldId)],
      currentSessionId: id,
    }));
  }
  const sessionId = id;
  const runId = crypto.randomUUID();
  const userMessage: Message = {
    id: crypto.randomUUID(),
    role: "user",
    text: draft.text,
    attachments: draft.attachments,
    time: Date.now(),
  };
  useWorkspace.setState((s) => ({
    sessions: s.sessions.map((t) =>
      t.id === sessionId
        ? {
            ...t,
            messages: [...t.messages, userMessage],
            title: t.messages.length ? t.title : draft.text.slice(0, 50) || "附件研究",
            company: t.company || inferCompany(draft.text),
            updatedAt: Date.now(),
          }
        : t,
    ),
    drafts: {
      ...s.drafts,
      [draftKey]: { text: "", attachments: [] },
      [sessionId]: { text: "", attachments: [] },
    },
    rightOpen: true,
    stopping: false,
  }));
  const roundId = startCoreRound(sessionId, userMessage);
  registerRun({ runId, sessionId, roundId, startedAt: Date.now() });
  writeStorage(viewKey(user), sessionId);
  writeStorage("aurora-research-mode", state.researchMode);
  try {
    if (!session?.messages.length)
      await gateway.request("sessions.patch", {
        key: sessionId,
        ...(state.model ? { model: state.model } : {}),
        modelLocked: true,
      });
    if (epoch !== generation || activeRun(sessionId)?.runId !== runId) return;
    let fullText = draft.text;
    if (draft.attachments.length) {
      const { uploadLiveTextAttachment } = await import("../services/live-files");
      const uploaded = [];
      for (const file of draft.attachments) {
        if (epoch !== generation || activeRun(sessionId)?.runId !== runId) return;
        if (file.content === undefined) throw new Error("附件没有可读取的文本内容。");
        const result = await uploadLiveTextAttachment({
          name: file.name,
          content: file.content,
          mimeType: file.mimeType,
        });
        uploaded.push(result);
        if (epoch !== generation) return;
        const fileId = `upload:${result.path}`;
        useWorkspace.getState().saveFile({
          id: fileId,
          name: file.name,
          folder: "本轮附件",
          kind: file.name.endsWith(".md") ? "markdown" : "text",
          content: file.content,
          updatedAt: Date.now(),
          sessionId,
          readOnly: true,
          remoteUrl: result.url,
        });
        useWorkspace.setState((s) => ({
          sessions: s.sessions.map((t) =>
            t.id === sessionId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === userMessage.id
                      ? {
                          ...m,
                          attachments: m.attachments?.map((a) =>
                            a.id === file.id ? { ...a, fileId } : a,
                          ),
                        }
                      : m,
                  ),
                }
              : t,
          ),
        }));
      }
      fullText += `\n\n---\n📎 **附件信息**：用户上传的研究资料，文件内容作为待核验材料。\n${uploaded.map((f) => `- ${f.name} → ${f.path}`).join("\n")}`;
    }
    if (epoch !== generation || activeRun(sessionId)?.runId !== runId) return;
    markRunSent(runId);
    const result = await gateway.sendMessage({
      sessionKey: sessionId,
      message: withResearchMode(fullText, state.researchMode),
      idempotencyKey: runId,
      thinking: state.researchMode === "深度研究" ? "high" : "off",
      timeoutMs: 600000,
    });
    replaceRunId(runId, result.runId);
  } catch (error) {
    if (epoch !== generation) return;
    const requestUnknown =
      error instanceof GatewayError &&
      ["REQUEST_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ERROR", "SEND_FAILED"].includes(
        error.code || "",
      );
    if (requestUnknown) {
      useWorkspace.setState((s) => ({
        sessions: s.sessions.map((t) => (t.id === sessionId ? { ...t, recoveryPending: true } : t)),
      }));
      state.notify(
        "请求结果尚未确认，已保留运行标识。请重新连接或刷新状态，不会自动重发。",
        "error",
      );
      return;
    }
    finishRun(runId, "failed", errText(error));
    const current = useWorkspace.getState();
    if (!current.drafts[sessionId]?.text && !current.drafts[sessionId]?.attachments.length)
      useWorkspace.setState((s) => ({ drafts: { ...s.drafts, [sessionId]: draft } }));
  }
}
export async function stopResearch() {
  const state = useWorkspace.getState();
  const id = state.currentSessionId;
  if (!id || state.stopping) return;
  if (state.mode === "demo") {
    stopDemo(id);
    return;
  }
  const run = activeRun(id);
  if (!run) return;
  useWorkspace.setState({ stopping: true });
  if (run.stage === "preparing") {
    finishRun(run.runId, "aborted");
    useWorkspace.setState({ stopping: false });
    return;
  }
  try {
    const result = await gateway.abort(id, run.runId);
    if (result.aborted) finishRun(run.runId, "aborted");
    else {
      const status = await gateway.request<{ status: string }>("agent.wait", {
        runId: run.runId,
        timeoutMs: 0,
      });
      if (status.status === "ok") finishRun(run.runId, "done");
      else if (status.status === "error") finishRun(run.runId, "failed", "后端执行失败。");
      else {
        useWorkspace.setState((s) => ({
          sessions: s.sessions.map((t) => (t.id === id ? { ...t, recoveryPending: true } : t)),
        }));
        state.notify("后端尚未确认停止，已保留本轮状态，请稍后刷新状态。", "error");
        return;
      }
    }
    useWorkspace.setState((s) => ({
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, recoveryPending: false } : t)),
    }));
  } catch (error) {
    state.notify(`停止未确认：${errText(error)}`, "error");
  } finally {
    useWorkspace.setState({ stopping: false });
  }
}
export function retryResearch() {
  const s = useWorkspace.getState();
  const session = s.sessions.find((t) => t.id === s.currentSessionId);
  const last = session?.messages.findLast((m) => m.role === "user");
  if (!last) return;
  const draft = s.drafts[s.currentSessionId || "new"];
  if (draft?.text || draft?.attachments.length) {
    s.notify("下一条草稿已保留，请手动发送，或清空后重试上一条。");
    return;
  }
  s.setDraft(last.text);
  s.addAttachments(last.attachments || []);
  void sendResearch();
}
const unsubscribeEvents = gateway.subscribe((event, payload) => {
  if (useWorkspace.getState().mode !== "live") return;
  const key = eventSessionKey(payload);
  if (
    event === "agent" &&
    payload.stream === "provenance_patch" &&
    key &&
    useWorkspace.getState().sessions.some((s) => s.id === key)
  ) {
    recordProvenancePatch(key, (payload.data || {}) as Record<string, unknown>);
    return;
  }
  if (key && historyRequests.has(key)) {
    const queue = historyEvents.get(key) || [];
    if (queue.length < 2000) queue.push({ event, payload });
    historyEvents.set(key, queue);
    return;
  }
  ingestEvent(event, payload);
});
const unsubscribeStatus = gateway.subscribeStatus((status) => {
  useConnection.setState({ status });
  if ((status === "disconnected" || status === "error") && useWorkspace.getState().mode === "live")
    markDisconnected();
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    unsubscribeEvents();
    unsubscribeStatus();
  });
