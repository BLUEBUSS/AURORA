// Adapted from ANLYST/OpenClaw (MIT). See docs/licenses/OpenClaw-MIT.txt.
import { afterEach, describe, expect, it } from "vitest";
import { taskStore, genPlanId, genGroupId, genStepId, resetSeqCounters } from "./task-store.js";
import type { TaskPlan, StoreScope } from "./task-store.js";

function createTestPlan(
  scope: StoreScope,
  status: "executing" | "done" | "paused" = "executing",
): TaskPlan {
  resetSeqCounters();
  const planId = genPlanId(scope.sessionKey);
  const plan: TaskPlan = {
    id: planId,
    query: "test query",
    status,
    groups: [
      {
        id: genGroupId(planId),
        title: "Test Group",
        order: 0,
        type: "serial",
        steps: [
          {
            id: genStepId(planId),
            title: "step 1",
            description: "step 1",
            status: status === "done" ? "done" : "pending",
            tool: "financial_statement",
            added_by: "initial",
          },
        ],
      },
    ],
    checkpoints: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sessionKey: scope.sessionKey,
  };
  taskStore.create(plan, scope);
  return plan;
}

afterEach(() => {
  taskStore.clear();
});

describe("phase override", () => {
  const scope: StoreScope = { agentId: "test-agent", sessionKey: "session-1" };

  it("returns undefined when no override is set", () => {
    expect(taskStore.getPhaseOverride(scope)).toBeUndefined();
  });

  it("sets and reads phase override", () => {
    taskStore.setPhaseOverride(scope, "planning");
    expect(taskStore.getPhaseOverride(scope)).toBe("planning");
  });

  it("clears phase override", () => {
    taskStore.setPhaseOverride(scope, "direct");
    expect(taskStore.getPhaseOverride(scope)).toBe("direct");
    taskStore.clearPhaseOverride(scope);
    expect(taskStore.getPhaseOverride(scope)).toBeUndefined();
  });

  it("isolates overrides by scope", () => {
    const scope2: StoreScope = { agentId: "test-agent", sessionKey: "session-2" };
    taskStore.setPhaseOverride(scope, "planning");
    taskStore.setPhaseOverride(scope2, "direct");
    expect(taskStore.getPhaseOverride(scope)).toBe("planning");
    expect(taskStore.getPhaseOverride(scope2)).toBe("direct");
  });

  it("overwrite existing override", () => {
    taskStore.setPhaseOverride(scope, "planning");
    taskStore.setPhaseOverride(scope, "direct");
    expect(taskStore.getPhaseOverride(scope)).toBe("direct");
  });
});

describe("phase override lifecycle with plans", () => {
  const scope: StoreScope = { agentId: "test-agent", sessionKey: "session-1" };

  it("override + clearPhaseOverride in task_create flow", () => {
    // Simulate before_agent_start setting override
    taskStore.setPhaseOverride(scope, "planning");
    expect(taskStore.getPhaseOverride(scope)).toBe("planning");

    // Simulate task_create clearing override
    createTestPlan(scope);
    taskStore.clearPhaseOverride(scope);
    expect(taskStore.getPhaseOverride(scope)).toBeUndefined();

    // Plan should still be accessible
    const plan = taskStore.getCurrent(scope);
    expect(plan).toBeDefined();
    expect(plan!.status).toBe("executing");
  });

  it("direct override persists through entire turn (no task_create)", () => {
    taskStore.setPhaseOverride(scope, "direct");
    expect(taskStore.getPhaseOverride(scope)).toBe("direct");

    // No task_create happens in direct flow — override stays
    expect(taskStore.getPhaseOverride(scope)).toBe("direct");

    // agent_end clears it
    taskStore.clearPhaseOverride(scope);
    expect(taskStore.getPhaseOverride(scope)).toBeUndefined();
  });

  it("continuation clears override and preserves plan", () => {
    const plan = createTestPlan(scope, "paused");
    taskStore.setPhaseOverride(scope, "planning");

    // Simulate continuation: clear override and resume plan
    taskStore.clearPhaseOverride(scope);
    taskStore.setPlanStatus(plan.id, "executing");

    expect(taskStore.getPhaseOverride(scope)).toBeUndefined();
    expect(taskStore.getCurrent(scope)!.status).toBe("executing");
  });
});
