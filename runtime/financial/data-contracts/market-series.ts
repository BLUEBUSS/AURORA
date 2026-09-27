import type { DataQualitySummary } from "./quality.js";

export const MARKET_SERIES_SCHEMA_VERSION = "fin-core.market-series.v1" as const;

export interface DataSourceReference {
  provider: string;
  source: string;
  url?: string;
}

export interface MarketSeriesIssue {
  code: string;
  message: string;
  droppedRecordCount?: number;
}

export interface MarketSeriesContract<TInstrument, TCandle, TCoverage, TProvenance> {
  schemaVersion: typeof MARKET_SERIES_SCHEMA_VERSION;
  timeframe: "1d" | "1w" | "1m";
  instrument: TInstrument;
  candles: TCandle[];
  provenance: TProvenance;
  coverage: TCoverage;
  quality: DataQualitySummary;
  sources: DataSourceReference[];
  issues: MarketSeriesIssue[];
}
