import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { describe, expect, it, vi } from "vitest";
import { createUsEquityMarketDataTool } from "./equity-market-data.js";
import type { UsEquityMarketProvider } from "./provider.js";
import { assessUsDataQuality, formatUsDataQualitySummary } from "./quality.js";
import type { UsEquityBarRecord, UsEquityMarketDataResult } from "./types.js";

const AAPL_BAR: UsEquityBarRecord = {
  dataType: "ohlcv",
  symbol: "AAPL",
  date: "2026-07-16",
  open: 210,
  high: 214,
  low: 209,
  close: 213,
  volume: 50_000_000,
  frequency: "daily",
  currency: "USD",
  provider: "alpha_vantage",
  source: "Alpha Vantage",
};

function fallbackResult(): UsEquityMarketDataResult {
  return {
    status: "complete",
    sections: [{ dataType: "ohlcv", status: "complete", records: [AAPL_BAR] }],
    issues: [
      {
        code: "PROVIDER_FALLBACK",
        message: "EODHD failed; Alpha Vantage fallback was used.",
      },
    ],
  };
}

describe("US data quality and citations", () => {
  it("marks provider fallback as degraded and emits a clickable source citation", () => {
    const quality = assessUsDataQuality(fallbackResult());

    expect(quality.grade).toBe("degraded");
    expect(quality).toMatchObject({
      schemaVersion: "fin-core.data-quality.v1",
      status: "complete",
      attributedRecordCount: 1,
      issueCodes: ["PROVIDER_FALLBACK"],
    });
    expect(quality.fallbackUsed).toBe(true);
    expect(quality.recordCount).toBe(1);
    expect(quality.citations).toEqual([
      {
        label: "Alpha Vantage",
        url: "https://www.alphavantage.co/",
      },
    ]);
    expect(formatUsDataQualitySummary(quality)).toContain(
      "[Alpha Vantage](https://www.alphavantage.co/)",
    );
  });

  it("includes quality, fallback, and sources in the Agent-visible tool output", async () => {
    const provider: UsEquityMarketProvider = {
      id: "us-data-router",
      getEquityMarketData: vi.fn(async () => fallbackResult()),
    };
    const api = {
      logger: { error: vi.fn() },
    } as unknown as AgentToolApi;
    const tool = createUsEquityMarketDataTool(api, provider)({});

    const result = await tool.execute("call-1", { symbol: "AAPL" });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("quality: degraded");
    expect(text).toContain("fallback: yes");
    expect(text).toContain("[Alpha Vantage](https://www.alphavantage.co/)");
  });
});
