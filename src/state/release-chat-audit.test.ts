import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gateway } from "../services";
import type { Session } from "../types";
import { connectResearch, logoutResearch, switchToDemo, useConnection } from "./research-runtime";
import { clearCore, completeCore, startCoreRound } from "./research-core";
import { resetRuns } from "./research-runs";
import { useWorkspace } from "./workspace";

const sessionId = "agent:main:webuser:alice:antlyst-audit";
const session = (): Session => ({
  id: sessionId,
  title: "Audit research",
  messages: [],
  origin: "live",
  updatedAt: 1,
});

function mockConnection(userId = "alice", agentId = "main") {
  vi.spyOn(gateway, "bootstrap").mockResolvedValue({
    agentNameMap: { [agentId]: "Research" },
    currentUser: { id: userId, agentId, allowedAgents: [agentId] },
  });
  vi.spyOn(gateway, "connect").mockResolvedValue();
  vi.spyOn(gateway, "listSessions").mockResolvedValue({
    sessions: userId === "alice" ? [{ key: sessionId, derivedTitle: "Audit research" }] : [],
  });
  vi.spyOn(gateway, "listModels").mockResolvedValue({ models: [] });
  vi.spyOn(gateway, "history").mockResolvedValue({ messages: [] });
}

beforeEach(() => {
  switchToDemo();
  localStorage.clear();
  sessionStorage.clear();
  clearCore();
  resetRuns();
  useConnection.setState({ user: null, models: [], error: "", busy: false });
  useWorkspace.setState({ mode: "demo", sessions: [], projects: [], drafts: {} });
});

afterEach(() => {
  resetRuns();
  clearCore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("release chat state boundaries", () => {
  it("preserves the same account's next draft and attachment when reconnecting", async () => {
    mockConnection();
    await connectResearch();
    const draft = {
      text: "Next question that has not been sent",
      attachments: [{ id: "draft-file", name: "notes.txt", content: "private draft" }],
    };
    useWorkspace.setState({ drafts: { [sessionId]: draft }, currentSessionId: sessionId });
    await connectResearch();
    expect(useWorkspace.getState().drafts[sessionId]).toEqual(draft);
  });

  it("clears account data locally even when the logout endpoint is unavailable", async () => {
    useConnection.setState({ user: { id: "alice", agentId: "main" } });
    useWorkspace.setState({ mode: "live", sessions: [session()] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    await logoutResearch();
    expect(useConnection.getState().user).toBeNull();
    expect(useWorkspace.getState().mode).toBe("demo");
    expect(useWorkspace.getState().sessions.some((s) => s.id === sessionId)).toBe(false);
    expect(useConnection.getState().error).not.toBe("");
  });

  it("clears the previous account's content when switching to an invalid login", async () => {
    mockConnection();
    await connectResearch();
    vi.spyOn(gateway, "login").mockRejectedValue(new Error("Invalid login"));
    expect(await connectResearch({ username: "bob", password: "synthetic-wrong-password" })).toBe(false);
    expect(useConnection.getState().user).toBeNull();
    expect(useWorkspace.getState().mode).toBe("demo");
    expect(useWorkspace.getState().sessions.some((s) => s.id === sessionId)).toBe(false);
  });

  it("does not expose one account's project names to another account", async () => {
    mockConnection();
    await connectResearch();
    useWorkspace.getState().addProject("Alice confidential project", "Private description");
    vi.spyOn(gateway, "logout").mockResolvedValue();
    await logoutResearch();
    mockConnection("bob");
    await connectResearch();
    expect(useWorkspace.getState().projects).toEqual([]);
    await logoutResearch();
    mockConnection("alice");
    await connectResearch();
    expect(useWorkspace.getState().projects[0]?.name).toBe("Alice confidential project");
  });

  it("separates projects for two agents belonging to the same account", async () => {
    mockConnection();
    await connectResearch();
    useWorkspace.getState().addProject("Main agent project");
    mockConnection("alice", "other");
    await connectResearch();
    expect(useWorkspace.getState().projects).toEqual([]);
    mockConnection();
    await connectResearch();
    expect(useWorkspace.getState().projects[0]?.name).toBe("Main agent project");
  });

  it("preserves an unsent local session and its selected draft across reconnect", async () => {
    mockConnection();
    await connectResearch();
    const id = useWorkspace.getState().newSession(undefined, undefined, "Unsent research");
    await connectResearch();
    expect(useWorkspace.getState().currentSessionId).toBe(id);
    expect(useWorkspace.getState().drafts[id].text).toBe("Unsent research");
    expect(gateway.history).not.toHaveBeenCalledWith(id, expect.anything());
  });

  it("does not replace the next draft while restoring a request interrupted during preparation", async () => {
    mockConnection();
    await connectResearch();
    useWorkspace.setState({ currentSessionId: sessionId, drafts: { [sessionId]: { text: "Keep next draft", attachments: [] } } });
    sessionStorage.setItem("aurora-active-research-v1", JSON.stringify([{
      runId: "preparing-run", sessionId, startedAt: 1, stage: "preparing", roundCount: 1,
      userMessage: { id: "unsent-question", role: "user", text: "Unsent earlier question", time: 1 },
    }]));
    await connectResearch();
    expect(useWorkspace.getState().drafts[sessionId].text).toBe("Keep next draft");
    expect(useWorkspace.getState().sessions[0].messages[0].text).toBe("Unsent earlier question");
  });

  it("migrates legacy project membership by identity and retains orphan projects for explicit import", async () => {
    localStorage.setItem("aurora-live-projects-v1", JSON.stringify({
      projects: [
        { id: "alice-project", name: "Alice legacy", description: "", createdAt: 1 },
        { id: "orphan-project", name: "Unassigned legacy", description: "", createdAt: 2 },
      ],
      sessionProjectIds: { [sessionId]: "alice-project" },
      pinnedSessionKeys: [sessionId],
    }));
    mockConnection("bob");
    await connectResearch();
    expect(useWorkspace.getState().projects).toEqual([]);
    mockConnection("alice");
    await connectResearch();
    expect(useWorkspace.getState().projects.map((p) => p.name)).toEqual(["Alice legacy"]);
    expect(useWorkspace.getState().getLegacyProjectImportCount()).toBe(1);
    expect(useWorkspace.getState().importLegacyProjects()).toBe(true);
    expect(useWorkspace.getState().projects.map((p) => p.name)).toEqual(["Alice legacy", "Unassigned legacy"]);
    mockConnection("bob");
    await connectResearch();
    expect(useWorkspace.getState().projects).toEqual([]);
    expect(useWorkspace.getState().getLegacyProjectImportCount()).toBe(0);
    expect(localStorage.getItem("aurora-live-projects-v1")).toContain("Unassigned legacy");
  });

  it("reports unsaved files while retaining their content in memory when storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    const file = { id: "file", name: "notes.md", folder: "", kind: "markdown" as const, content: "Keep my notes", updatedAt: 1 };
    expect(useWorkspace.getState().saveFile(file)).toBe(false);
    expect(useWorkspace.getState().files.find((f) => f.id === "file")?.content).toBe("Keep my notes");
    expect(useWorkspace.getState().persistenceError).not.toBeNull();
    vi.restoreAllMocks();
    expect(useWorkspace.getState().saveFile(file)).toBe(true);
    expect(useWorkspace.getState().persistenceError).toBeNull();
  });

  it("attaches asynchronously loaded content to the original draft", () => {
    useWorkspace.setState({ currentSessionId: "new-selection" });
    useWorkspace.getState().addAttachments([{ id: "file", name: "notes.txt" }], "original-selection");
    expect(useWorkspace.getState().drafts["original-selection"].attachments).toHaveLength(1);
    expect(useWorkspace.getState().drafts["new-selection"]).toBeUndefined();
  });

  it("matches attachments by message identity before falling back to identical text", () => {
    useWorkspace.setState({ mode: "live", sessions: [session()] });
    const first = {
      id: "u-first", role: "user" as const, text: "Compare this file", time: 1,
      attachments: [{ id: "first", name: "first.txt" }],
    };
    const second = {
      id: "u-second", role: "user" as const, text: "Compare this file", time: 2,
      attachments: [{ id: "second", name: "second.txt" }],
    };
    useWorkspace.setState({ sessions: [{ ...session(), messages: [first] }] });
    startCoreRound(sessionId, first);
    completeCore(sessionId, "done");
    useWorkspace.setState((s) => ({ sessions: s.sessions.map((row) => ({ ...row, messages: [...row.messages, second] })) }));
    startCoreRound(sessionId, second);
    const messages = useWorkspace.getState().sessions[0].messages.filter((m) => m.role === "user");
    expect(messages[1].attachments).toEqual(second.attachments);
  });
});
