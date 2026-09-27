import { calculatePriceLevels } from "./levels.js";
import type {
  InstrumentIdentity,
  KlineCandle,
  ScenarioBandPoint,
  ScenarioId,
  ScenarioPath,
  ScenarioPoint,
  ScenarioResearchContribution,
  ScenarioResearchEvidence,
  ScenarioScoreFactor,
} from "./types.js";

const FORECAST_TRADING_DAYS = 10;
const MIN_PROBABILITY_SAMPLE = 20;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function nextWeekday(timestamp: string): string {
  const date = new Date(`${timestamp}T00:00:00Z`);
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function buildPointsAndBand(
  lastTimestamp: string,
  lastClose: number,
  dailyRange: number,
  shape: ScenarioId,
): { points: ScenarioPoint[]; band: ScenarioBandPoint[] } {
  const points: ScenarioPoint[] = [];
  const band: ScenarioBandPoint[] = [];
  let timestamp = lastTimestamp;
  const horizonMove = clamp(
    (dailyRange / Math.max(lastClose, 0.01)) * Math.sqrt(10) * 1.2,
    0.03,
    0.1,
  );

  for (let index = 0; index < FORECAST_TRADING_DAYS; index += 1) {
    timestamp = nextWeekday(timestamp);
    const progress = (index + 1) / FORECAST_TRADING_DAYS;
    const cycle = Math.sin((index + 1) * 1.15) * dailyRange * 0.22;
    let directionalMove = 0;

    if (shape === "range_then_rally") {
      const rallyProgress = clamp((progress - 0.4) / 0.6, 0, 1);
      directionalMove = horizonMove * 0.85 * rallyProgress;
    } else if (shape === "rally") {
      directionalMove = horizonMove * progress;
    } else if (shape === "pullback") {
      directionalMove = -horizonMove * 0.8 * progress;
    }

    const rangeCycle = shape === "range" ? cycle : cycle * 0.55;
    const price = round(lastClose * (1 + directionalMove) + rangeCycle);
    const bandWidth = dailyRange * (0.35 + Math.sqrt(index + 1) * 0.12);
    points.push({ timestamp, price });
    band.push({ timestamp, lower: round(price - bandWidth), upper: round(price + bandWidth) });
  }
  return { points, band };
}

type TechnicalSignals = {
  trend20d: number;
  momentum5d: number;
  rangePosition: number;
  volumeRatio: number;
};

function calculateTechnicalSignals(candles: KlineCandle[]): TechnicalSignals {
  const latest = candles.at(-1)!;
  const recent20 = candles.slice(-20);
  const recent5 = candles.slice(-5);
  const priorVolumeWindow = candles.slice(-20, -5);
  const sma20 = mean(recent20.map((candle) => candle.close));
  const comparisonClose = candles.at(-6)?.close ?? candles[0]?.close ?? latest.close;
  const rangeLow = Math.min(...recent20.map((candle) => candle.low));
  const rangeHigh = Math.max(...recent20.map((candle) => candle.high));
  const previousVolume = mean(priorVolumeWindow.map((candle) => candle.volume));

  return {
    trend20d: clamp((latest.close / Math.max(sma20, 0.01) - 1) / 0.06, -1, 1),
    momentum5d: clamp((latest.close / Math.max(comparisonClose, 0.01) - 1) / 0.04, -1, 1),
    rangePosition: clamp((latest.close - rangeLow) / Math.max(rangeHigh - rangeLow, 0.01), 0, 1),
    volumeRatio: clamp(
      (mean(recent5.map((candle) => candle.volume)) / Math.max(previousVolume, 1) - 1) / 0.5,
      -1,
      1,
    ),
  };
}

function factor(
  signal: ScenarioScoreFactor["signal"],
  value: number,
  contribution: number,
  evidence: string,
): ScenarioScoreFactor {
  return { signal, value: round(value), contribution: round(contribution), evidence };
}

function buildScoreFactors(id: ScenarioId, signals: TechnicalSignals): ScenarioScoreFactor[] {
  const centeredPosition = (signals.rangePosition - 0.5) * 2;
  const positiveTrend = Math.max(signals.trend20d, 0);
  const negativeTrend = Math.max(-signals.trend20d, 0);
  const positiveMomentum = Math.max(signals.momentum5d, 0);
  const negativeMomentum = Math.max(-signals.momentum5d, 0);

  if (id === "range") {
    return [
      factor("base_rate", 1, 1.1, "横盘场景的起始权重"),
      factor(
        "trend_20d",
        signals.trend20d,
        -Math.abs(signals.trend20d) * 0.35,
        "趋势越强，横盘权重越低",
      ),
      factor(
        "momentum_5d",
        signals.momentum5d,
        -Math.abs(signals.momentum5d) * 0.25,
        "短期动量越强，横盘权重越低",
      ),
      factor(
        "range_position",
        centeredPosition,
        (1 - Math.abs(centeredPosition)) * 0.2,
        "靠近区间中部支持震荡假设",
      ),
      factor(
        "volume_ratio",
        signals.volumeRatio,
        -Math.max(signals.volumeRatio, 0) * 0.12,
        "放量会降低纯横盘权重",
      ),
    ];
  }

  if (id === "range_then_rally") {
    return [
      factor("base_rate", 1, 0.95, "先整理后上行场景的起始权重"),
      factor("trend_20d", signals.trend20d, positiveTrend * 0.28, "中期正趋势支持整理后续涨"),
      factor(
        "momentum_5d",
        signals.momentum5d,
        (0.5 - Math.abs(signals.momentum5d)) * 0.18,
        "温和动量更符合先整理",
      ),
      factor(
        "range_position",
        centeredPosition,
        Math.max(-centeredPosition, 0) * 0.12,
        "未处于区间高位保留上行空间",
      ),
      factor(
        "volume_ratio",
        signals.volumeRatio,
        -Math.max(signals.volumeRatio, 0) * 0.08,
        "尚未放量更符合等待确认",
      ),
    ];
  }

  if (id === "rally") {
    return [
      factor("base_rate", 1, 0.75, "直接拉升场景的起始权重"),
      factor(
        "trend_20d",
        signals.trend20d,
        positiveTrend * 0.42 - negativeTrend * 0.2,
        "中期趋势决定突破方向",
      ),
      factor(
        "momentum_5d",
        signals.momentum5d,
        positiveMomentum * 0.36 - negativeMomentum * 0.18,
        "正动量支持延续上行",
      ),
      factor(
        "range_position",
        centeredPosition,
        Math.max(centeredPosition, 0) * 0.16,
        "接近区间上沿支持突破观察",
      ),
      factor(
        "volume_ratio",
        signals.volumeRatio,
        Math.max(signals.volumeRatio, 0) * 0.2,
        "放量提高突破权重",
      ),
    ];
  }

  return [
    factor("base_rate", 1, 0.75, "下探场景的起始权重"),
    factor(
      "trend_20d",
      signals.trend20d,
      negativeTrend * 0.42 - positiveTrend * 0.14,
      "负趋势提高下探权重",
    ),
    factor(
      "momentum_5d",
      signals.momentum5d,
      negativeMomentum * 0.36 - positiveMomentum * 0.12,
      "负动量支持继续回撤",
    ),
    factor(
      "range_position",
      centeredPosition,
      Math.max(centeredPosition, 0) * 0.14,
      "区间高位增加回撤风险",
    ),
    factor(
      "volume_ratio",
      signals.volumeRatio,
      Math.max(-signals.volumeRatio, 0) * 0.08,
      "量能收缩提高回撤观察权重",
    ),
  ];
}

function scoreFactors(factors: ScenarioScoreFactor[]): number {
  return Math.max(
    factors.reduce((sum, item) => sum + item.contribution, 0),
    0.05,
  );
}

const RESEARCH_KIND_WEIGHTS: Record<ScenarioResearchEvidence["kind"], number> = {
  event: 0.34,
  fundamental: 0.28,
  news: 0.24,
  macro: 0.2,
  sentiment: 0.15,
};

const SCENARIO_DIRECTION_MULTIPLIERS: Record<
  ScenarioId,
  Record<ScenarioResearchEvidence["direction"], number>
> = {
  range: { bullish: -0.18, bearish: -0.18, neutral: 0.45 },
  range_then_rally: { bullish: 0.82, bearish: -0.62, neutral: 0.08 },
  rally: { bullish: 1.08, bearish: -0.88, neutral: -0.08 },
  pullback: { bullish: -0.78, bearish: 1, neutral: 0.08 },
};

function buildResearchContributions(
  id: ScenarioId,
  researchEvidence: ScenarioResearchEvidence[],
): ScenarioResearchContribution[] {
  return researchEvidence.map((item) => ({
    evidenceId: item.id,
    kind: item.kind,
    direction: item.direction,
    confidence: round(clamp(item.confidence, 0, 1)),
    contribution: round(
      RESEARCH_KIND_WEIGHTS[item.kind] *
        clamp(item.confidence, 0, 1) *
        SCENARIO_DIRECTION_MULTIPLIERS[id][item.direction],
    ),
    evidence: `${item.summary}（${item.source}，截至 ${item.asOf}）`,
  }));
}

function scoreResearchContributions(contributions: ScenarioResearchContribution[]): number {
  return contributions.reduce((sum, item) => sum + item.contribution, 0);
}

function normalizeProbabilities(scores: number[]): number[] {
  const total = scores.reduce((sum, score) => sum + score, 0);
  const rawBasisPoints = scores.map((score) => (score / total) * 10_000);
  const allocated = rawBasisPoints.map(Math.floor);
  let remaining = 10_000 - allocated.reduce((sum, value) => sum + value, 0);
  const remainderOrder = rawBasisPoints
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  for (const item of remainderOrder) {
    if (remaining === 0) break;
    allocated[item.index] = (allocated[item.index] ?? 0) + 1;
    remaining -= 1;
  }

  return allocated.map((basisPoints) => basisPoints / 10_000);
}

export function buildScenarioPaths(
  candles: KlineCandle[],
  instrument: InstrumentIdentity,
  researchEvidence: ScenarioResearchEvidence[] = [],
): ScenarioPath[] {
  if (candles.length === 0) return [];
  const latest = candles.at(-1)!;
  const recentRanges = candles.slice(-14).map((candle) => candle.high - candle.low);
  const dailyRange =
    recentRanges.reduce((sum, range) => sum + range, 0) / Math.max(recentRanges.length, 1);
  const levels = calculatePriceLevels(candles);
  const support = levels.support[0]?.price ?? latest.close - dailyRange;
  const resistance = levels.resistance[0]?.price ?? latest.close + dailyRange;
  const context = `${instrument.symbol} ${instrument.assetType} 的结构化 OHLCV 与关键位`;
  const signals = calculateTechnicalSignals(candles);
  const ids: ScenarioId[] = ["range", "range_then_rally", "rally", "pullback"];
  const factorsById = ids.map((id) => buildScoreFactors(id, signals));
  const usableResearchEvidence = researchEvidence.filter((item) => item.asOf <= latest.timestamp);
  const researchContributionsById = ids.map((id) =>
    buildResearchContributions(id, usableResearchEvidence),
  );
  const hasEnoughHistory = candles.length >= MIN_PROBABILITY_SAMPLE;
  const probabilities = hasEnoughHistory
    ? normalizeProbabilities(
        factorsById.map(
          (factors, index) =>
            scoreFactors(factors) +
            scoreResearchContributions(researchContributionsById[index] ?? []),
        ),
      )
    : ids.map(() => null);
  const probabilityStatus = hasEnoughHistory ? "heuristic" : "insufficient_data";
  const probabilityEvidence = !hasEnoughHistory
    ? `历史样本不足 ${MIN_PROBABILITY_SAMPLE} 根，未生成场景概率`
    : usableResearchEvidence.length > 0
      ? "概率为基于量价技术信号与投研证据的启发式权重，未经过回测校准"
      : "概率为仅基于量价技术信号的启发式权重，未经过回测校准";
  const pathEvidence = "未来点为场景趋势线与价格带，不是未来 OHLCV K 线";
  const probabilityScope =
    usableResearchEvidence.length > 0
      ? "technical_and_research_evidence"
      : "technical_signals_only";
  const researchEvidenceSummary =
    usableResearchEvidence.length > 0
      ? `已纳入 ${usableResearchEvidence.length} 条带来源和时点的投研证据调整权重`
      : "未提供可用投研证据，概率仅反映量价技术信号";

  const scenarioDefinitions: Array<
    Pick<ScenarioPath, "id" | "label" | "bias" | "color" | "thesis" | "trigger" | "invalidatedBy">
  > = [
    {
      id: "range",
      label: "横盘震荡",
      bias: "neutral",
      color: "#718096",
      thesis: "信息大致符合已有预期，价格在关键位之间震荡消化。",
      trigger: `维持 ${support.toFixed(2)} - ${resistance.toFixed(2)} 区间且量能未显著放大`,
      invalidatedBy: `有效突破阻力 ${resistance.toFixed(2)} 或跌破支撑 ${support.toFixed(2)}`,
    },
    {
      id: "range_then_rally",
      label: "先横盘后拉升",
      bias: "bullish",
      color: "#2f80a8",
      thesis: "前半段等待事件或量能确认，随后向阻力上方扩展。",
      trigger: `先守住支撑 ${support.toFixed(2)}，再放量突破阻力 ${resistance.toFixed(2)}`,
      invalidatedBy: `整理阶段跌破支撑 ${support.toFixed(2)}`,
    },
    {
      id: "rally",
      label: "直接突破拉升",
      bias: "bullish",
      color: "#169b7b",
      thesis: "事件显著超预期或风险偏好回升，价格延续强势并突破阻力。",
      trigger: `放量突破阻力 ${resistance.toFixed(2)} 或事件数据显著超预期`,
      invalidatedBy: `突破失败并跌回阻力 ${resistance.toFixed(2)} 下方`,
    },
    {
      id: "pullback",
      label: "回撤下探",
      bias: "bearish",
      color: "#d95c5c",
      thesis: "事件不及预期或风险偏好回落，价格向支撑区回撤。",
      trigger: `跌破支撑 ${support.toFixed(2)} 或事件数据低于市场预期`,
      invalidatedBy: `重新站回支撑 ${support.toFixed(2)} 并放量`,
    },
  ];

  return scenarioDefinitions.map((definition, index) => {
    const projection = buildPointsAndBand(
      latest.timestamp,
      latest.close,
      dailyRange,
      definition.id,
    );
    return {
      ...definition,
      forecastOnly: true,
      horizonTradingDays: FORECAST_TRADING_DAYS,
      ...projection,
      probability: probabilities[index] ?? null,
      probabilityStatus,
      probabilityMethod:
        usableResearchEvidence.length > 0
          ? "deterministic-signals-evidence-v1"
          : "deterministic-signals-v1",
      probabilityScope,
      scoreFactors: factorsById[index] ?? [],
      researchContributions: researchContributionsById[index] ?? [],
      evidence: [context, probabilityEvidence, researchEvidenceSummary, pathEvidence],
    };
  });
}
