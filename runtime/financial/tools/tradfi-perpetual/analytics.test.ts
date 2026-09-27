import { describe, expect, it } from "vitest";
import {
  deriveTechnicalIndicatorsSection,
  enrichTradfiPerpetualResultWithAnalytics,
  formatTechnicalAnalysisResult,
  type TradfiPerpetualQuery,
  type TradfiPerpetualRecord,
  type TradfiPerpetualSection,
  type TradfiTechnicalIndicatorsRecord,
} from "./index.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const START_MS = Date.parse("2026-01-01T00:00:00Z");

function query(action: TradfiPerpetualQuery["action"] = "technical_analysis_input") {
  return {
    userQuery: "分析 Binance NVDA 股票永续技术面",
    action,
    symbol: "NVDA",
    priceSeries: "trade",
    interval: "1d",
    limit: 500,
    depth: 20,
    venue: "binance",
    dataTypes: ["trade_ohlcv"],
  } satisfies TradfiPerpetualQuery;
}

function kline(index: number, isClosed = true): TradfiPerpetualRecord {
  const openTime = START_MS + index * DAY_MS;
  const close = 100 + index;
  return {
    dataType: "trade_ohlcv",
    instrumentClass: "equity_linked_perpetual",
    venue: "binance",
    venueSymbol: "NVDAUSDT",
    underlyingSymbol: "NVDA",
    underlyingMarket: "US_EQUITY",
    underlyingType: "EQUITY",
    underlyingSubTypes: ["TradFi"],
    quoteAsset: "USDT",
    settlementAsset: "USDT",
    contractType: "TRADIFI_PERPETUAL",
    tradingStatus: "TRADING",
    onboardDate: "2025-12-01T00:00:00.000Z",
    isCashEquity: false,
    provider: "fake-binance",
    sourceEndpoint: "GET /fapi/v1/klines",
    timestamp: new Date(openTime).toISOString(),
    openTime: new Date(openTime).toISOString(),
    closeTime: new Date(openTime + DAY_MS - 1).toISOString(),
    isClosed,
    open: close - 0.5,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1_000 + index,
  };
}

function section(
  count: number,
  status: TradfiPerpetualSection["status"] = "complete",
): TradfiPerpetualSection {
  return {
    dataType: "trade_ohlcv",
    status,
    records: Array.from({ length: count }, (_, index) => kline(index)),
  } satisfies TradfiPerpetualSection;
}

describe("deterministic TradFi technical indicators", () => {
  it("derives the standard indicator bundle from closed trade bars", () => {
    const tradeSection = section(60);
    tradeSection.records.push(kline(60, false));
    const derived = deriveTechnicalIndicatorsSection(query(), tradeSection);
    const record = derived.records[0] as TradfiTechnicalIndicatorsRecord;

    expect(derived.status).toBe("complete");
    expect(record.dataType).toBe("technical_indicators");
    expect(record.methodology).toBe("derived");
    expect(record.formulaVersion).toBe("tradfi-ta-v1");
    expect(record.receivedBarCount).toBe(61);
    expect(record.usedBarCount).toBe(60);
    expect(record.dataSufficiency).toBe("full");
    expect(record.latestClose).toBe(159);
    expect(record.periodReturn).toBe(0.59);
    expect(record.return5).toBe(0.03246753);
    expect(record.return20).toBe(0.14388489);
    expect(record.sma5).toBe(157);
    expect(record.sma10).toBe(154.5);
    expect(record.sma20).toBe(149.5);
    expect(record.sma60).toBe(129.5);
    expect(record.rsi14).toBe(100);
    expect(record.rangeSupport20).toBe(138);
    expect(record.rangeResistance20).toBe(161);
    expect(record.calculatedIndicators).toContain("macdHistogram");
    expect(record.calculatedIndicators).toContain("bollingerPercentB20");
    expect(record.calculatedIndicators).toContain("atr14");
    expect(record.unavailableIndicators).toEqual([]);
    expect(record.warnings).toContain("1 still-open bar(s) were excluded from calculation.");
  });

  it("omits unstable long-history indicators and reports exact requirements", () => {
    const derived = deriveTechnicalIndicatorsSection(query(), section(20));
    const record = derived.records[0] as TradfiTechnicalIndicatorsRecord;

    expect(record.dataSufficiency).toBe("limited");
    expect(record.sma20).toBe(109.5);
    expect(record.sma60).toBeUndefined();
    expect(record.rsi14).toBeUndefined();
    expect(record.unavailableIndicators).toContainEqual({
      indicator: "rsi14",
      requiredBars: 28,
      availableBars: 20,
    });
    expect((record as Record<string, unknown>).standardIndicatorPolicy).toEqual({
      authority: "tool_only",
      recomputeAllowed: false,
      unavailableAction: "omit_and_report",
    });
  });

  it("propagates partial source coverage to the derived section", () => {
    const tradeSection = section(40, "partial");
    tradeSection.coverage = {
      requestedStartTime: "2025-12-01T00:00:00.000Z",
      requestedEndTime: "2026-02-10T00:00:00.000Z",
      availableStartTime: "2026-01-01T00:00:00.000Z",
      availableEndTime: "2026-02-09T23:59:59.999Z",
      isComplete: false,
      reason: "Contract onboarded after requested start.",
    };
    const derived = deriveTechnicalIndicatorsSection(query(), tradeSection);

    expect(derived.status).toBe("partial");
    expect(derived.coverage).toEqual(tradeSection.coverage);
    expect(derived.issues).toContainEqual(expect.objectContaining({ code: "PARTIAL_DATA" }));
  });

  it("returns an explicit partial section when no closed bars are usable", () => {
    const tradeSection = section(0);
    tradeSection.records = [kline(0, false)];
    const derived = deriveTechnicalIndicatorsSection(query(), tradeSection);

    expect(derived.status).toBe("partial");
    expect(derived.records).toEqual([]);
    expect(derived.issues?.[0].message).toContain("No closed trade_ohlcv bars");
  });

  it("preserves the instrument identity when no closed bars can produce indicators", () => {
    const openBar = {
      ...kline(0, false),
      instrumentClass: "cn_equity_perpetual" as const,
      venueSymbol: "CXMTUSDT",
      underlyingSymbol: "CXMT",
      underlyingMarket: "CN_EQUITY" as const,
      underlyingType: "CN_EQUITY" as const,
    };
    const tradeSection = {
      dataType: "trade_ohlcv" as const,
      status: "complete" as const,
      records: [openBar],
    };
    const indicatorSection = deriveTechnicalIndicatorsSection(query(), tradeSection);
    const result = {
      status: "partial" as const,
      sections: [
        {
          dataType: "snapshot" as const,
          status: "complete" as const,
          records: [{ ...openBar, dataType: "snapshot" as const, lastPrice: 100 }],
        },
        tradeSection,
        indicatorSection,
      ],
    };

    const summary = formatTechnicalAnalysisResult(result);

    expect(summary).toContain(
      "instrument: CXMTUSDT | underlying: CXMT | market: CN_EQUITY | contractType: TRADIFI_PERPETUAL",
    );
    expect(summary).toContain('snapshot: {"timestamp":"2026-01-01T00:00:00.000Z","lastPrice":100}');
    expect(summary).toContain("technical_indicators: unavailable");
  });

  it("adds analytics only to technical_analysis_input results", () => {
    const providerResult = { status: "complete" as const, sections: [section(60)] };
    const enriched = enrichTradfiPerpetualResultWithAnalytics(query(), providerResult);
    const untouched = enrichTradfiPerpetualResultWithAnalytics(query("ohlcv"), providerResult);

    expect(enriched.sections.map((item) => item.dataType)).toEqual([
      "trade_ohlcv",
      "technical_indicators",
    ]);
    expect(untouched).toBe(providerResult);
  });
});
