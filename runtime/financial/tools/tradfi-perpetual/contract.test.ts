import Ajv from "ajv";
import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { describe, expect, it, vi } from "vitest";
import { resolve as resolveDataSource } from "../../provenance/data-source-map.js";
import { PROVENANCE_TRACKED_TOOLS } from "../../provenance/tracked-tools.js";
import { popRawRecords } from "../../raw-data-stash.js";
import {
  TradfiPerpetualDataInputSchema,
  createTradfiPerpetualDataTool,
  hasExplicitBinanceIntent,
  normalizeTradfiPerpetualInput,
  type TradfiPerpetualProvider,
  type TradfiPerpetualQuery,
  type TradfiPerpetualRecord,
} from "./index.js";

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
const api = { logger } as unknown as AgentToolApi;
const ajv = new Ajv.default({ allErrors: true, strict: false });

function schemaAccepts(value: unknown): boolean {
  return ajv.compile(TradfiPerpetualDataInputSchema)(value) as boolean;
}

function record(dataType: TradfiPerpetualRecord["dataType"]): TradfiPerpetualRecord {
  return {
    dataType,
    instrumentClass: "kr_equity_perpetual",
    venue: "binance",
    venueSymbol: "SKHYNIXUSDT",
    underlyingSymbol: "SKHYNIX",
    underlyingMarket: "KR_EQUITY",
    underlyingType: "KR_EQUITY",
    underlyingSubTypes: ["TradFi"],
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    contractType: "TRADIFI_PERPETUAL",
    tradingStatus: "TRADING",
    onboardDate: "2026-06-02T00:00:00.000Z",
    isCashEquity: false,
    provider: "fake-binance",
    sourceEndpoint: "GET /fake",
    timestamp: "2026-07-14T00:00:00.000Z",
  };
}

function klineRecord(index: number): TradfiPerpetualRecord {
  const openTime = Date.parse("2026-01-01T00:00:00Z") + index * 86_400_000;
  const close = 100 + index;
  return {
    ...record("trade_ohlcv"),
    timestamp: new Date(openTime).toISOString(),
    openTime: new Date(openTime).toISOString(),
    closeTime: new Date(openTime + 86_399_999).toISOString(),
    isClosed: true,
    open: close - 0.5,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1_000 + index,
  };
}

function fakeProvider(): TradfiPerpetualProvider {
  return {
    id: "fake-binance",
    getData: vi.fn(async (query: TradfiPerpetualQuery) => ({
      status: "complete" as const,
      sections: query.dataTypes.map((dataType) => ({
        dataType,
        status: "complete" as const,
        records: [record(dataType)],
      })),
    })),
  };
}

describe("tradfi perpetual input schema and source-intent gate", () => {
  it("accepts the strict Binance equity-perpetual input contract", () => {
    expect(
      schemaAccepts({
        user_query: "帮我看看 bn 上的 SK 海力士近三个月永续数据",
        action: "technical_analysis_input",
        symbol: "SK 海力士",
        interval: "1d",
        start_time: "2026-04-14T00:00:00Z",
        end_time: "2026-07-14T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      schemaAccepts({
        user_query: "币安有哪些股票永续",
        action: "instruments",
      }),
    ).toBe(true);
  });

  it("requires user_query and rejects unsupported schema values", () => {
    expect(schemaAccepts({ action: "snapshot", symbol: "NVDA" })).toBe(false);
    expect(
      schemaAccepts({
        user_query: "看看 Binance NVDA",
        action: "trade",
        symbol: "NVDA",
      }),
    ).toBe(false);
  });

  it.each([
    ["看看 Binance 的 NVDA 永续", true],
    ["看看币安的英伟达合约", true],
    ["帮我分析 BN 上的 SK 海力士", true],
    ["看看 BNB 永续", false],
    ["看看英伟达最近三个月走势", false],
  ])("detects explicit Binance venue intent in %s", (query, expected) => {
    expect(hasExplicitBinanceIntent(query)).toBe(expected);
  });

  it("rejects a call without explicit Binance intent before provider execution", async () => {
    const provider = fakeProvider();
    const tool = createTradfiPerpetualDataTool(api, provider)({});
    const result = await tool.execute("no-venue-intent", {
      user_query: "帮我看英伟达最近三个月走势",
      action: "ohlcv",
      symbol: "NVDA",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"VENUE_INTENT_REQUIRED"');
    expect(provider.getData).not.toHaveBeenCalled();
  });
});

describe("tradfi perpetual normalization and tool contract", () => {
  it.each([
    ["ZHIPUUSDT", "ZHIPU", "HK_EQUITY", "hk_equity_perpetual"],
    ["CXMTUSDT", "CXMT", "CN_EQUITY", "cn_equity_perpetual"],
  ] as const)(
    "accepts the %s provider identity without weakening the derivative boundary",
    async (venueSymbol, underlyingSymbol, underlyingMarket, instrumentClass) => {
      const provider: TradfiPerpetualProvider = {
        id: "fake-binance",
        async getData(query) {
          const marketRecord = {
            ...record("snapshot"),
            venueSymbol,
            underlyingSymbol,
            underlyingMarket,
            underlyingType: underlyingMarket,
            instrumentClass,
          } as unknown as TradfiPerpetualRecord;
          return {
            status: "complete",
            sections: query.dataTypes.map((dataType) => ({
              dataType,
              status: "complete" as const,
              records: [{ ...marketRecord, dataType }],
            })),
          };
        },
      };
      const tool = createTradfiPerpetualDataTool(api, provider)({});
      const result = await tool.execute(`market-${underlyingSymbol}`, {
        user_query: `查看 Binance ${underlyingSymbol} 股票永续快照`,
        action: "snapshot",
        symbol: underlyingSymbol,
      });

      expect(result.isError).not.toBe(true);
      expect(result.content[0].text).toContain(`underlyingMarket: ${underlyingMarket}`);
      expect(result.content[0].text).toContain(`instrumentClass: ${instrumentClass}`);
      expect(result.content[0].text).toContain("isCashEquity: false");
    },
  );

  it("keeps the technical-analysis bundle focused on snapshot and closed trade bars", () => {
    const query = normalizeTradfiPerpetualInput({
      user_query: "分析币安的 SK 海力士永续",
      action: "technical_analysis_input",
      symbol: "SK 海力士",
    });

    expect(query.venue).toBe("binance");
    expect(query.limit).toBe(120);
    expect(query.dataTypes).toEqual(["snapshot", "trade_ohlcv"]);
  });

  it("rejects BNB as a mistaken BN venue alias", () => {
    expect(() =>
      normalizeTradfiPerpetualInput({
        user_query: "看看 BNB 永续",
        action: "snapshot",
        symbol: "BNB",
      }),
    ).toThrowError(expect.objectContaining({ code: "VENUE_INTENT_REQUIRED" }));
  });

  it("returns provider records, stashes raw data, and marks the derivative boundary", async () => {
    const provider = fakeProvider();
    const tool = createTradfiPerpetualDataTool(api, provider)({});
    const result = await tool.execute("tradfi-snapshot", {
      user_query: "看看币安的 SK 海力士永续快照",
      action: "snapshot",
      symbol: "SK 海力士",
    });

    expect(tool.name).toBe("tradfi_perpetual_data");
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("isCashEquity: false");
    expect(result.content[0].text).toContain("not cash equities");
    expect(result.content[0].text).toContain("quality: good");
    expect(result.content[0].text).toContain("[Binance](https://developers.binance.com/");
    expect(popRawRecords("tradfi-snapshot")?.records).toHaveLength(2);
  });

  it("appends deterministic indicators to the technical-analysis tool output", async () => {
    const provider: TradfiPerpetualProvider = {
      id: "fake-binance",
      async getData(query) {
        return {
          status: "complete",
          sections: query.dataTypes.map((dataType) => ({
            dataType,
            status: "complete" as const,
            records:
              dataType === "trade_ohlcv"
                ? Array.from({ length: 60 }, (_, index) => klineRecord(index))
                : [record(dataType)],
          })),
        };
      },
    };
    const tool = createTradfiPerpetualDataTool(api, provider)({});
    const result = await tool.execute("tradfi-technical", {
      user_query: "分析 Binance SK 海力士股票永续的 MACD 和 RSI",
      action: "technical_analysis_input",
      symbol: "SK 海力士",
    });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("technical_indicators");
    expect(result.content[0].text).toContain('"formulaVersion":"tradfi-ta-v1"');
    expect(result.content[0].text).toContain('"sma20":149.5');
    expect(result.content[0].text).toContain('"rsi14":100');
    expect(result.content[0].text.length).toBeLessThan(2_000);
    expect(result.content[0].text).toContain("Do not fetch raw bars or use exec/Python");
    expect(result.content[0].text).toContain(
      'standardIndicatorPolicy: {"authority":"tool_only","recomputeAllowed":false,"unavailableAction":"omit_and_report"}',
    );
    expect(popRawRecords("tradfi-technical")?.records.at(-1)?.dataType).toBe(
      "technical_indicators",
    );
  });

  it("rejects an explicit crypto misroute before provider execution", async () => {
    const provider = fakeProvider();
    const tool = createTradfiPerpetualDataTool(api, provider)({});
    const result = await tool.execute("crypto-misroute", {
      user_query: "分析 Binance BTC 永续资金费率",
      action: "derivatives",
      symbol: "BTC",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"UNSUPPORTED_INSTRUMENT_CLASS"');
    expect(provider.getData).not.toHaveBeenCalled();
  });

  it("preserves explicit coverage limitations instead of fabricating a full range", async () => {
    const provider: TradfiPerpetualProvider = {
      id: "fake-binance",
      async getData() {
        return {
          status: "partial",
          sections: [
            {
              dataType: "trade_ohlcv",
              status: "partial",
              records: [record("trade_ohlcv")],
              coverage: {
                requestedStartTime: "2026-04-14T00:00:00.000Z",
                requestedEndTime: "2026-07-14T00:00:00.000Z",
                availableStartTime: "2026-06-02T00:00:00.000Z",
                availableEndTime: "2026-07-14T00:00:00.000Z",
                isComplete: false,
                reason: "Contract onboarded at 2026-06-02T00:00:00.000Z.",
              },
              issues: [
                {
                  code: "COVERAGE_LIMITED",
                  message: "Contract onboarded at 2026-06-02T00:00:00.000Z.",
                },
              ],
            },
          ],
        };
      },
    };
    const tool = createTradfiPerpetualDataTool(api, provider)({});
    const result = await tool.execute("limited-coverage", {
      user_query: "看看 bn 上的 SK 海力士近三个月 K 线",
      action: "ohlcv",
      symbol: "SK 海力士",
      start_time: "2026-04-14T00:00:00Z",
      end_time: "2026-07-14T00:00:00Z",
    });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("COVERAGE_LIMITED");
    expect(result.content[0].text).toContain('"isComplete":false');
  });

  it("registers a user-facing provenance label for every successful tool call", () => {
    expect(PROVENANCE_TRACKED_TOOLS.has("tradfi_perpetual_data")).toBe(true);
    expect(resolveDataSource("tradfi_perpetual_data")).toBe("Binance equity-linked perpetual data");
  });
});
