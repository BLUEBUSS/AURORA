import {
  DATA_PROVENANCE_SCHEMA_VERSION,
  DATA_QUALITY_SCHEMA_VERSION,
} from "../data-contracts/index.js";
import { calculateKlineIndicators } from "./analytics.js";
import { calculateKlineAnnotations } from "./annotations.js";
import { calculatePriceLevels } from "./levels.js";
import { detectCandlePatterns } from "./patterns.js";
import { buildScenarioPaths } from "./scenarios.js";
import type { InstrumentIdentity, KlineCandle, KlineChartSpec } from "./types.js";

const DEMO_INSTRUMENT: InstrumentIdentity = {
  symbol: "BABA",
  displayName: "Alibaba",
  market: "US",
  venue: "NYSE",
  assetType: "cash_equity",
  currency: "USD",
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function moveToNextWeekday(date: Date): void {
  const day = date.getUTCDay();
  if (day === 0) date.setUTCDate(date.getUTCDate() + 1);
  if (day === 6) date.setUTCDate(date.getUTCDate() + 2);
}

function buildDates(count: number): string[] {
  const cursor = new Date(Date.UTC(2026, 0, 2));
  const dates: string[] = [];
  while (dates.length < count) {
    moveToNextWeekday(cursor);
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function buildCandles(count = 72): KlineCandle[] {
  const dates = buildDates(count);
  let previousClose = 138.25;

  return dates.map((timestamp, index) => {
    const trend = index * 0.62;
    const cycle = Math.sin(index * 0.41) * 4.2 + Math.cos(index * 0.17) * 2.1;
    const close = round(138 + trend + cycle);
    const open = round(previousClose + Math.sin(index * 0.83) * 1.35);
    const high = round(Math.max(open, close) + 1.7 + (index % 4) * 0.18);
    const low = round(Math.min(open, close) - 1.55 - (index % 3) * 0.2);
    const volume = Math.round(34_000_000 + index * 420_000 + (index % 7) * 2_800_000);
    previousClose = close;
    return { timestamp, open, high, low, close, volume };
  });
}

export function buildDemoKlineSpec(): KlineChartSpec {
  const candles = buildCandles();
  const indicators = calculateKlineIndicators(candles);
  const levels = calculatePriceLevels(candles);

  const spec: KlineChartSpec = {
    schemaVersion: "kline.v1",
    instrument: DEMO_INSTRUMENT,
    timeframe: "1d",
    candles,
    overlays: [
      { name: "MA20", values: indicators.ma20, color: "#e3a008" },
      { name: "BOLL 上轨", values: indicators.bollUpper, color: "#8b5cf6" },
      { name: "BOLL 中轨", values: indicators.bollMiddle, color: "#64748b" },
      { name: "BOLL 下轨", values: indicators.bollLower, color: "#8b5cf6" },
    ],
    panels: [
      {
        id: "volume",
        title: "Volume",
        series: [
          {
            name: "Volume",
            values: candles.map((candle) => candle.volume),
            color: "#7c8da6",
          },
        ],
      },
      {
        id: "rsi",
        title: "RSI14",
        series: [{ name: "RSI14", values: indicators.rsi14, color: "#5c7cfa" }],
      },
      {
        id: "macd",
        title: "MACD(12,26,9)",
        series: [
          { name: "MACD", values: indicators.macd, color: "#0891b2" },
          { name: "Signal", values: indicators.macdSignal, color: "#f97316" },
          { name: "Histogram", values: indicators.macdHistogram, color: "#94a3b8" },
        ],
      },
    ],
    provenance: {
      schemaVersion: DATA_PROVENANCE_SCHEMA_VERSION,
      source: "BLUEBUSS deterministic fixture",
      mode: "fixture",
      asOf: candles.at(-1)?.timestamp ?? "",
      coverage: `${candles[0]?.timestamp ?? ""} to ${candles.at(-1)?.timestamp ?? ""}`,
    },
    coverage: {
      start: candles[0]?.timestamp ?? "",
      end: candles.at(-1)?.timestamp ?? "",
      requested: "2026-01-01 to 2026-04-30",
      status: "partial",
    },
    quality: {
      schemaVersion: DATA_QUALITY_SCHEMA_VERSION,
      status: "partial",
      grade: "degraded",
      score: 75,
      recordCount: candles.length,
      attributedRecordCount: candles.length,
      fallbackUsed: false,
      citations: [],
      issueCodes: ["FIXTURE_DATA"],
    },
    sources: [{ provider: "fixture", source: "BLUEBUSS deterministic fixture" }],
    issues: [{ code: "FIXTURE_DATA", message: "Deterministic demo series; not live market data." }],
    levels,
    patterns: detectCandlePatterns(candles).slice(-6),
    annotations: calculateKlineAnnotations(candles),
  };
  spec.scenarios = buildScenarioPaths(candles, DEMO_INSTRUMENT);
  return spec;
}
