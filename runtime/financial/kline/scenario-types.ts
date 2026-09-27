export type ScenarioId = "range" | "range_then_rally" | "rally" | "pullback";

export type ScenarioPoint = {
  timestamp: string;
  price: number;
};

export type ScenarioBandPoint = {
  timestamp: string;
  lower: number;
  upper: number;
};

export type ScenarioProbabilityStatus = "heuristic" | "calibrated" | "insufficient_data";

export type ScenarioResearchEvidence = {
  id: string;
  kind: "fundamental" | "news" | "event" | "macro" | "sentiment";
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  summary: string;
  source: string;
  asOf: string;
};

export type ScenarioResearchContribution = {
  evidenceId: string;
  kind: ScenarioResearchEvidence["kind"];
  direction: ScenarioResearchEvidence["direction"];
  confidence: number;
  contribution: number;
  evidence: string;
};

export type ScenarioScoreFactor = {
  signal: "base_rate" | "trend_20d" | "momentum_5d" | "range_position" | "volume_ratio";
  value: number;
  contribution: number;
  evidence: string;
};

export type ScenarioPath = {
  id: ScenarioId;
  label: string;
  bias: "bearish" | "neutral" | "bullish";
  color: string;
  forecastOnly: true;
  horizonTradingDays: 10;
  points: ScenarioPoint[];
  band: ScenarioBandPoint[];
  probability: number | null;
  probabilityStatus: ScenarioProbabilityStatus;
  probabilityMethod: "deterministic-signals-v1" | "deterministic-signals-evidence-v1";
  probabilityScope: "technical_signals_only" | "technical_and_research_evidence";
  scoreFactors: ScenarioScoreFactor[];
  researchContributions: ScenarioResearchContribution[];
  thesis: string;
  trigger: string;
  invalidatedBy: string;
  evidence: string[];
};
