export const TRADFI_PERPETUAL_ACTIONS = [
  "instruments",
  "snapshot",
  "ohlcv",
  "derivatives",
  "microstructure",
  "technical_analysis_input",
] as const;

export const TRADFI_PERPETUAL_PRICE_SERIES = ["trade", "mark", "index", "premium"] as const;

export const TRADFI_PERPETUAL_INTERVALS = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
] as const;

export const TRADFI_PERPETUAL_ANALYTICS_INTERVALS = [
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "12h",
  "1d",
] as const;

export const TRADFI_PERPETUAL_DATA_TYPES = [
  "instruments",
  "snapshot",
  "trade_ohlcv",
  "mark_ohlcv",
  "index_ohlcv",
  "premium_ohlcv",
  "funding",
  "open_interest",
  "global_long_short_ratio",
  "top_account_long_short_ratio",
  "top_position_long_short_ratio",
  "taker_buy_sell_ratio",
  "orderbook",
  "trades",
  "trading_schedule",
  "technical_indicators",
] as const;

export const TRADFI_PERPETUAL_UNDERLYING_TYPES = [
  "EQUITY",
  "KR_EQUITY",
  "HK_EQUITY",
  "CN_EQUITY",
] as const;

export type TradfiPerpetualAction = (typeof TRADFI_PERPETUAL_ACTIONS)[number];
export type TradfiPerpetualPriceSeries = (typeof TRADFI_PERPETUAL_PRICE_SERIES)[number];
export type TradfiPerpetualInterval = (typeof TRADFI_PERPETUAL_INTERVALS)[number];
export type TradfiPerpetualDataType = (typeof TRADFI_PERPETUAL_DATA_TYPES)[number];
export type TradfiPerpetualUnderlyingType = (typeof TRADFI_PERPETUAL_UNDERLYING_TYPES)[number];
export type TradfiPerpetualUnderlyingMarket = "US_EQUITY" | "KR_EQUITY" | "HK_EQUITY" | "CN_EQUITY";
export type TradfiPerpetualInstrumentClass =
  | "equity_linked_perpetual"
  | "kr_equity_perpetual"
  | "hk_equity_perpetual"
  | "cn_equity_perpetual";

export type TradfiPerpetualIssueCode = "PARTIAL_DATA" | "COVERAGE_LIMITED" | "SOURCE_NOTICE";

export interface TradfiPerpetualIssue {
  code: TradfiPerpetualIssueCode;
  message: string;
}

export interface TradfiPerpetualCoverage {
  requestedStartTime?: string;
  requestedEndTime?: string;
  availableStartTime?: string;
  availableEndTime?: string;
  isComplete: boolean;
  reason?: string;
}

export interface TradfiPerpetualRecord extends Record<string, unknown> {
  dataType: TradfiPerpetualDataType;
  instrumentClass: TradfiPerpetualInstrumentClass;
  venue: "binance";
  venueSymbol: string;
  underlyingSymbol: string;
  underlyingMarket: TradfiPerpetualUnderlyingMarket;
  underlyingType: TradfiPerpetualUnderlyingType;
  underlyingSubTypes: string[];
  quoteAsset: string;
  settlementAsset: string;
  contractType: "TRADIFI_PERPETUAL";
  tradingStatus: string;
  onboardDate: string;
  isCashEquity: false;
  provider: string;
  sourceEndpoint: string;
  timestamp: string;
}

export interface TradfiIndicatorAvailability {
  indicator: string;
  requiredBars: number;
  availableBars: number;
}

export interface TradfiTechnicalIndicatorsRecord extends TradfiPerpetualRecord {
  dataType: "technical_indicators";
  methodology: "derived";
  formulaVersion: "tradfi-ta-v1";
  inputDataType: "trade_ohlcv";
  interval: TradfiPerpetualInterval;
  usesClosedBarsOnly: true;
  receivedBarCount: number;
  usedBarCount: number;
  dataSufficiency: "full" | "limited";
  calculatedIndicators: string[];
  unavailableIndicators: TradfiIndicatorAvailability[];
  warnings: string[];
  standardIndicatorPolicy: {
    authority: "tool_only";
    recomputeAllowed: false;
    unavailableAction: "omit_and_report";
  };
}

export interface TradfiPerpetualSection {
  dataType: TradfiPerpetualDataType;
  status: "complete" | "partial";
  records: TradfiPerpetualRecord[];
  coverage?: TradfiPerpetualCoverage;
  issues?: TradfiPerpetualIssue[];
}

export interface TradfiPerpetualResult {
  status: "complete" | "partial";
  sections: TradfiPerpetualSection[];
  issues?: TradfiPerpetualIssue[];
}

export interface TradfiPerpetualQuery {
  userQuery: string;
  action: TradfiPerpetualAction;
  symbol?: string;
  priceSeries: TradfiPerpetualPriceSeries;
  interval: TradfiPerpetualInterval;
  startTime?: string;
  endTime?: string;
  limit: number;
  depth: number;
  venue: "binance";
  dataTypes: TradfiPerpetualDataType[];
}
