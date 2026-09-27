import type {
  UsEquityFilingsQuery,
  UsEquityFilingsResult,
  UsEquityFundamentalsQuery,
  UsEquityFundamentalsResult,
  UsEquityMarketDataQuery,
  UsEquityMarketDataResult,
  UsMacroDataQuery,
  UsMacroIndicatorResult,
} from "./types.js";

export interface UsMacroProvider {
  readonly id: string;
  getMacroIndicatorData(query: UsMacroDataQuery): Promise<UsMacroIndicatorResult>;
}

export interface UsEquityMarketProvider {
  readonly id: string;
  getEquityMarketData(query: UsEquityMarketDataQuery): Promise<UsEquityMarketDataResult>;
}

export interface UsEquityFilingsProvider {
  readonly id: string;
  getEquityFilings(query: UsEquityFilingsQuery): Promise<UsEquityFilingsResult>;
}

export interface UsEquityFundamentalsProvider {
  readonly id: string;
  getEquityFundamentals(query: UsEquityFundamentalsQuery): Promise<UsEquityFundamentalsResult>;
}

export interface UsDataProvider
  extends
    UsMacroProvider,
    UsEquityMarketProvider,
    UsEquityFilingsProvider,
    UsEquityFundamentalsProvider {}
