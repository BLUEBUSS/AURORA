import { describe, expect, it } from "vitest";
import { assessResearchDataQuality, formatResearchDataQuality } from "./research-data-quality.js";

describe("shared research data quality", () => {
  it("marks partial Binance data as degraded and cites the official market-data docs", () => {
    const quality = assessResearchDataQuality({
      status: "partial",
      records: [{ provider: "fake-binance", venue: "binance" }],
      issues: [{ code: "COVERAGE_LIMITED", message: "Listing history is shorter than requested." }],
    });

    expect(quality.grade).toBe("degraded");
    expect(quality).toMatchObject({
      schemaVersion: "fin-core.data-quality.v1",
      status: "partial",
      fallbackUsed: false,
      attributedRecordCount: 1,
      issueCodes: ["COVERAGE_LIMITED"],
    });
    expect(quality.citations).toEqual([
      {
        label: "Binance",
        url: "https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api",
      },
    ]);
    expect(formatResearchDataQuality(quality)).toContain("quality: degraded");
  });

  it("fails closed when a successful provider response has no records", () => {
    expect(
      assessResearchDataQuality({ status: "complete", records: [], issues: [] }),
    ).toMatchObject({
      schemaVersion: "fin-core.data-quality.v1",
      status: "complete",
      grade: "failed",
      score: 0,
      recordCount: 0,
      attributedRecordCount: 0,
    });
  });

  it("fails closed when records have no provider attribution", () => {
    expect(
      assessResearchDataQuality({ status: "complete", records: [{ value: 1 }], issues: [] }),
    ).toMatchObject({ grade: "failed", score: 60, attributedRecordCount: 0 });
  });
});
