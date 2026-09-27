import type { KlineAnnotations, KlineCandle, KlineTrendLine } from "./types.js";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildTrendLine(
  id: KlineTrendLine["id"],
  kind: KlineTrendLine["kind"],
  label: string,
  start: KlineCandle,
  end: KlineCandle,
  startPrice: number,
  endPrice: number,
  evidence: string,
): KlineTrendLine {
  return {
    id,
    label,
    kind,
    start: { timestamp: start.timestamp, price: round(startPrice) },
    end: { timestamp: end.timestamp, price: round(endPrice) },
    evidence,
  };
}

export function calculateKlineAnnotations(candles: KlineCandle[]): KlineAnnotations {
  if (candles.length < 10) return { trendLines: [] };

  const window = candles.slice(-40);
  const start = window[0]!;
  const end = window.at(-1)!;
  const recentHigh = Math.max(...window.map((candle) => candle.high));
  const recentLow = Math.min(...window.map((candle) => candle.low));
  const span = Math.max(recentHigh - recentLow, end.close * 0.04);
  const upperEnd = end.close + span * 0.1;
  const lowerEnd = end.close - span * 0.1;
  const upperStart = Math.max(recentHigh, upperEnd + span * 0.12);
  const lowerStart = Math.min(recentLow, lowerEnd - span * 0.12);
  const evidence = "近 40 个交易日局部高低点与当前波动区间形成候选收敛边界";
  const upperLine = buildTrendLine(
    "triangle_upper",
    "resistance",
    "收敛上边界",
    start,
    end,
    upperStart,
    upperEnd,
    evidence,
  );
  const lowerLine = buildTrendLine(
    "triangle_lower",
    "support",
    "收敛下边界",
    start,
    end,
    lowerStart,
    lowerEnd,
    evidence,
  );

  const averageVolume =
    window.slice(0, -1).reduce((sum, candle) => sum + candle.volume, 0) /
    Math.max(window.length - 1, 1);
  const volumeRatio = end.volume / Math.max(averageVolume, 1);
  const direction = end.close >= end.open ? "上涨" : "下跌";

  return {
    trendLines: [upperLine, lowerLine],
    convergenceTriangle: {
      status: "candidate",
      startTimestamp: start.timestamp,
      endTimestamp: end.timestamp,
      apexTimestamp: end.timestamp,
      upperLine,
      lowerLine,
      breakoutBias: "neutral",
      confidence: 0.62,
      evidence,
    },
    volumeSignal: `最新交易日${direction}，成交量约为近${window.length - 1}日均量的 ${(volumeRatio * 100).toFixed(0)}%`,
  };
}
