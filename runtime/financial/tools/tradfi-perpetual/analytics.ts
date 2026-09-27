import type {
  TradfiIndicatorAvailability,
  TradfiPerpetualQuery,
  TradfiPerpetualRecord,
  TradfiPerpetualResult,
  TradfiPerpetualSection,
  TradfiTechnicalIndicatorsRecord,
} from "./types.js";

const FULL_INDICATOR_BAR_COUNT = 60;

interface PriceBar {
  record: TradfiPerpetualRecord;
  close: number;
  high: number;
  low: number;
  volume?: number;
  time: number;
}

interface IndicatorCollector {
  calculated: string[];
  unavailable: TradfiIndicatorAvailability[];
  values: Record<string, number>;
}

export function enrichTradfiPerpetualResultWithAnalytics(
  query: TradfiPerpetualQuery,
  result: TradfiPerpetualResult,
): TradfiPerpetualResult {
  if (
    query.action !== "technical_analysis_input" ||
    result.sections.some((section) => section.dataType === "technical_indicators")
  ) {
    return result;
  }

  const tradeSection = result.sections.find((section) => section.dataType === "trade_ohlcv");
  const derivedSection = deriveTechnicalIndicatorsSection(query, tradeSection);
  const sections = [...result.sections, derivedSection];
  return {
    ...result,
    status: sections.some((section) => section.status === "partial") ? "partial" : "complete",
    sections,
  };
}

export function deriveTechnicalIndicatorsSection(
  query: TradfiPerpetualQuery,
  tradeSection?: TradfiPerpetualSection,
): TradfiPerpetualSection {
  const receivedBarCount = tradeSection?.records.length ?? 0;
  const bars = toClosedPriceBars(tradeSection?.records ?? []);
  if (bars.length === 0) {
    return {
      dataType: "technical_indicators",
      status: "partial",
      records: [],
      coverage: tradeSection?.coverage,
      issues: [
        {
          code: "PARTIAL_DATA",
          message: "No closed trade_ohlcv bars were available for deterministic indicators.",
        },
      ],
    };
  }

  const latest = bars.at(-1)!;
  const collector: IndicatorCollector = { calculated: [], unavailable: [], values: {} };
  addPriceAndReturnIndicators(bars, collector);
  addMovingAverages(bars, collector);
  addMacd(bars, collector);
  addRsi(bars, collector);
  addBollingerBands(bars, collector);
  addAtr(bars, collector);
  addVolumeIndicators(bars, collector);
  addRangeLevels(bars, collector);

  const warnings: string[] = [];
  if (bars.length < FULL_INDICATOR_BAR_COUNT) {
    warnings.push(
      `Only ${bars.length} closed bars were available; indicators requiring more history are omitted.`,
    );
  }
  const excludedOpenBars = receivedBarCount - bars.length;
  if (excludedOpenBars > 0) {
    warnings.push(`${excludedOpenBars} still-open bar(s) were excluded from calculation.`);
  }
  if (tradeSection?.status === "partial") {
    warnings.push("The source trade_ohlcv section has partial historical coverage.");
  }

  const record: TradfiTechnicalIndicatorsRecord = {
    ...copyIdentity(latest.record),
    dataType: "technical_indicators",
    provider: latest.record.provider,
    sourceEndpoint: "DERIVED from trade_ohlcv (GET /fapi/v1/klines)",
    timestamp: new Date(latest.time).toISOString(),
    methodology: "derived",
    formulaVersion: "tradfi-ta-v1",
    inputDataType: "trade_ohlcv",
    interval: query.interval,
    usesClosedBarsOnly: true,
    receivedBarCount,
    usedBarCount: bars.length,
    dataSufficiency: bars.length >= FULL_INDICATOR_BAR_COUNT ? "full" : "limited",
    barStartTime: new Date(bars[0].time).toISOString(),
    barEndTime: new Date(latest.time).toISOString(),
    calculatedIndicators: collector.calculated,
    unavailableIndicators: collector.unavailable,
    warnings,
    standardIndicatorPolicy: {
      authority: "tool_only",
      recomputeAllowed: false,
      unavailableAction: "omit_and_report",
    },
    ...collector.values,
  };

  const partial = tradeSection?.status === "partial";
  return {
    dataType: "technical_indicators",
    status: partial ? "partial" : "complete",
    records: [record],
    coverage: tradeSection?.coverage,
    issues: partial
      ? [
          {
            code: "PARTIAL_DATA",
            message: "Indicators were calculated from the available partial trade_ohlcv coverage.",
          },
        ]
      : undefined,
  };
}

function toClosedPriceBars(records: TradfiPerpetualRecord[]): PriceBar[] {
  return records
    .filter((record) => record.isClosed !== false)
    .map((record): PriceBar | undefined => {
      const close = finiteNumber(record.close);
      const high = finiteNumber(record.high);
      const low = finiteNumber(record.low);
      const time = recordTime(record);
      if (close === undefined || high === undefined || low === undefined || time === undefined) {
        return undefined;
      }
      return { record, close, high, low, volume: finiteNumber(record.volume), time };
    })
    .filter((bar): bar is PriceBar => Boolean(bar))
    .sort((left, right) => left.time - right.time);
}

function addPriceAndReturnIndicators(bars: PriceBar[], collector: IndicatorCollector): void {
  const closes = bars.map((bar) => bar.close);
  collector.values.latestClose = round(closes.at(-1)!);
  collector.values.periodReturn = roundReturn(closes.at(-1)!, closes[0]);
  collector.calculated.push("latestClose", "periodReturn");
  addReturn(closes, 5, "return5", collector);
  addReturn(closes, 20, "return20", collector);
}

function addMovingAverages(bars: PriceBar[], collector: IndicatorCollector): void {
  const closes = bars.map((bar) => bar.close);
  for (const period of [5, 10, 20, 60]) {
    addIndicator(collector, `sma${period}`, period, bars.length, () => sma(closes, period));
  }
}

function addMacd(bars: PriceBar[], collector: IndicatorCollector): void {
  const requiredBars = 34;
  if (!hasBars(collector, "macd(12,26,9)", requiredBars, bars.length)) return;
  const closes = bars.map((bar) => bar.close);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const difSeries = ema12.map((value, index) => value - ema26[index]);
  const deaSeries = emaSeries(difSeries, 9);
  const dif = difSeries.at(-1)!;
  const dea = deaSeries.at(-1)!;
  collector.values.ema12 = round(ema12.at(-1)!);
  collector.values.ema26 = round(ema26.at(-1)!);
  collector.values.macdDif = round(dif);
  collector.values.macdDea = round(dea);
  collector.values.macdHistogram = round(2 * (dif - dea));
  collector.calculated.push("ema12", "ema26", "macdDif", "macdDea", "macdHistogram");
}

function addRsi(bars: PriceBar[], collector: IndicatorCollector): void {
  addIndicator(collector, "rsi14", 28, bars.length, () => rsiWilder(bars, 14));
}

function addBollingerBands(bars: PriceBar[], collector: IndicatorCollector): void {
  const requiredBars = 40;
  if (!hasBars(collector, "bollinger(20,2)", requiredBars, bars.length)) return;
  const closes = bars.map((bar) => bar.close);
  const window = closes.slice(-20);
  const middle = average(window);
  const standardDeviation = Math.sqrt(average(window.map((value) => (value - middle) ** 2)));
  const upper = middle + 2 * standardDeviation;
  const lower = middle - 2 * standardDeviation;
  const latestClose = closes.at(-1)!;
  collector.values.bollingerMiddle20 = round(middle);
  collector.values.bollingerUpper20 = round(upper);
  collector.values.bollingerLower20 = round(lower);
  collector.values.bollingerBandwidth20 = roundRatio(upper - lower, middle);
  collector.values.bollingerPercentB20 = roundRatio(latestClose - lower, upper - lower);
  collector.calculated.push(
    "bollingerMiddle20",
    "bollingerUpper20",
    "bollingerLower20",
    "bollingerBandwidth20",
    "bollingerPercentB20",
  );
}

function addAtr(bars: PriceBar[], collector: IndicatorCollector): void {
  addIndicator(collector, "atr14", 28, bars.length, () => atrWilder(bars, 14));
}

function addVolumeIndicators(bars: PriceBar[], collector: IndicatorCollector): void {
  const volumes = bars.map((bar) => bar.volume);
  if (volumes.some((volume) => volume === undefined)) {
    collector.unavailable.push({
      indicator: "volumeSma5/volumeSma20/volumeRatio20",
      requiredBars: 20,
      availableBars: volumes.filter((volume) => volume !== undefined).length,
    });
    return;
  }
  const numericVolumes = volumes as number[];
  addIndicator(collector, "volumeSma5", 5, bars.length, () => sma(numericVolumes, 5));
  if (!hasBars(collector, "volumeSma20/volumeRatio20", 20, bars.length)) return;
  const volumeSma20 = sma(numericVolumes, 20);
  collector.values.volumeSma20 = round(volumeSma20);
  collector.values.volumeRatio20 = roundRatio(numericVolumes.at(-1)!, volumeSma20);
  collector.calculated.push("volumeSma20", "volumeRatio20");
}

function addRangeLevels(bars: PriceBar[], collector: IndicatorCollector): void {
  if (!hasBars(collector, "rangeSupport20/rangeResistance20", 20, bars.length)) return;
  const window = bars.slice(-20);
  collector.values.rangeSupport20 = round(Math.min(...window.map((bar) => bar.low)));
  collector.values.rangeResistance20 = round(Math.max(...window.map((bar) => bar.high)));
  collector.calculated.push("rangeSupport20", "rangeResistance20");
}

function addReturn(
  closes: number[],
  period: number,
  name: string,
  collector: IndicatorCollector,
): void {
  const requiredBars = period + 1;
  if (!hasBars(collector, name, requiredBars, closes.length)) return;
  collector.values[name] = roundReturn(closes.at(-1)!, closes.at(-(period + 1))!);
  collector.calculated.push(name);
}

function addIndicator(
  collector: IndicatorCollector,
  name: string,
  requiredBars: number,
  availableBars: number,
  calculate: () => number,
): void {
  if (!hasBars(collector, name, requiredBars, availableBars)) return;
  collector.values[name] = round(calculate());
  collector.calculated.push(name);
}

function hasBars(
  collector: IndicatorCollector,
  indicator: string,
  requiredBars: number,
  availableBars: number,
): boolean {
  if (availableBars >= requiredBars) return true;
  collector.unavailable.push({ indicator, requiredBars, availableBars });
  return false;
}

function sma(values: number[], period: number): number {
  return average(values.slice(-period));
}

function emaSeries(values: number[], period: number): number[] {
  const alpha = 2 / (period + 1);
  const output = [values[0]];
  for (let index = 1; index < values.length; index++) {
    output.push(alpha * values[index] + (1 - alpha) * output[index - 1]);
  }
  return output;
}

function rsiWilder(bars: PriceBar[], period: number): number {
  const closes = bars.map((bar) => bar.close);
  let gainSum = 0;
  let lossSum = 0;
  for (let index = 1; index <= period; index++) {
    const delta = closes[index] - closes[index - 1];
    gainSum += Math.max(delta, 0);
    lossSum += Math.max(-delta, 0);
  }
  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;
  for (let index = period + 1; index < closes.length; index++) {
    const delta = closes[index] - closes[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

function atrWilder(bars: PriceBar[], period: number): number {
  const trueRanges = bars.map((bar, index) => {
    if (index === 0) return bar.high - bar.low;
    const previousClose = bars[index - 1].close;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    );
  });
  let value = average(trueRanges.slice(0, period));
  for (let index = period; index < trueRanges.length; index++) {
    value = (value * (period - 1) + trueRanges[index]) / period;
  }
  return value;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundReturn(latest: number, earlier: number): number {
  return roundRatio(latest - earlier, earlier);
}

function roundRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value: number): number {
  return Number(value.toFixed(8));
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordTime(record: TradfiPerpetualRecord): number | undefined {
  for (const value of [record.closeTime, record.openTime, record.timestamp]) {
    if (typeof value !== "string") continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function copyIdentity(record: TradfiPerpetualRecord): TradfiPerpetualRecord {
  return {
    dataType: record.dataType,
    instrumentClass: record.instrumentClass,
    venue: record.venue,
    venueSymbol: record.venueSymbol,
    underlyingSymbol: record.underlyingSymbol,
    underlyingMarket: record.underlyingMarket,
    underlyingType: record.underlyingType,
    underlyingSubTypes: record.underlyingSubTypes,
    quoteAsset: record.quoteAsset,
    settlementAsset: record.settlementAsset,
    contractType: record.contractType,
    tradingStatus: record.tradingStatus,
    onboardDate: record.onboardDate,
    isCashEquity: record.isCashEquity,
    provider: record.provider,
    sourceEndpoint: record.sourceEndpoint,
    timestamp: record.timestamp,
  };
}
