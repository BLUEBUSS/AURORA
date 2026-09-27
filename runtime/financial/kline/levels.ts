import type { KlineCandle, PriceLevel, PriceLevels } from "./types.js";

const FIBONACCI_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function makeLevel(
  kind: PriceLevel["kind"],
  price: number,
  basis: string,
  strength: number,
): PriceLevel {
  const rounded = round(price);
  const width = Math.max(rounded * 0.004, 0.01);
  return {
    kind,
    price: rounded,
    range: [round(rounded - width), round(rounded + width)],
    strength: Math.max(1, Math.min(5, strength)),
    basis,
  };
}

function localExtrema(candles: KlineCandle[], kind: "low" | "high"): number[] {
  const values = candles.map((candle) => (kind === "low" ? candle.low : candle.high));
  const extrema: number[] = [];
  for (let index = 2; index < values.length - 2; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    const neighborhood = values.slice(index - 2, index + 3);
    const isExtreme =
      kind === "low"
        ? neighborhood.every((candidate) => value <= candidate)
        : neighborhood.every((candidate) => value >= candidate);
    if (isExtreme) extrema.push(value);
  }
  return extrema;
}

function uniqueLevels(
  values: number[],
  fallback: number,
  reference: number,
  kind: PriceLevel["kind"],
): PriceLevel[] {
  const directionalValues = values.filter((value) =>
    kind === "support" ? value <= reference : value >= reference,
  );
  const sorted = [...directionalValues, fallback]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => (kind === "support" ? b - a : a - b));
  const levels: PriceLevel[] = [];
  for (const value of sorted) {
    if (levels.some((level) => Math.abs(level.price - value) <= Math.max(value * 0.01, 0.05))) {
      continue;
    }
    levels.push(
      makeLevel(
        kind,
        value,
        directionalValues.includes(value) ? "局部拐点" : "区间极值",
        directionalValues.includes(value) ? 2 : 1,
      ),
    );
    if (levels.length >= 3) break;
  }
  return levels;
}

export function calculatePriceLevels(candles: KlineCandle[]): PriceLevels {
  if (candles.length === 0) {
    return { support: [], resistance: [], fibonacci: { high: 0, low: 0, retracements: [] } };
  }

  const lows = candles.map((candle) => candle.low);
  const highs = candles.map((candle) => candle.high);
  const low = Math.min(...lows);
  const high = Math.max(...highs);
  const reference = candles.at(-1)?.close ?? (low + high) / 2;
  return {
    support: uniqueLevels(localExtrema(candles, "low"), low, reference, "support"),
    resistance: uniqueLevels(localExtrema(candles, "high"), high, reference, "resistance"),
    fibonacci: {
      high: round(high),
      low: round(low),
      retracements: FIBONACCI_RATIOS.map((ratio) => ({
        ratio,
        price: round(high - (high - low) * ratio),
      })),
    },
  };
}
