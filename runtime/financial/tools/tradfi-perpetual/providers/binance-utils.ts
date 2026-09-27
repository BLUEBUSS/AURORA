import type {
  TradfiPerpetualCoverage,
  TradfiPerpetualInstrumentClass,
  TradfiPerpetualIssue,
  TradfiPerpetualRecord,
  TradfiPerpetualUnderlyingMarket,
  TradfiPerpetualUnderlyingType,
} from "../types.js";
import { TRADFI_PERPETUAL_UNDERLYING_TYPES } from "../types.js";

const ELIGIBLE_UNDERLYING_TYPES = new Set<string>(TRADFI_PERPETUAL_UNDERLYING_TYPES);

const MARKET_IDENTITIES: Record<
  TradfiPerpetualUnderlyingType,
  {
    underlyingMarket: TradfiPerpetualUnderlyingMarket;
    instrumentClass: TradfiPerpetualInstrumentClass;
  }
> = {
  EQUITY: {
    underlyingMarket: "US_EQUITY",
    instrumentClass: "equity_linked_perpetual",
  },
  KR_EQUITY: {
    underlyingMarket: "KR_EQUITY",
    instrumentClass: "kr_equity_perpetual",
  },
  HK_EQUITY: {
    underlyingMarket: "HK_EQUITY",
    instrumentClass: "hk_equity_perpetual",
  },
  CN_EQUITY: {
    underlyingMarket: "CN_EQUITY",
    instrumentClass: "cn_equity_perpetual",
  },
};

export interface BinanceInstrument {
  symbol: string;
  pair?: string;
  contractType: string;
  onboardDate: number;
  deliveryDate?: number;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  pricePrecision?: number;
  quantityPrecision?: number;
  underlyingType: string;
  underlyingSubType?: unknown;
  orderTypes?: string[];
  timeInForce?: string[];
}

export interface TimeWindow {
  requestedStart?: number;
  requestedEnd?: number;
  effectiveStart?: number;
  effectiveEnd?: number;
  reasons: string[];
  empty: boolean;
}

export interface TimedRecord extends TradfiPerpetualRecord {
  eventTime: number;
}

export function isEligibleUnderlyingType(value: string): value is TradfiPerpetualUnderlyingType {
  return ELIGIBLE_UNDERLYING_TYPES.has(value);
}

export function marketIdentityForUnderlyingType(underlyingType: TradfiPerpetualUnderlyingType): {
  underlyingMarket: TradfiPerpetualUnderlyingMarket;
  instrumentClass: TradfiPerpetualInstrumentClass;
} {
  return MARKET_IDENTITIES[underlyingType];
}

export function coverageFrom(window: TimeWindow, records: TimedRecord[]): TradfiPerpetualCoverage {
  const times = records.map((record) => record.eventTime).filter(Number.isFinite);
  return {
    requestedStartTime: window.requestedStart ? iso(window.requestedStart) : undefined,
    requestedEndTime: window.requestedEnd ? iso(window.requestedEnd) : undefined,
    availableStartTime: times.length ? iso(Math.min(...times)) : undefined,
    availableEndTime: times.length ? iso(Math.max(...times)) : undefined,
    isComplete: window.reasons.length === 0 && !window.empty,
    reason: window.reasons.length ? window.reasons.join(" ") : undefined,
  };
}

export function coverageIssues(window: TimeWindow): TradfiPerpetualIssue[] {
  return window.reasons.length
    ? [{ code: "COVERAGE_LIMITED", message: window.reasons.join(" ") }]
    : [];
}

export function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return typeof value === "string" && value ? [value] : [];
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function numeric(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function decimalPercent(value: unknown): number | undefined {
  const parsed = numeric(value);
  return parsed === undefined ? undefined : parsed / 100;
}

export function optionalIso(value: unknown): string | undefined {
  const parsed = numeric(value);
  return parsed === undefined ? undefined : iso(parsed);
}

export function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}
