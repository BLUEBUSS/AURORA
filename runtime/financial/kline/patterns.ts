import type { KlineCandle, KlinePattern } from "./types.js";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function pattern(
  name: KlinePattern["name"],
  label: string,
  candle: KlineCandle,
  bias: KlinePattern["bias"],
  confidence: number,
  evidence: string,
): KlinePattern {
  return {
    name,
    label,
    timestamp: candle.timestamp,
    bias,
    confidence: round(confidence),
    evidence,
  };
}

export function detectCandlePatterns(candles: KlineCandle[]): KlinePattern[] {
  const patterns: KlinePattern[] = [];
  candles.forEach((candle, index) => {
    const range = candle.high - candle.low;
    if (range <= 0) return;
    const body = Math.abs(candle.close - candle.open);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;

    if (body <= range * 0.1) {
      patterns.push(pattern("doji", "十字星", candle, "neutral", 0.8, "实体占全幅不超过 10%"));
    }
    if (
      lowerWick >= Math.max(body * 2, range * 0.45) &&
      upperWick <= Math.max(body, range * 0.15)
    ) {
      patterns.push(
        pattern("hammer", "锤头线", candle, "bullish", 0.72, "下影线显著长于实体，上影线较短"),
      );
    }
    if (
      upperWick >= Math.max(body * 2, range * 0.45) &&
      lowerWick <= Math.max(body, range * 0.15)
    ) {
      patterns.push(
        pattern(
          "shooting_star",
          "射击之星",
          candle,
          "bearish",
          0.72,
          "上影线显著长于实体，下影线较短",
        ),
      );
    }

    const previous = candles[index - 1];
    if (!previous) return;
    const previousBearish = previous.close < previous.open;
    const previousBullish = previous.close > previous.open;
    const currentBullish = candle.close > candle.open;
    const currentBearish = candle.close < candle.open;
    if (
      previousBearish &&
      currentBullish &&
      candle.open <= previous.close &&
      candle.close >= previous.open
    ) {
      patterns.push(
        pattern(
          "bullish_engulfing",
          "看涨吞没",
          candle,
          "bullish",
          0.76,
          "当前阳线实体覆盖前一根阴线实体",
        ),
      );
    }
    if (
      previousBullish &&
      currentBearish &&
      candle.open >= previous.close &&
      candle.close <= previous.open
    ) {
      patterns.push(
        pattern(
          "bearish_engulfing",
          "看跌吞没",
          candle,
          "bearish",
          0.76,
          "当前阴线实体覆盖前一根阳线实体",
        ),
      );
    }
  });
  return patterns;
}
