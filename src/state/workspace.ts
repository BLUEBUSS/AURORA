import { create } from "zustand";
import type {
  Attachment,
  Company,
  Draft,
  Message,
  Notice,
  Page,
  Project,
  Reminder,
  ResearchFile,
  Session,
  Theme,
  WatchItem,
} from "../types";
import {
  seedProjects,
  seedSessions,
  seedFiles,
  seedWatchlist,
  seedReminders,
  inferCompany,
} from "../data/demo";
import {
  loadDemo, readStorage, writeStorage, migrateProjects, liveProjectStorageKey,
  getUnassignedLegacyProjects, claimLegacyProjects,
  type LiveProjectScope,
} from "./storage";
const uid = () => crypto.randomUUID();
export interface WorkspaceState {
  mode: "demo" | "live";
  liveScope: LiveProjectScope | null;
  page: Page;
  currentSessionId: string | null;
  selectedFileId: string | null;
  theme: Theme;
  sessions: Session[];
  projects: Project[];
  files: ResearchFile[];
  watchlist: WatchItem[];
  reminders: Reminder[];
  drafts: Record<string, Draft>;
  notice: Notice | null;
  persistenceError: string | null;
  leftOpen: boolean;
  rightOpen: boolean;
  mobilePanel: "left" | "right" | null;
  model: string;
  researchMode: string;
  activeProject?: string;
  stopping: boolean;
  scrollPositions: Record<string, number>;
  navigate: (page: Page) => void;
  selectSession: (id: string) => void;
  newSession: (projectId?: string, company?: Company, prompt?: string) => string;
  openFile: (id: string) => void;
  closeFile: () => void;
  setTheme: (theme: Theme) => void;
  setDraft: (text: string) => void;
  addAttachments: (files: Attachment[], draftKey?: string) => void;
  removeAttachment: (id: string) => void;
  addProject: (name: string, description?: string) => void;
  renameProject: (id: string, name: string) => void;
  removeProject: (id: string) => void;
  assignProject: (sessionId: string, projectId?: string) => void;
  renameSession: (id: string, title: string) => void;
  togglePinned: (id: string) => void;
  archiveSession: (id: string) => void;
  saveFile: (file: ResearchFile) => boolean;
  getLegacyProjectImportCount: () => number;
  importLegacyProjects: () => boolean;
  removeFile: (id: string) => void;
  addWatch: (item: Omit<WatchItem, "id">) => void;
  removeWatch: (id: string) => void;
  saveReminder: (item: Reminder) => void;
  removeReminder: (id: string) => void;
  notify: (text: string, tone?: "info" | "error") => void;
  beginRound: (
    text: string,
    attachments: Attachment[],
    sessionId?: string,
    runId?: string,
  ) => { sessionId: string; messageId: string };
  updateMessage: (sessionId: string, messageId: string, patch: Partial<Message>) => void;
  enterLive: (sessions: Session[], scope?: LiveProjectScope | null) => void;
  enterDemo: () => void;
}
const initialDemo = loadDemo() ?? {
  sessions: seedSessions,
  projects: seedProjects,
  files: seedFiles,
  watchlist: seedWatchlist,
  reminders: seedReminders,
};
export const useWorkspace = create<WorkspaceState>((set, get) => ({
  ...initialDemo,
  mode: "demo",
  liveScope: null,
  page: "research",
  currentSessionId: null,
  selectedFileId: null,
  theme: readStorage<Theme>("aurora-theme", "system"),
  drafts: {},
  notice: null,
  persistenceError: null,
  leftOpen: true,
  rightOpen: false,
  mobilePanel: null,
  model: "demo",
  researchMode: "深度研究",
  stopping: false,
  scrollPositions: {},
  navigate: (page) => set({ page, selectedFileId: null, mobilePanel: null }),
  selectSession: (id) =>
    set({
      currentSessionId: id,
      page: "research",
      selectedFileId: null,
      mobilePanel: null,
      rightOpen: true,
      stopping: false,
    }),
  newSession: (projectId, company, prompt) => {
    const id = get().mode === "demo" ? `demo-${uid()}` : `pending-${uid()}`;
    set((s) => ({
      sessions: [
        {
          id,
          title: prompt?.slice(0, 36) || "新研究",
          company,
          projectId,
          origin: s.mode,
          updatedAt: Date.now(),
          messages: [],
        },
        ...s.sessions,
      ],
      currentSessionId: id,
      page: "research",
      selectedFileId: null,
      mobilePanel: null,
      rightOpen: false,
      activeProject: projectId,
      drafts: { ...s.drafts, [id]: { text: prompt || "", attachments: [] } },
    }));
    return id;
  },
  openFile: (id) => set({ selectedFileId: id, mobilePanel: null }),
  closeFile: () => set({ selectedFileId: null }),
  setTheme: (theme) => {
    writeStorage("aurora-theme", theme);
    set({ theme });
  },
  setDraft: (text) =>
    set((s) => {
      const key = s.currentSessionId || "new";
      return {
        drafts: {
          ...s.drafts,
          [key]: { ...s.drafts[key], text, attachments: s.drafts[key]?.attachments || [] },
        },
      };
    }),
  addAttachments: (files, draftKey) =>
    set((s) => {
      const key = draftKey ?? s.currentSessionId ?? "new";
      const d = s.drafts[key] || { text: "", attachments: [] };
      return {
        drafts: { ...s.drafts, [key]: { ...d, attachments: [...d.attachments, ...files] } },
      };
    }),
  removeAttachment: (id) =>
    set((s) => {
      const key = s.currentSessionId || "new";
      const d = s.drafts[key] || { text: "", attachments: [] };
      return {
        drafts: {
          ...s.drafts,
          [key]: { ...d, attachments: d.attachments.filter((f) => f.id !== id) },
        },
      };
    }),
  addProject: (name, description = "") => {
    if (!name.trim()) return;
    set((s) => ({
      projects: [
        ...s.projects,
        { id: uid(), name: name.trim(), description, createdAt: Date.now() },
      ],
    }));
  },
  renameProject: (id, name) => {
    if (name.trim())
      set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)),
      }));
  },
  removeProject: (id) =>
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      sessions: s.sessions.map((t) => (t.projectId === id ? { ...t, projectId: undefined } : t)),
    })),
  assignProject: (id, projectId) =>
    set((s) => ({ sessions: s.sessions.map((t) => (t.id === id ? { ...t, projectId } : t)) })),
  renameSession: (id, title) => {
    if (title.trim())
      set((s) => ({
        sessions: s.sessions.map((t) => (t.id === id ? { ...t, title: title.trim() } : t)),
      }));
  },
  togglePinned: (id) =>
    set((s) => ({
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)),
    })),
  archiveSession: (id) =>
    set((s) => ({
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, archived: !t.archived } : t)),
      currentSessionId: s.currentSessionId === id ? null : s.currentSessionId,
    })),
  saveFile: (file) => {
    set((s) => ({
      files: s.files.some((f) => f.id === file.id)
        ? s.files.map((f) => (f.id === file.id ? file : f))
        : [file, ...s.files],
    }));
    return get().mode === "live" || !get().persistenceError;
  },
  getLegacyProjectImportCount: () => {
    const state = get();
    return state.liveScope ? getUnassignedLegacyProjects(state.liveScope, state.projects).length : 0;
  },
  importLegacyProjects: () => {
    const state = get();
    if (!state.liveScope) return false;
    const projects = getUnassignedLegacyProjects(state.liveScope, state.projects);
    if (!projects.length) return true;
    if (!claimLegacyProjects(state.liveScope, projects)) {
      state.notify("浏览器存储不可用，旧项目仍保留在本机，尚未导入。", "error");
      return false;
    }
    set({ projects: [...state.projects, ...projects] });
    return !get().persistenceError;
  },
  removeFile: (id) =>
    set((s) => ({
      files: s.files.filter((f) => f.id !== id),
      selectedFileId: s.selectedFileId === id ? null : s.selectedFileId,
    })),
  addWatch: (item) => {
    if (
      get().watchlist.some(
        (w) =>
          w.company.ticker === item.company.ticker &&
          w.type === item.type &&
          w.venue === item.venue,
      )
    ) {
      get().notify("该标的已在自选中。");
      return;
    }
    set((s) => ({ watchlist: [...s.watchlist, { ...item, id: uid() }] }));
  },
  removeWatch: (id) => set((s) => ({ watchlist: s.watchlist.filter((w) => w.id !== id) })),
  saveReminder: (item) =>
    set((s) => ({
      reminders: s.reminders.some((r) => r.id === item.id)
        ? s.reminders.map((r) => (r.id === item.id ? item : r))
        : [item, ...s.reminders],
    })),
  removeReminder: (id) => set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id) })),
  notify: (text, tone = "info") => set({ notice: { id: uid(), text, tone } }),
  beginRound: (text, attachments, sessionId, runId) => {
    const sourceDraftKey = get().currentSessionId || "new";
    let id = sessionId || get().currentSessionId;
    if (!id) id = get().newSession(get().activeProject, inferCompany(text));
    const messageId = uid();
    const time = Date.now();
    const user: Message = { id: uid(), role: "user", text, attachments, time };
    const assistant: Message = {
      id: messageId,
      role: "assistant",
      text: "",
      time,
      phase: "running",
      runId,
      sources: [],
      steps: [
        {
          id: "prepare",
          title: "整理研究问题",
          detail: "正在建立本轮研究上下文。",
          status: "running",
        },
      ],
    };
    set((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === id
          ? {
              ...t,
              title: t.messages.length ? t.title : text.slice(0, 36) || "附件研究",
              company: t.company ?? inferCompany(text),
              updatedAt: time,
              messages: [...t.messages, user, assistant],
            }
          : t,
      ),
      drafts: {
        ...s.drafts,
        [id!]: { text: "", attachments: [] },
        [sourceDraftKey]: { text: "", attachments: [] },
      },
      rightOpen: true,
      stopping: false,
    }));
    return { sessionId: id, messageId };
  },
  updateMessage: (sessionId, messageId, patch) =>
    set((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === sessionId
          ? { ...t, messages: t.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) }
          : t,
      ),
    })),
  enterLive: (sessions, scope = null) => {
    const previous = get();
    const sameAccount = previous.mode === "live" && !!scope &&
      scope.userId === previous.liveScope?.userId && scope.agentId === previous.liveScope?.agentId;
    const data = scope ? migrateProjects(scope) : { projects: [], sessionProjectIds: {}, pinnedSessionKeys: [] };
    const rows = [...sessions];
    if (sameAccount) {
      // An unsent draft's local session may not appear in sessions.list yet.
      for (const session of previous.sessions) {
        const draft = previous.drafts[session.id];
        if (draft && (draft.text || draft.attachments.length) && !rows.some((row) => row.id === session.id))
          rows.push(session);
      }
    }
    set({
      mode: "live",
      liveScope: scope,
      persistenceError: null,
      sessions: rows.map((s) => ({
        ...s,
        projectId: data.sessionProjectIds[s.id],
        pinned: data.pinnedSessionKeys.includes(s.id),
      })),
      projects: data.projects,
      files: sameAccount ? previous.files : [],
      watchlist: [],
      reminders: [],
      currentSessionId: sameAccount && rows.some((s) => s.id === previous.currentSessionId) ? previous.currentSessionId : null,
      activeProject: sameAccount && data.projects.some((project) => project.id === previous.activeProject)
        ? previous.activeProject : undefined,
      selectedFileId: null,
      page: "research",
      rightOpen: false,
      drafts: sameAccount ? previous.drafts : {},
      model: "",
    });
  },
  enterDemo: () => {
    const demo = loadDemo() ?? initialDemo;
    set({
      ...demo,
      mode: "demo",
      liveScope: null,
      persistenceError: null,
      currentSessionId: null,
      activeProject: undefined,
      selectedFileId: null,
      page: "research",
      rightOpen: false,
      drafts: {},
      model: "demo",
    });
  },
}));
function reportPersistence(ok: boolean, state: WorkspaceState) {
  const error = ok ? null : "浏览器存储不可用，本次修改仅在当前页面保留。";
  if (state.persistenceError !== error) {
    useWorkspace.setState({ persistenceError: error });
    if (error) state.notify(error, "error");
  }
}
useWorkspace.subscribe((state, previous) => {
  const changed = ["sessions", "projects", "files", "watchlist", "reminders"].some(
    (k) => state[k as keyof WorkspaceState] !== previous[k as keyof WorkspaceState],
  );
  if (!changed) return;
  if (state.mode === "demo") {
    const { sessions, projects, files, watchlist, reminders } = state;
    const ok = writeStorage("aurora-demo-v1", { sessions, projects, files, watchlist, reminders });
    reportPersistence(ok, state);
  } else {
    if (!state.liveScope) return;
    const metadataChanged =
      state.mode !== previous.mode ||
      state.projects !== previous.projects ||
      state.sessions.length !== previous.sessions.length ||
      state.sessions.some((session, index) => {
        const before = previous.sessions[index];
        return (
          !before ||
          before.id !== session.id ||
          before.projectId !== session.projectId ||
          before.pinned !== session.pinned ||
          before.archived !== session.archived
        );
      });
    if (!metadataChanged) return;
    // sessions.list is paginated: keep metadata for sessions outside the loaded page.
    const existing = migrateProjects(state.liveScope);
    const sessionProjectIds = { ...existing.sessionProjectIds };
    const visibleIds = new Set(state.sessions.map((session) => session.id));
    for (const session of state.sessions) {
      if (session.projectId) sessionProjectIds[session.id] = session.projectId;
      else delete sessionProjectIds[session.id];
    }
    const ok = writeStorage(liveProjectStorageKey(state.liveScope), {
      projects: state.projects,
      sessionProjectIds,
      pinnedSessionKeys: [
        ...existing.pinnedSessionKeys.filter((id) => !visibleIds.has(id)),
        ...state.sessions.filter((s) => s.pinned).map((s) => s.id),
      ],
    });
    reportPersistence(ok, state);
  }
});
