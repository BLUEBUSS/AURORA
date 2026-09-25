// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * normalizePlan 单测：覆盖 broken / partial backend payload 防御。
 *
 * 实证背景：jsonl b1c39537 #12 task_create 是 backend 流式期间 partial flush——
 *   args.phases 是未完成的 JSON 字符串（278 chars，截断在 `..."风险"]`）。
 * 旧实现 `if (plan.phases && plan.phases.length > 0)` string 也通过 → `.map()` 抛 TypeError。
 * 修法：phases / groups 各自加 Array.isArray 守卫；不是 array → 视为无效返回 null。
 */

import { describe, expect, it } from "vitest";
import { normalizePlan } from "./_plan-normalize";
import type { TaskPlan } from "../contracts/protocol";

describe("normalizePlan - 防御 partial-flushed payload", () => {
  it("phases 是 string（partial flush）→ 返回 null（不抛 TypeError）", () => {
    // 实证 jsonl #12 形态：args.phases 是截断 JSON 字符串
    const plan = {
      phases: '[{"description": "采集..."},...截断',
    } as unknown as TaskPlan;
    expect(() => normalizePlan(plan)).not.toThrow();
    expect(normalizePlan(plan)).toBeNull();
  });

  it("phases 是空 string → 返回 null", () => {
    const plan = { phases: "" } as unknown as TaskPlan;
    expect(normalizePlan(plan)).toBeNull();
  });

  it("phases 是 number / object（异常 shape）→ 返回 null", () => {
    expect(normalizePlan({ phases: 42 } as unknown as TaskPlan)).toBeNull();
    expect(normalizePlan({ phases: { foo: "bar" } } as unknown as TaskPlan)).toBeNull();
  });

  it("groups 是 string（同样 partial flush）→ 返回 null", () => {
    const plan = { groups: '[{"id":"g1"...截断' } as unknown as TaskPlan;
    expect(() => normalizePlan(plan)).not.toThrow();
    expect(normalizePlan(plan)).toBeNull();
  });

  it("groups 是 array 但 step 是 string → 跳过 group 不进入分支 1", () => {
    // groups[0].steps 是 string → 不算"含真正 steps" → 进入 phases 分支或 fall-through
    const plan = {
      groups: [{ id: "g1", title: "", type: "serial", steps: "broken-string" }],
    } as unknown as TaskPlan;
    expect(() => normalizePlan(plan)).not.toThrow();
    // 没 phases → 返回 null
    expect(normalizePlan(plan)).toBeNull();
  });
});

describe("normalizePlan - 正常 path 不退化（regression）", () => {
  it("phases-only normalize 成 groups[0].steps with phase-N id", () => {
    const plan = {
      phases: [{ description: "P0" }, { description: "P1" }],
    } as unknown as TaskPlan;
    const out = normalizePlan(plan);
    expect(out).not.toBeNull();
    expect(out?.groups?.length).toBe(1);
    expect(out?.groups?.[0]?.steps.length).toBe(2);
    expect(out?.groups?.[0]?.steps[0]?.id).toBe("phase-1");
    expect(out?.groups?.[0]?.steps[1]?.id).toBe("phase-2");
    expect(out?.groups?.[0]?.steps[0]?.status).toBe("pending");
  });

  it("groups-with-steps 不动（短路返回原 plan）", () => {
    const plan: TaskPlan = {
      groups: [
        {
          id: "g1",
          title: "",
          type: "serial",
          steps: [{ id: "phase-1", status: "running" } as never],
        },
      ],
    };
    const out = normalizePlan(plan);
    expect(out).toBe(plan); // identity
  });

  it("空 plan / null / undefined → 返回 null", () => {
    expect(normalizePlan(null)).toBeNull();
    expect(normalizePlan(undefined)).toBeNull();
    expect(normalizePlan({} as TaskPlan)).toBeNull();
  });

  it("groups 是 [] 空数组 + 无 phases → 返回 null", () => {
    const plan = { groups: [] } as unknown as TaskPlan;
    expect(normalizePlan(plan)).toBeNull();
  });
});
