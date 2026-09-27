import { calculateKlineIndicators } from "./analytics.js";
import { calculateKlineAnnotations } from "./annotations.js";
import { calculatePriceLevels } from "./levels.js";
import { detectCandlePatterns } from "./patterns.js";
import { buildScenarioPaths } from "./scenarios.js";
import type { KlineChartSpec, NormalizedKlinePayload, ScenarioResearchEvidence } from "./types.js";

export function buildKlineSpecFromMarketSeries(
  series: NormalizedKlinePayload,
  researchEvidence: ScenarioResearchEvidence[] = [],
): KlineChartSpec {
  const indicators = calculateKlineIndicators(series.candles);
  const levels = calculatePriceLevels(series.candles);
  const spec: KlineChartSpec = {
    schemaVersion: "kline.v1",
    instrument: series.instrument,
    timeframe: series.timeframe,
    candles: series.candles,
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
            values: series.candles.map((candle) => candle.volume),
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
          {
            name: "Histogram",
            values: indicators.macdHistogram,
            color: "#94a3b8",
          },
        ],
      },
    ],
    provenance: series.provenance,
    coverage: series.coverage,
    quality: series.quality,
    sources: series.sources,
    issues: series.issues,
    levels,
    patterns: detectCandlePatterns(series.candles).slice(-6),
    annotations: calculateKlineAnnotations(series.candles),
  };
  spec.scenarios = buildScenarioPaths(series.candles, series.instrument, researchEvidence);
  return spec;
}
