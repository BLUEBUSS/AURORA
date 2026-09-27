import { TradfiPerpetualProviderError } from "./errors.js";
import { classifyTradfiPerpetualRoute } from "./routing.js";
import type { TradfiPerpetualDataInput } from "./schemas.js";
import {
  TRADFI_PERPETUAL_ANALYTICS_INTERVALS,
  TRADFI_PERPETUAL_UNDERLYING_TYPES,
  type TradfiPerpetualAction,
  type TradfiPerpetualDataType,
  type TradfiPerpetualQuery,
  type TradfiPerpetualResult,
} from "./types.js";

const ALLOWED_DEPTHS = new Set([5, 10, 20, 50, 100, 500, 1_000]);
const ANALYTICS_INTERVALS = new Set<string>(TRADFI_PERPETUAL_ANALYTICS_INTERVALS);
const UNDERLYING_TYPES = new Set<string>(TRADFI_PERPETUAL_UNDERLYING_TYPES);

const ACTION_DATA_TYPES: Record<
  Exclude<TradfiPerpetualAction, "ohlcv">,
  readonly TradfiPerpetualDataType[]
> = {
  instruments: ["instruments"],
  snapshot: ["snapshot", "trading_schedule"],
  derivatives: [
    "funding",
    "open_interest",
    "global_long_short_ratio",
    "top_account_long_short_ratio",
    "top_position_long_short_ratio",
    "taker_buy_sell_ratio",
  ],
  microstructure: ["orderbook", "trades"],
  technical_analysis_input: ["snapshot", "trade_ohlcv"],
};

export { hasExplicitBinanceIntent } from "./routing.js";

export function normalizeTradfiPerpetualInput(
  input: TradfiPerpetualDataInput,
): TradfiPerpetualQuery {
  const userQuery = input.user_query.trim();
  const routeDecision = classifyTradfiPerpetualRoute(userQuery);
  if (routeDecision.reason === "missing_binance_venue") {
    throw new TradfiPerpetualProviderError(
      "VENUE_INTENT_REQUIRED",
      "tradfi_perpetual_data requires the original user request to explicitly mention Binance, 币安, or standalone BN.",
    );
  }
  if (!routeDecision.shouldRoute) {
    throw new TradfiPerpetualProviderError(
      "UNSUPPORTED_INSTRUMENT_CLASS",
      `tradfi_perpetual_data routing rejected this request: ${routeDecision.reason}. Use the matching cash-equity, filing, crypto, commodity, PREMARKET, search, or account tool instead.`,
    );
  }

  const symbol = input.symbol?.trim() || undefined;
  if (input.action !== "instruments" && !symbol) {
    throw new TradfiPerpetualProviderError(
      "INVALID_ARGUMENT",
      `symbol is required for action=${input.action}.`,
    );
  }
  if (input.action !== "ohlcv" && input.price_series) {
    throw new TradfiPerpetualProviderError(
      "INVALID_ARGUMENT",
      "price_series is only valid for action=ohlcv.",
    );
  }

  const interval = input.interval ?? "1d";
  if (
    (input.action === "derivatives" || input.action === "technical_analysis_input") &&
    !ANALYTICS_INTERVALS.has(interval)
  ) {
    throw new TradfiPerpetualProviderError(
      "INVALID_ARGUMENT",
      `interval=${interval} is not supported for Binance derivatives statistics. Use ${TRADFI_PERPETUAL_ANALYTICS_INTERVALS.join(", ")}.`,
    );
  }

  const depth = input.depth ?? 20;
  if (!ALLOWED_DEPTHS.has(depth)) {
    throw new TradfiPerpetualProviderError(
      "INVALID_ARGUMENT",
      `Unsupported depth=${depth}. Use 5, 10, 20, 50, 100, 500, or 1000.`,
    );
  }

  const timeRange = normalizeTimeRange(input.start_time, input.end_time);
  const priceSeries = input.price_series ?? "trade";
  const dataTypes =
    input.action === "ohlcv"
      ? ([`${priceSeries}_ohlcv`] as TradfiPerpetualDataType[])
      : [...ACTION_DATA_TYPES[input.action]];

  return {
    userQuery,
    action: input.action,
    symbol,
    priceSeries,
    interval,
    ...timeRange,
    limit:
      input.limit ??
      (input.action === "instruments"
        ? 200
        : input.action === "derivatives"
          ? 500
          : input.action === "technical_analysis_input"
            ? 120
            : 100),
    depth,
    venue: "binance",
    dataTypes,
  };
}

export function validateTradfiPerpetualResult(
  result: TradfiPerpetualResult,
  providerId: string,
): TradfiPerpetualResult {
  const sections = result.sections.map((section) => ({
    ...section,
    records: section.records.map((record) => {
      const timestamp = new Date(record.timestamp);
      if (!Number.isFinite(timestamp.getTime())) {
        throw new TradfiPerpetualProviderError(
          "UPSTREAM_ERROR",
          `Provider returned an invalid timestamp for ${record.venueSymbol}.`,
        );
      }
      const normalized = {
        ...record,
        provider: record.provider || providerId,
        timestamp: timestamp.toISOString(),
      };
      if (
        normalized.dataType !== section.dataType ||
        normalized.venue !== "binance" ||
        normalized.contractType !== "TRADIFI_PERPETUAL" ||
        normalized.isCashEquity !== false ||
        !UNDERLYING_TYPES.has(normalized.underlyingType)
      ) {
        throw new TradfiPerpetualProviderError(
          "UPSTREAM_ERROR",
          "Provider returned a mismatched Binance TradFi perpetual identity.",
        );
      }
      return normalized;
    }),
  }));

  const issues = [...(result.issues ?? []), ...sections.flatMap((section) => section.issues ?? [])];
  const isPartial =
    result.status === "partial" || sections.some((section) => section.status === "partial");
  if (
    isPartial &&
    !issues.some((issue) => issue.code === "PARTIAL_DATA" || issue.code === "COVERAGE_LIMITED")
  ) {
    throw new TradfiPerpetualProviderError(
      "UPSTREAM_ERROR",
      "Partial TradFi perpetual results must include a PARTIAL_DATA or COVERAGE_LIMITED issue.",
    );
  }
  return { ...result, sections };
}

function normalizeTimeRange(startTime?: string, endTime?: string) {
  if ((startTime && !endTime) || (!startTime && endTime)) {
    throw new TradfiPerpetualProviderError(
      "INVALID_ARGUMENT",
      "start_time and end_time must be provided together.",
    );
  }
  if (!startTime || !endTime) return {};
  const start = normalizeTimestamp(startTime);
  const end = normalizeTimestamp(endTime);
  if (start >= end) {
    throw new TradfiPerpetualProviderError(
      "INVALID_ARGUMENT",
      "start_time must be before end_time.",
    );
  }
  return { startTime: start, endTime: end };
}

function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TradfiPerpetualProviderError("INVALID_ARGUMENT", `Invalid timestamp: ${value}`);
  }
  return date.toISOString();
}
