import type {
  TradfiPerpetualRecord,
  TradfiPerpetualResult,
  TradfiPerpetualSection,
} from "./types.js";

const TECHNICAL_VALUE_FIELDS = [
  "latestClose",
  "periodReturn",
  "return5",
  "return20",
  "sma5",
  "sma10",
  "sma20",
  "sma60",
  "ema12",
  "ema26",
  "macdDif",
  "macdDea",
  "macdHistogram",
  "rsi14",
  "bollingerMiddle20",
  "bollingerUpper20",
  "bollingerLower20",
  "bollingerBandwidth20",
  "bollingerPercentB20",
  "atr14",
  "volumeSma5",
  "volumeSma20",
  "volumeRatio20",
  "rangeSupport20",
  "rangeResistance20",
] as const;

export function formatTechnicalIndicatorsSection(section: TradfiPerpetualSection): string {
  const header = [
    `section: ${section.dataType}`,
    `status: ${section.status}`,
    `recordCount: ${section.records.length}`,
  ].join(" | ");
  if (section.records.length === 0) return `${header}\n\n(无数据)`;
  return `${header}\n\n${JSON.stringify(section.records, null, 2)}`;
}

/**
 * Keep the standard indicator payload below fin-core's inline-result threshold.
 * Raw OHLCV records remain in the provenance stash, but the Agent should never
 * need to open that file for indicators already calculated by this module.
 */
export function formatTechnicalAnalysisResult(result: TradfiPerpetualResult): string {
  const snapshot = result.sections.find((section) => section.dataType === "snapshot")?.records[0];
  const indicatorSection = result.sections.find(
    (section) => section.dataType === "technical_indicators",
  );
  const indicator = indicatorSection?.records[0];
  if (!indicator) return formatMissingIndicators(result, indicatorSection, snapshot);

  const values = Object.fromEntries(
    TECHNICAL_VALUE_FIELDS.flatMap((field) =>
      typeof indicator[field] === "number" ? [[field, indicator[field]]] : [],
    ),
  );
  const receivedBarCount = numericField(indicator, "receivedBarCount");
  const usedBarCount = numericField(indicator, "usedBarCount");
  const excludedOpenBars =
    receivedBarCount === undefined || usedBarCount === undefined
      ? 0
      : receivedBarCount - usedBarCount;
  const warnings = [
    indicator.dataSufficiency === "limited" ? "limited_history" : undefined,
    excludedOpenBars > 0 ? `excluded_open_bars:${excludedOpenBars}` : undefined,
    indicatorSection?.status === "partial" ? "partial_coverage" : undefined,
  ].filter(Boolean);
  const lines = [
    `section: technical_analysis_input | status: ${result.status} | isCashEquity: false`,
    `instrument: ${indicator.venueSymbol} | underlying: ${indicator.underlyingSymbol} | market: ${indicator.underlyingMarket} | contractType: ${indicator.contractType}`,
    snapshot ? `snapshot: ${JSON.stringify(compactSnapshot(snapshot))}` : undefined,
    `technical_indicators: ${JSON.stringify({
      formulaVersion: indicator.formulaVersion,
      methodology: indicator.methodology,
      interval: indicator.interval,
      usesClosedBarsOnly: indicator.usesClosedBarsOnly,
      receivedBarCount: indicator.receivedBarCount,
      usedBarCount: indicator.usedBarCount,
      dataSufficiency: indicator.dataSufficiency,
      barStartTime: indicator.barStartTime,
      barEndTime: indicator.barEndTime,
      values,
    })}`,
    `unavailableIndicators: ${JSON.stringify(indicator.unavailableIndicators ?? [])}`,
    `standardIndicatorPolicy: ${JSON.stringify(indicator.standardIndicatorPolicy)}`,
    `warnings: ${JSON.stringify(warnings)}`,
    indicatorSection?.coverage
      ? `coverage: ${JSON.stringify(indicatorSection.coverage)}`
      : undefined,
    "instruction: unavailable standard indicators are authoritative omissions; omit and report them. Do not fetch raw bars or use exec/Python to recompute them.",
    "notice: Binance TradFi perpetuals are USDT-settled derivatives, not cash equities.",
  ];
  return lines.filter(Boolean).join("\n");
}

function compactSnapshot(record: TradfiPerpetualRecord): Record<string, unknown> {
  return Object.fromEntries(
    ["timestamp", "lastPrice", "markPrice", "indexPrice"].flatMap((field) =>
      record[field] === undefined ? [] : [[field, record[field]]],
    ),
  );
}

function numericField(record: TradfiPerpetualRecord, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatMissingIndicators(
  result: TradfiPerpetualResult,
  section?: TradfiPerpetualSection,
  snapshot?: TradfiPerpetualRecord,
): string {
  const issues = [...(result.issues ?? []), ...(section?.issues ?? [])];
  return [
    `section: technical_analysis_input | status: ${result.status} | isCashEquity: false`,
    snapshot
      ? `instrument: ${snapshot.venueSymbol} | underlying: ${snapshot.underlyingSymbol} | market: ${snapshot.underlyingMarket} | contractType: ${snapshot.contractType}`
      : undefined,
    snapshot ? `snapshot: ${JSON.stringify(compactSnapshot(snapshot))}` : undefined,
    "technical_indicators: unavailable",
    'standardIndicatorPolicy: {"authority":"tool_only","recomputeAllowed":false,"unavailableAction":"omit_and_report"}',
    issues.length ? `issues: ${JSON.stringify(issues)}` : undefined,
    section?.coverage ? `coverage: ${JSON.stringify(section.coverage)}` : undefined,
    "instruction: report the indicator data gap; do not fetch raw bars or use exec/Python to manufacture standard indicators.",
    "notice: Binance TradFi perpetuals are USDT-settled derivatives, not cash equities or ownership of the underlying security.",
  ]
    .filter(Boolean)
    .join("\n");
}
