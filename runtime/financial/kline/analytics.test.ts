import { describe, expect, it } from "vitest";
import { calculateKlineIndicators } from "./analytics.js";
import { calculateKlineAnnotations } from "./annotations.js";
import { calculatePriceLevels } from "./levels.js";
import { detectCandlePatterns } from "./patterns.js";
import type { KlineCandle } from "./types.js";

const candles: KlineCandle[] = Array.from({ length: 25 }, (_, index) => {
  const close = 100 + index;
  return {
    timestamp: `2026-01-${String(index + 1).padStart(2, "0")}`,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1_000 + index * 10,
  };
});

describe("K-line indicators", () => {
  it("aligns MA20 and RSI14 to the original candle count", () => {
    const indicators = calculateKlineIndicators(candles);

    expect(indicators.ma20).toHaveLength(candles.length);
    expect(indicators.rsi14).toHaveLength(candles.length);
    expect(indicators.ma20.slice(0, 19)).toEqual(Array(19).fill(null));
    expect(indicators.ma20[19]).toBe(109.5);
    expect(indicators.rsi14.slice(0, 14)).toEqual(Array(14).fill(null));
    expect(indicators.rsi14[24]).toBe(100);
  });

  it("calculates Bollinger bands and MACD as aligned deterministic series", () => {
    const extendedCandles = Array.from({ length: 45 }, (_, index) => {
      const close = 100 + index;
      return {
        timestamp: `2026-03-${String(index + 1).padStart(2, "0")}`,
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1_000 + index * 10,
      };
    });
    const indicators = calculateKlineIndicators(extendedCandles);

    expect(indicators.bollUpper).toHaveLength(extendedCandles.length);
    expect(indicators.bollMiddle).toHaveLength(extendedCandles.length);
    expect(indicators.bollLower).toHaveLength(extendedCandles.length);
    expect(indicators.macd).toHaveLength(extendedCandles.length);
    expect(indicators.macdSignal).toHaveLength(extendedCandles.length);
    expect(indicators.macdHistogram).toHaveLength(extendedCandles.length);
    expect(indicators.bollMiddle.slice(0, 19)).toEqual(Array(19).fill(null));
    expect(indicators.bollUpper[24]).toBeGreaterThan(indicators.bollMiddle[24] ?? 0);
    expect(indicators.bollLower[24]).toBeLessThan(indicators.bollMiddle[24] ?? 0);
    expect(indicators.macd[30]).toBeGreaterThan(0);
  });

  it("calculates deterministic support, resistance and Fibonacci levels", () => {
    const levels = calculatePriceLevels(candles);

    expect(levels.support.length).toBeGreaterThan(0);
    expect(levels.resistance.length).toBeGreaterThan(0);
    expect(levels.fibonacci).toMatchObject({
      high: 125,
      low: 99,
      retracements: expect.arrayContaining([expect.objectContaining({ ratio: 0.5, price: 112 })]),
    });
    expect(levels.support.every((level) => level.price < 125)).toBe(true);
  });

  it("returns a labeled convergence candidate and a volume readout", () => {
    const annotations = calculateKlineAnnotations(candles);

    expect(annotations.trendLines).toHaveLength(2);
    expect(annotations.trendLines.map((line) => line.id)).toEqual([
      "triangle_upper",
      "triangle_lower",
    ]);
    expect(annotations.convergenceTriangle).toMatchObject({ status: "candidate" });
    expect(annotations.volumeSignal).toContain("成交量");
  });

  it("recognizes common candle patterns from OHLC relationships", () => {
    const patternCandles: KlineCandle[] = [
      { timestamp: "2026-02-01", open: 100, high: 101, low: 99, close: 100.1, volume: 1 },
      { timestamp: "2026-02-02", open: 99, high: 100.2, low: 95, close: 100, volume: 1 },
      { timestamp: "2026-02-03", open: 98, high: 101, low: 97.8, close: 100.8, volume: 1 },
    ];

    expect(detectCandlePatterns(patternCandles)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "doji", timestamp: "2026-02-01" }),
        expect.objectContaining({ name: "hammer", timestamp: "2026-02-02" }),
      ]),
    );
  });
});
