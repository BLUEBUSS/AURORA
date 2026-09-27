import type { KlineCandle, KlineIndicators } from "./types.js";

function simpleMovingAverage(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = [];
  let rollingSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    rollingSum += values[index] ?? 0;
    if (index >= period) {
      rollingSum -= values[index - period] ?? 0;
    }
    output.push(index >= period - 1 ? rollingSum / period : null);
  }

  return output;
}

function relativeStrengthIndex(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = values.map(() => null);
  if (values.length <= period) return output;

  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = (values[index] ?? 0) - (values[index - 1] ?? 0);
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }
  averageGain /= period;
  averageLoss /= period;
  output[period] = rsiValue(averageGain, averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const change = (values[index] ?? 0) - (values[index - 1] ?? 0);
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    output[index] = rsiValue(averageGain, averageLoss);
  }

  return output;
}

function exponentialMovingAverage(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = values.map(() => null);
  if (values.length < period) return output;

  const multiplier = 2 / (period + 1);
  let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = previous;
  for (let index = period; index < values.length; index += 1) {
    previous = (values[index] ?? previous) * multiplier + previous * (1 - multiplier);
    output[index] = previous;
  }
  return output;
}

function bollingerBands(
  values: number[],
  period: number,
  deviations: number,
): Pick<KlineIndicators, "bollUpper" | "bollMiddle" | "bollLower"> {
  const middle = simpleMovingAverage(values, period);
  const upper: Array<number | null> = values.map(() => null);
  const lower: Array<number | null> = values.map(() => null);
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    const mean = middle[index];
    if (mean === null || mean === undefined) continue;
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(window.length, 1);
    const band = Math.sqrt(variance) * deviations;
    upper[index] = mean + band;
    lower[index] = mean - band;
  }
  return { bollUpper: upper, bollMiddle: middle, bollLower: lower };
}

function macdSeries(
  values: number[],
): Pick<KlineIndicators, "macd" | "macdSignal" | "macdHistogram"> {
  const fast = exponentialMovingAverage(values, 12);
  const slow = exponentialMovingAverage(values, 26);
  const macd: Array<number | null> = values.map((_, index) => {
    const fastValue = fast[index];
    const slowValue = slow[index];
    return fastValue == null || slowValue == null ? null : fastValue - slowValue;
  });

  const compactMacd = macd.filter((value): value is number => value !== null);
  const compactSignal = exponentialMovingAverage(compactMacd, 9);
  const signal: Array<number | null> = values.map(() => null);
  let compactIndex = 0;
  for (let index = 0; index < macd.length; index += 1) {
    if (macd[index] === null) continue;
    signal[index] = compactSignal[compactIndex] ?? null;
    compactIndex += 1;
  }
  const histogram = macd.map((value, index) => {
    const signalValue = signal[index];
    return value == null || signalValue == null ? null : value - signalValue;
  });
  return { macd, macdSignal: signal, macdHistogram: histogram };
}

function rsiValue(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0) return 100;
  if (averageGain === 0) return 0;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

export function calculateKlineIndicators(candles: KlineCandle[]): KlineIndicators {
  const closes = candles.map((candle) => candle.close);
  return {
    ma20: simpleMovingAverage(closes, 20),
    rsi14: relativeStrengthIndex(closes, 14),
    ...bollingerBands(closes, 20, 2),
    ...macdSeries(closes),
  };
}
