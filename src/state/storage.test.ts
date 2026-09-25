import { beforeEach, describe, expect, it } from "vitest";
import { loadDemo, migrateProjects, writeStorage } from "./storage";
beforeEach(() => localStorage.clear());
describe("isolated local state", () => {
  it("migrates only project fields, preserves old keys and is idempotent", () => {
    const legacy = {
      state: {
        projects: [{ id: "p1", name: "Existing", createdAt: 1 }],
        sessionProjectIds: { "agent:main:old": "p1", dangling: "unknown" },
        pinnedSessionKeys: ["agent:main:old", false],
        gatewayToken: "not-to-be-copied",
      },
    };
    localStorage.setItem("finclaw-session-projects-v1", JSON.stringify(legacy));
    const first = migrateProjects();
    expect(first.projects).toHaveLength(1);
    expect(first.sessionProjectIds).toEqual({ "agent:main:old": "p1" });
    expect(first.pinnedSessionKeys).toEqual(["agent:main:old"]);
    expect(JSON.stringify(first)).not.toContain("not-to-be-copied");
    expect(migrateProjects()).toEqual(first);
    expect(localStorage.getItem("finclaw-session-projects-v1")).toEqual(JSON.stringify(legacy));
  });
  it("stops interrupted demo runs on reload without discarding accumulated text", () => {
    writeStorage("aurora-demo-v1", {
      sessions: [{ id: "a", messages: [{ role: "assistant", text: "Partial", phase: "running" }] }],
      projects: [],
      files: [],
      watchlist: [],
      reminders: [],
    });
    const restored = loadDemo();
    expect(restored?.sessions[0].messages[0]).toMatchObject({ phase: "stopped", text: "Partial" });
  });
  it("ignores malformed storage", () => {
    localStorage.setItem("aurora-demo-v1", "{broken");
    expect(loadDemo()).toBeUndefined();
  });
});
