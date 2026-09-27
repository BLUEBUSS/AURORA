export const US_MACRO_INDICATORS = [
  "cpi_headline",
  "cpi_core",
  "ppi_final_demand",
  "pce_core",
  "pce_headline",
  "nonfarm_payrolls",
  "unemployment_rate",
  "fed_funds",
  "treasury_10y",
  "treasury_2y",
  "gdp_nominal",
  "gdp_real",
] as const;

export const US_MACRO_VALUE_UNITS = ["level", "change", "pct_change", "yoy"] as const;
export const US_MACRO_PROVIDERS = ["auto", "fred"] as const;

export const US_EQUITY_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export const US_EQUITY_ADJUSTMENTS = ["adjusted", "raw"] as const;
export const US_EQUITY_MARKET_PROVIDERS = ["auto", "eodhd", "alpha_vantage"] as const;

export const US_EQUITY_FILING_PROVIDERS = ["auto", "sec_edgar"] as const;
export const US_EQUITY_FUNDAMENTAL_PROVIDERS = ["auto", "sec_edgar"] as const;
export const US_EQUITY_FUNDAMENTAL_STATEMENTS = [
  "companyfacts",
  "income",
  "balance",
  "cashflow",
] as const;

export type UsMacroIndicator = (typeof US_MACRO_INDICATORS)[number];
export type UsMacroValueUnit = (typeof US_MACRO_VALUE_UNITS)[number];
export type UsMacroProviderId = (typeof US_MACRO_PROVIDERS)[number];
export type UsEquityFrequency = (typeof US_EQUITY_FREQUENCIES)[number];
export type UsEquityAdjustment = (typeof US_EQUITY_ADJUSTMENTS)[number];
export type UsEquityMarketProviderId = (typeof US_EQUITY_MARKET_PROVIDERS)[number];
export type UsEquityFilingProviderId = (typeof US_EQUITY_FILING_PROVIDERS)[number];
export type UsEquityFundamentalProviderId = (typeof US_EQUITY_FUNDAMENTAL_PROVIDERS)[number];
export type UsEquityFundamentalStatement = (typeof US_EQUITY_FUNDAMENTAL_STATEMENTS)[number];

export type UsDataIssueCode = "PARTIAL_DATA" | "PROVIDER_FALLBACK" | "SOURCE_NOTICE";

export interface UsDataProviderIssue {
  code: UsDataIssueCode;
  message: string;
}

export interface UsDataProviderSection<TDataType extends string, TRecord extends UsDataRecord> {
  dataType: TDataType;
  status: "complete" | "partial";
  records: TRecord[];
  issues?: UsDataProviderIssue[];
}

export interface UsDataProviderResult<TDataType extends string, TRecord extends UsDataRecord> {
  status: "complete" | "partial";
  sections: UsDataProviderSection<TDataType, TRecord>[];
  issues?: UsDataProviderIssue[];
}

export interface UsMacroDataQuery {
  indicator: UsMacroIndicator;
  provider: UsMacroProviderId;
  startDate?: string;
  endDate?: string;
  units: UsMacroValueUnit;
  limit?: number;
}

export interface UsEquityMarketDataQuery {
  symbol: string;
  provider: UsEquityMarketProviderId;
  frequency: UsEquityFrequency;
  adjustment: UsEquityAdjustment;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface UsEquityFilingsQuery {
  symbol: string;
  provider: UsEquityFilingProviderId;
  forms?: string[];
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface UsEquityFundamentalsQuery {
  symbol: string;
  provider: UsEquityFundamentalProviderId;
  statement: UsEquityFundamentalStatement;
  concepts?: string[];
  annualOnly?: boolean;
  limit?: number;
}

export interface UsMacroObservationRecord extends Record<string, unknown> {
  dataType: "macro_observation";
  indicator: UsMacroIndicator;
  seriesId: string;
  title: string;
  date: string;
  value: number | null;
  units: string;
  frequency: string;
  realtimeStart?: string;
  realtimeEnd?: string;
  provider: string;
  source: string;
}

export interface UsEquityBarRecord extends Record<string, unknown> {
  dataType: "ohlcv";
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedClose?: number;
  dividend?: number;
  splitRatio?: number;
  frequency: UsEquityFrequency;
  currency: "USD";
  provider: string;
  source: string;
}

export interface UsEquityFilingRecord extends Record<string, unknown> {
  dataType: "filing";
  symbol: string;
  cik: string;
  companyName?: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate?: string;
  primaryDocument?: string;
  description?: string;
  url?: string;
  provider: string;
  source: string;
}

export interface UsEquityFundamentalRecord extends Record<string, unknown> {
  dataType: "fundamental_fact";
  symbol: string;
  cik: string;
  concept: string;
  label?: string;
  taxonomy: string;
  unit: string;
  value: number;
  fiscalYear?: number;
  fiscalPeriod?: string;
  form?: string;
  filedDate?: string;
  startDate?: string;
  endDate?: string;
  frame?: string;
  provider: string;
  source: string;
}

export type UsDataRecord =
  | UsMacroObservationRecord
  | UsEquityBarRecord
  | UsEquityFilingRecord
  | UsEquityFundamentalRecord;

export type UsMacroIndicatorResult = UsDataProviderResult<
  "macro_observation",
  UsMacroObservationRecord
>;
export type UsEquityMarketDataResult = UsDataProviderResult<"ohlcv", UsEquityBarRecord>;
export type UsEquityFilingsResult = UsDataProviderResult<"filing", UsEquityFilingRecord>;
export type UsEquityFundamentalsResult = UsDataProviderResult<
  "fundamental_fact",
  UsEquityFundamentalRecord
>;
