import type {
  DataProvenance,
  DataQualitySummary,
  DataSourceReference,
  MarketSeriesContract,
  MarketSeriesIssue,
} from "../data-contracts/index.js";
import type { ScenarioPath } from "./scenario-types.js";

export type {
  ScenarioBandPoint,
  ScenarioId,
  ScenarioPath,
  ScenarioPoint,
  ScenarioProbabilityStatus,
  ScenarioResearchContribution,
  ScenarioResearchEvidence,
  ScenarioScoreFactor,
} from "./scenario-types.js";

export type KlineMarket = "CN" | "HK" | "US" | "CRYPTO" | "BINANCE_TRADFI";

export type KlineAssetType = "cash_equity" | "crypto_spot" | "perpetual" | "index";

export type InstrumentIdentity = {
  symbol: string;
  displayName: string;
  market: KlineMarket;
  venue: string;
  assetType: KlineAssetType;
  currency: string;
};

export type KlineCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Present only when the upstream explicitly reports an unfinished interval. */
  status?: "open";
};

export type KlineSeries = {
  name: string;
  values: Array<number | null>;
  color: string;
};

export type KlineIndicators = {
  ma20: Array<number | null>;
  rsi14: Array<number | null>;
  bollUpper: Array<number | null>;
  bollMiddle: Array<number | null>;
  bollLower: Array<number | null>;
  macd: Array<number | null>;
  macdSignal: Array<number | null>;
  macdHistogram: Array<number | null>;
};

export type KlineProvenance = DataProvenance;

export type KlineCoverage = {
  start: string;
  end: string;
  requested?: string;
  status: "complete" | "partial" | "unknown";
};

export type PriceLevel = {
  kind: "support" | "resistance";
  price: number;
  range: [number, number];
  strength: number;
  basis: string;
};

export type FibonacciLevel = {
  ratio: number;
  price: number;
};

export type PriceLevels = {
  support: PriceLevel[];
  resistance: PriceLevel[];
  fibonacci: {
    high: number;
    low: number;
    retracements: FibonacciLevel[];
  };
};

export type KlinePattern = {
  name: "doji" | "hammer" | "shooting_star" | "bullish_engulfing" | "bearish_engulfing";
  label: string;
  timestamp: string;
  bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  evidence: string;
};

export type KlineTrendLine = {
  id: "triangle_upper" | "triangle_lower";
  label: string;
  kind: "support" | "resistance";
  start: { timestamp: string; price: number };
  end: { timestamp: string; price: number };
  evidence: string;
};

export type KlineConvergenceTriangle = {
  status: "candidate";
  startTimestamp: string;
  endTimestamp: string;
  apexTimestamp: string;
  upperLine: KlineTrendLine;
  lowerLine: KlineTrendLine;
  breakoutBias: "bullish" | "bearish" | "neutral";
  confidence: number;
  evidence: string;
};

export type KlineAnnotations = {
  trendLines: KlineTrendLine[];
  convergenceTriangle?: KlineConvergenceTriangle;
  volumeSignal?: string;
};

export type ChartReadout = {
  schemaVersion: "chart-readout.v1";
  source: { kind: "image"; fileId: string };
  identifiedInstrument?: InstrumentIdentity;
  timeframe?: string;
  visibleIndicators: string[];
  candidatePatterns: Array<{
    name: string;
    window?: string;
    confidence: number;
    evidence: string;
  }>;
  levels: Array<{
    kind: "support" | "resistance";
    price?: number;
    range?: [number, number];
    confidence: number;
    basis: string;
  }>;
  riskNotes: string[];
  missingInformation: string[];
  verification: {
    status: "not_available" | "requested" | "verified";
    comparedToStructuredData?: boolean;
  };
};

export type NormalizedKlinePayload = MarketSeriesContract<
  InstrumentIdentity,
  KlineCandle,
  KlineCoverage,
  KlineProvenance
>;

export type KlineChartSpec = {
  schemaVersion: "kline.v1";
  instrument: InstrumentIdentity;
  timeframe: "1d" | "1w" | "1m";
  candles: KlineCandle[];
  overlays: KlineSeries[];
  panels: Array<{
    id: "volume" | "rsi" | "macd";
    title: string;
    series: KlineSeries[];
  }>;
  provenance: KlineProvenance;
  coverage?: KlineCoverage;
  quality?: DataQualitySummary;
  sources?: DataSourceReference[];
  issues?: MarketSeriesIssue[];
  levels?: PriceLevels;
  patterns?: KlinePattern[];
  annotations?: KlineAnnotations;
  scenarios?: ScenarioPath[];
};
