import type { Project, Session, ResearchFile, WatchItem, Reminder } from "../types";
export type DemoSnapshot = {
  sessions: Session[];
  projects: Project[];
  files: ResearchFile[];
  watchlist: WatchItem[];
  reminders: Reminder[];
};
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeStorage(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function loadDemo(): DemoSnapshot | undefined {
  const data = readStorage<DemoSnapshot | undefined>("aurora-demo-v1", undefined);
  if (
    !data ||
    !["sessions", "projects", "files", "watchlist", "reminders"].every((k) =>
      Array.isArray(data[k as keyof DemoSnapshot]),
    )
  )
    return;
  // A browser reload does not keep a demo timer alive. Preserve output and mark interruption.
  return {
    ...data,
    sessions: data.sessions.map((s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.phase === "running" ? { ...m, phase: "stopped", error: "页面重新载入，演示已停止。" } : m,
      ),
    })),
  };
}
export type LiveProjectScope = { userId: string; agentId: string };
export type ProjectSnapshot = {
  projects: Project[];
  sessionProjectIds: Record<string, string>;
  pinnedSessionKeys: string[];
};
export function liveProjectStorageKey(scope: LiveProjectScope): string {
  return `aurora-live-projects-v2:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.agentId)}`;
}
const legacyOwnersKey = "aurora-legacy-project-owners-v1";
export function getUnassignedLegacyProjects(scope: LiveProjectScope, existing: Project[]): Project[] {
  const legacy = migrateProjects();
  const assigned = new Set(Object.values(legacy.sessionProjectIds));
  const present = new Set(existing.map((project) => project.id));
  const owners = readStorage<Record<string, string>>(legacyOwnersKey, {});
  const owner = liveProjectStorageKey(scope);
  return legacy.projects.filter((project) => !assigned.has(project.id) && !present.has(project.id) &&
    (!owners[project.id] || owners[project.id] === owner));
}
export function claimLegacyProjects(scope: LiveProjectScope, projects: Project[]): boolean {
  const owners = readStorage<Record<string, string>>(legacyOwnersKey, {});
  for (const project of projects) owners[project.id] = liveProjectStorageKey(scope);
  return writeStorage(legacyOwnersKey, owners);
}
export function migrateProjects(scope?: LiveProjectScope): ProjectSnapshot {
  if (scope) {
    const scoped = readStorage<ProjectSnapshot | null>(liveProjectStorageKey(scope), null);
    if (scoped) return scoped;
    const legacy = migrateProjects();
    const prefix = `agent:${scope.agentId}:webuser:${scope.userId}:`;
    const sessionProjectIds = Object.fromEntries(
      Object.entries(legacy.sessionProjectIds).filter(([id]) => id.startsWith(prefix)),
    );
    const projectIds = new Set(Object.values(sessionProjectIds));
    // Unassigned legacy projects have no trustworthy owner. Keep their original
    // storage intact for explicit import instead of leaking them to a new account.
    const result = {
      projects: legacy.projects.filter((project) => projectIds.has(project.id)),
      sessionProjectIds,
      pinnedSessionKeys: legacy.pinnedSessionKeys.filter((id) => id.startsWith(prefix)),
    };
    writeStorage(liveProjectStorageKey(scope), result);
    return result;
  }
  const empty = { projects: [], sessionProjectIds: {}, pinnedSessionKeys: [] };
  const current = readStorage<typeof empty | null>("aurora-live-projects-v1", null);
  if (current) return current;
  const old = readStorage<{ state?: Record<string, unknown> }>(
    "finclaw-session-projects-v1",
    {},
  ).state;
  if (!old) return empty;
  const projects: Project[] = Array.isArray(old.projects)
    ? old.projects
        .filter(
          (p: unknown): p is Project =>
            !!p &&
            typeof p === "object" &&
            typeof (p as Project).id === "string" &&
            typeof (p as Project).name === "string",
        )
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: "",
          createdAt: Number(p.createdAt) || Date.now(),
        }))
    : [];
  const ids = new Set(projects.map((p) => p.id));
  const entries =
    old.sessionProjectIds && typeof old.sessionProjectIds === "object"
      ? Object.entries(old.sessionProjectIds)
      : [];
  const result = {
    projects,
    sessionProjectIds: Object.fromEntries(
      entries.filter(([, id]) => typeof id === "string" && ids.has(id)),
    ),
    pinnedSessionKeys: Array.isArray(old.pinnedSessionKeys)
      ? old.pinnedSessionKeys.filter((id): id is string => typeof id === "string")
      : [],
  };
  writeStorage("aurora-live-projects-v1", result);
  return result;
}
