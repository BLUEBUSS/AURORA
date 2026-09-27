import { describe, expect, it } from "vitest";
import {
  TRADFI_AGENT_ROUTING_CASES,
  classifyTradfiPerpetualRoute,
  evaluateTradfiAgentRouting,
} from "./index.js";

describe("tradfi_perpetual_data Agent routing golden set", () => {
  it("keeps a balanced set of positive and negative user requests", () => {
    const positives = TRADFI_AGENT_ROUTING_CASES.filter(
      (testCase) => testCase.shouldUseTradfiPerpetualData,
    );
    const negatives = TRADFI_AGENT_ROUTING_CASES.filter(
      (testCase) => !testCase.shouldUseTradfiPerpetualData,
    );

    expect(TRADFI_AGENT_ROUTING_CASES).toHaveLength(29);
    expect(positives).toHaveLength(14);
    expect(negatives).toHaveLength(15);
  });

  it.each(TRADFI_AGENT_ROUTING_CASES)("$id routes to the intended tool boundary", (testCase) => {
    const decision = classifyTradfiPerpetualRoute(testCase.userQuery);
    expect(decision.shouldRoute).toBe(testCase.shouldUseTradfiPerpetualData);
  });

  it("meets the deterministic route quality gate", () => {
    expect(evaluateTradfiAgentRouting()).toEqual({
      caseCount: 29,
      positiveCount: 14,
      negativeCount: 15,
      truePositive: 14,
      trueNegative: 15,
      falsePositive: 0,
      falseNegative: 0,
      accuracy: 1,
      precision: 1,
      recall: 1,
      specificity: 1,
    });
  });
});
