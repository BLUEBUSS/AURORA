import { assessDataQuality, type MarketSeriesIssue } from "../data-contracts/index.js";
import type { TradfiPerpetualProvider } from "../tools/tradfi-perpetual/provider.js";
import type {
  TradfiPerpetualIssue,
  TradfiPerpetualQuery,
  TradfiPerpetualRecord,
} from "../tools/tradfi-perpetual/types.js";
import type { UsEquityMarketProvider } from "../tools/us-data/provider.js";
import { normalizeMarketRecords } from "./adapter.js";
import type { KlineMarket, NormalizedKlinePayload } from "./types.js";

export interface KlineMarketDataRequest {
  symbol: string;
  market: KlineMarket;
  timeframe: "1d" | "1w" | "1m";
  lookback: "3m";
}

export interface KlineMarketDataProvider {
  getMarketSeries(request: KlineMarketDataRequest): Promise<NormalizedKlinePayload>;
}

export type KlineLiveDataChannel = "binance_tradfi" | "cash_equity";

export interface KlineMarketDataProviders {
  binanceTradfi?: KlineMarketDataProvider;
  cashEquity?: KlineMarketDataProvider;
}

const MIN_THREE_MONTH_DAILY_BARS = 45;

function calendarDayGap(start: string, end: string): number {
  const startTime = new Date(`${start}T00:00:00.000Z`).getTime();
  const endTime = new Date(`${end}T00:00:00.000Z`).getTime();
  return Math.floor((endTime - startTime) / 86_400_000);
}

function enforceThreeMonthCoverage(
  series: NormalizedKlinePayload,
  requested: { startDate: string; endDate: string },
): NormalizedKlinePayload {
  const coverageIssues: MarketSeriesIssue[] = [];
  if (series.candles.length < MIN_THREE_MONTH_DAILY_BARS) {
    coverageIssues.push({
      code: "INSUFFICIENT_COVERAGE",
      message: `Three-month daily coverage has ${series.candles.length} valid bars; expected at least ${MIN_THREE_MONTH_DAILY_BARS}.`,
    });
  }
  if (series.coverage.start && calendarDayGap(requested.startDate, series.coverage.start) > 14) {
    coverageIssues.push({
      code: "INSUFFICIENT_COVERAGE",
      message: `Observed series starts at ${series.coverage.start}, materially after requested ${requested.startDate}.`,
    });
  }
  if (series.coverage.end && calendarDayGap(series.coverage.end, requested.endDate) > 7) {
    coverageIssues.push({
      code: "STALE_SERIES",
      message: `Observed series ends at ${series.coverage.end}, more than seven calendar days before ${requested.endDate}.`,
    });
  }
  if (coverageIssues.length === 0) return series;

  const issues = [...series.issues, ...coverageIssues];
  return {
    ...series,
    coverage: { ...series.coverage, status: series.candles.length > 0 ? "partial" : "unknown" },
    issues,
    quality: assessDataQuality({
      status: "partial",
      records: series.candles,
      issues,
      citations: series.quality.citations,
      isAttributed: () => series.sources.length > 0,
      failOnMissingAttribution: true,
    }),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function requestedRange(now: Date): { startDate: string; endDate: string; label: string } {
  const endDate = dateOnly(now);
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - 3);
  const startDate = dateOnly(start);
  return { startDate, endDate, label: `${startDate} to ${endDate}` };
}

function tradfiQuery(symbol: string, now: Date): TradfiPerpetualQuery {
  const range = requestedRange(now);
  return {
    userQuery: `使用 Binance 美股股票永续代理分析 ${symbol} 近三个月日 K 线`,
    action: "ohlcv",
    symbol,
    priceSeries: "trade",
    interval: "1d",
    startTime: `${range.startDate}T00:00:00.000Z`,
    endTime: now.toISOString(),
    limit: 100,
    depth: 20,
    venue: "binance",
    dataTypes: ["trade_ohlcv"],
  };
}

function tradfiIssues(
  resultIssues: TradfiPerpetualIssue[] | undefined,
  sectionIssues: TradfiPerpetualIssue[],
  hasOpenCandle: boolean,
): MarketSeriesIssue[] {
  return [
    ...(resultIssues ?? []),
    ...sectionIssues,
    {
      code: "DERIVATIVE_PROXY",
      message:
        "Binance equity-linked perpetual OHLCV is a USDT-settled derivative proxy, not cash-equity price or volume.",
    },
    ...(hasOpenCandle
      ? [
          {
            code: "OPEN_CANDLE",
            message:
              "The latest daily candle is still open; its close, indicators, and scenario weights are provisional.",
          },
        ]
      : []),
  ];
}

export function createBinanceTradfiKlineMarketDataProvider(
  provider: TradfiPerpetualProvider,
  now: () => Date = () => new Date(),
): KlineMarketDataProvider {
  return {
    async getMarketSeries(request) {
      if (request.market !== "US" || request.timeframe !== "1d") {
        throw new Error(`Unsupported K-line route: ${request.market}/${request.timeframe}`);
      }
      const retrievedAt = now();
      const range = requestedRange(retrievedAt);
      const result = await provider.getData(tradfiQuery(request.symbol, retrievedAt));
      const tradeSections = result.sections.filter((section) => section.dataType === "trade_ohlcv");
      const records = tradeSections
        .flatMap((section) => section.records)
        .filter(
          (record): record is TradfiPerpetualRecord =>
            record.isCashEquity === false &&
            record.underlyingMarket === "US_EQUITY" &&
            (record.isClosed === true || record.isClosed === false),
        );
      const hasOpenCandle = records.some((record) => record.isClosed === false);
      const first = records[0];
      const issues = tradfiIssues(
        result.issues,
        tradeSections.flatMap((section) => section.issues ?? []),
        hasOpenCandle,
      );
      const isPartial =
        hasOpenCandle ||
        result.status === "partial" ||
        tradeSections.some(
          (section) => section.status === "partial" || section.coverage?.isComplete === false,
        );
      const source = "Binance USDⓈ-M equity-linked perpetual";
      const venueSymbol =
        typeof first?.venueSymbol === "string" ? first.venueSymbol : `${request.symbol}USDT`;
      const series = normalizeMarketRecords(
        records,
        {
          symbol: venueSymbol,
          displayName:
            request.symbol === "BABA"
              ? "Alibaba Group (Binance perpetual proxy)"
              : `${request.symbol} (Binance perpetual proxy)`,
          market: "BINANCE_TRADFI",
          venue: "Binance USDⓈ-M",
          assetType: "perpetual",
          currency: typeof first?.quoteAsset === "string" ? first.quoteAsset : "USDT",
        },
        {
          provider: typeof first?.provider === "string" ? first.provider : provider.id,
          source,
          requested: range.label,
          retrievedAt: retrievedAt.toISOString(),
          timeframe: "1d",
          status: isPartial ? "partial" : "complete",
          issues,
        },
      );
      return enforceThreeMonthCoverage(series, range);
    },
  };
}

export function createUsEquityKlineMarketDataProvider(
  provider: UsEquityMarketProvider,
  now: () => Date = () => new Date(),
): KlineMarketDataProvider {
  return {
    async getMarketSeries(request) {
      if (request.market !== "US" || request.timeframe !== "1d") {
        throw new Error(`Unsupported K-line route: ${request.market}/${request.timeframe}`);
      }
      const retrievedAt = now();
      const range = requestedRange(retrievedAt);
      const result = await provider.getEquityMarketData({
        symbol: request.symbol,
        provider: "auto",
        frequency: "daily",
        adjustment: "adjusted",
        startDate: range.startDate,
        endDate: range.endDate,
        limit: 100,
      });
      const records = result.sections.flatMap((section) => section.records);
      const issues = [
        ...(result.issues ?? []),
        ...result.sections.flatMap((section) => section.issues ?? []),
      ];
      const first = records[0];
      const series = normalizeMarketRecords(
        records,
        {
          symbol: request.symbol,
          displayName: request.symbol === "BABA" ? "Alibaba Group" : request.symbol,
          market: "US",
          venue: request.symbol === "BABA" ? "NYSE" : "US_EQUITY",
          assetType: "cash_equity",
          currency: "USD",
        },
        {
          provider: first?.provider ?? provider.id,
          source: first?.source ?? provider.id,
          requested: range.label,
          retrievedAt: retrievedAt.toISOString(),
          timeframe: "1d",
          status:
            result.status === "partial" ||
            result.sections.some((section) => section.status === "partial")
              ? "partial"
              : "complete",
          fallbackUsed: issues.some((issue) => issue.code === "PROVIDER_FALLBACK"),
          issues,
        },
      );
      return enforceThreeMonthCoverage(series, range);
    },
  };
}
