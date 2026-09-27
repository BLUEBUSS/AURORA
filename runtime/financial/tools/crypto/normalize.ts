import { CryptoProviderError } from "./errors.js";
import type {
  CryptoDefiDataInput,
  CryptoDerivativesDataInput,
  CryptoDexDataInput,
  CryptoMarketDataInput,
  CryptoOptionsDataInput,
} from "./schemas.js";
import type {
  CryptoDataRecord,
  CryptoDefiDataQuery,
  CryptoDefiDataType,
  CryptoDefiRecord,
  CryptoDerivativeRecord,
  CryptoDerivativeSectionType,
  CryptoDerivativesDataQuery,
  CryptoDexDataQuery,
  CryptoDexDataType,
  CryptoDexRecord,
  CryptoMarketDataQuery,
  CryptoMarketDataRecord,
  CryptoMarketDataType,
  CryptoMarketQuery,
  CryptoMarketType,
  CryptoProviderResult,
  CryptoOptionDataType,
  CryptoOptionsDataQuery,
  CryptoOptionRecord,
} from "./types.js";

const ASSET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;

const MARKET_BUNDLE_DATA_TYPES = {
  market_overview: ["snapshot", "ohlcv"],
  microstructure: ["orderbook", "trades"],
} as const satisfies Record<string, readonly CryptoMarketDataType[]>;

const DERIVATIVES_OVERVIEW = [
  "funding",
  "open_interest",
  "basis",
  "long_short_ratio",
  "taker_flow",
] as const satisfies readonly CryptoDerivativeSectionType[];

const DERIVATIVE_BUNDLE_DATA_TYPES = {
  derivatives_overview: DERIVATIVES_OVERVIEW,
  liquidation_overview: ["liquidations", "insurance_risk"],
} as const satisfies Record<string, readonly CryptoDerivativeSectionType[]>;

const OPTION_BUNDLE_DATA_TYPES = {
  options_surface: ["chain", "greeks", "implied_volatility"],
  volatility_overview: ["volatility_index", "implied_volatility", "expiry_structure"],
} as const satisfies Record<string, readonly CryptoOptionDataType[]>;

const DEX_BUNDLE_DATA_TYPES = {
  pool_overview: ["pool_snapshot", "liquidity", "transaction_activity"],
  pool_market_history: ["ohlcv", "trades"],
} as const satisfies Record<string, readonly CryptoDexDataType[]>;

const DEFI_BUNDLE_DATA_TYPES = {
  protocol_fundamentals: ["protocol", "dex_volume", "fees_revenue"],
  stablecoin_overview: ["stablecoins"],
  yield_screen: ["yields"],
} as const satisfies Record<string, readonly CryptoDefiDataType[]>;

const POOL_ADDRESS_DATA_TYPES = new Set<CryptoDexDataType>([
  "pool_snapshot",
  "ohlcv",
  "trades",
  "liquidity",
  "transaction_activity",
]);

const CHAIN_ALIASES: Record<string, string> = {
  eth: "ethereum",
  ethereum: "ethereum",
  arb: "arbitrum",
  arbitrum: "arbitrum",
  "arbitrum-one": "arbitrum",
  op: "optimism",
  optimism: "optimism",
  "op-mainnet": "optimism",
  bnb: "bsc",
  bsc: "bsc",
  "binance-smart-chain": "bsc",
  matic: "polygon",
  polygon: "polygon",
  avax: "avalanche",
  avalanche: "avalanche",
  sol: "solana",
  solana: "solana",
};

const EXACT_OPTION_DATA_TYPES = new Set<CryptoOptionDataType>([
  "ticker",
  "orderbook",
  "trades",
  "greeks",
]);

export function parseMarketSymbol(symbol: string): {
  baseAsset: string;
  quoteAsset: string;
  symbol: string;
} {
  const parts = symbol.trim().split("/");
  if (parts.length !== 2 || !parts.every((part) => ASSET_PATTERN.test(part))) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      `Invalid symbol "${symbol}". Use canonical BASE/QUOTE form, for example BTC/USDT.`,
    );
  }
  const [baseAsset, quoteAsset] = parts.map((part) => part.toUpperCase());
  if (baseAsset === quoteAsset) {
    throw new CryptoProviderError("INVALID_ARGUMENT", "Base asset and quote asset must differ.");
  }
  return { baseAsset, quoteAsset, symbol: `${baseAsset}/${quoteAsset}` };
}

export function normalizeTimestamp(value: string | number): string {
  const milliseconds =
    typeof value === "number" ? (Math.abs(value) < 100_000_000_000 ? value * 1_000 : value) : value;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    throw new CryptoProviderError("INVALID_ARGUMENT", `Invalid timestamp: ${String(value)}`);
  }
  return date.toISOString();
}

function normalizeTimeRange(startTime?: string, endTime?: string) {
  if ((startTime && !endTime) || (!startTime && endTime)) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "start_time and end_time must be provided together.",
    );
  }
  if (!startTime || !endTime) return {};
  const normalizedStart = normalizeTimestamp(startTime);
  const normalizedEnd = normalizeTimestamp(endTime);
  if (normalizedStart >= normalizedEnd) {
    throw new CryptoProviderError("INVALID_ARGUMENT", "start_time must be before end_time.");
  }
  return { startTime: normalizedStart, endTime: normalizedEnd };
}

function marketQuery(
  input: Pick<CryptoMarketDataInput, "symbol" | "venue">,
  marketType: CryptoMarketType,
): CryptoMarketQuery {
  return {
    ...parseMarketSymbol(input.symbol),
    marketType,
    venue: input.venue?.trim().toLowerCase() || undefined,
  };
}

function matchesRequestedVenue(
  requestedVenue: string | undefined,
  recordVenue: string,
  recordProvider: string,
): boolean {
  if (!requestedVenue || requestedVenue === "aggregate") return true;
  return (
    recordVenue.toLowerCase() === requestedVenue || recordProvider.toLowerCase() === requestedVenue
  );
}

function requireSingleSelection(dataType?: string, bundle?: string): void {
  if ((!dataType && !bundle) || (dataType && bundle)) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "Provide exactly one of data_type or bundle.",
    );
  }
}

export function normalizeChain(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (!slug) throw new CryptoProviderError("INVALID_ARGUMENT", "chain cannot be empty.");
  return CHAIN_ALIASES[slug] ?? slug;
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

export function normalizeMarketDataInput(input: CryptoMarketDataInput): CryptoMarketDataQuery {
  requireSingleSelection(input.data_type, input.bundle);
  const dataTypes = input.data_type
    ? [input.data_type]
    : [...MARKET_BUNDLE_DATA_TYPES[input.bundle!]];
  return {
    ...marketQuery(input, input.market_type ?? "spot"),
    dataTypes,
    ...normalizeTimeRange(input.start_time, input.end_time),
    interval: input.interval,
    depth: input.depth,
    limit: input.limit,
  };
}

export function normalizeDerivativesDataInput(
  input: CryptoDerivativesDataInput,
): CryptoDerivativesDataQuery {
  requireSingleSelection(input.data_type, input.bundle);
  const dataTypes = input.data_type
    ? input.data_type === "overview"
      ? [...DERIVATIVES_OVERVIEW]
      : [input.data_type]
    : [...DERIVATIVE_BUNDLE_DATA_TYPES[input.bundle!]];
  return {
    ...marketQuery(input, input.market_type),
    marketType: input.market_type,
    dataTypes,
    ...normalizeTimeRange(input.start_time, input.end_time),
    interval: input.interval,
    limit: input.limit,
  };
}

export function normalizeOptionsDataInput(input: CryptoOptionsDataInput): CryptoOptionsDataQuery {
  requireSingleSelection(input.data_type, input.bundle);
  const venue = input.venue?.trim().toLowerCase() || "deribit";
  if (venue !== "deribit") {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      `Options venue "${input.venue}" is not enabled. Use deribit.`,
    );
  }
  const dataTypes = input.data_type
    ? [input.data_type]
    : [...OPTION_BUNDLE_DATA_TYPES[input.bundle!]];
  const exactContractRequired =
    dataTypes.some((dataType) => EXACT_OPTION_DATA_TYPES.has(dataType)) ||
    input.bundle === "options_surface";
  if (exactContractRequired && (!input.expiry || !input.strike || !input.option_type)) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "expiry, strike, and option_type are required for exact-contract options data.",
    );
  }
  const parsed = parseMarketSymbol(input.symbol);
  return {
    ...parsed,
    venue: "deribit",
    dataTypes,
    expiry: input.expiry ? normalizeTimestamp(input.expiry) : undefined,
    strike: input.strike,
    optionType: input.option_type,
    interval: input.interval,
    ...normalizeTimeRange(input.start_time, input.end_time),
    depth: input.depth,
    limit: input.limit,
  };
}

export function normalizeDexDataInput(input: CryptoDexDataInput): CryptoDexDataQuery {
  requireSingleSelection(input.data_type, input.bundle);
  const dataTypes = input.data_type ? [input.data_type] : [...DEX_BUNDLE_DATA_TYPES[input.bundle!]];
  const chain = input.chain ? normalizeChain(input.chain) : undefined;
  const query = input.query?.trim() || undefined;
  const contractAddress = input.contract_address?.trim() || undefined;
  const poolAddress = input.pool_address?.trim() || undefined;

  if (dataTypes.includes("token_search") && !query) {
    throw new CryptoProviderError("INVALID_ARGUMENT", "query is required for token_search.");
  }
  if (dataTypes.includes("pools") && (!chain || !contractAddress)) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "chain and contract_address are required for pools.",
    );
  }
  if (
    dataTypes.some((dataType) => POOL_ADDRESS_DATA_TYPES.has(dataType)) &&
    (!chain || !poolAddress)
  ) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "chain and pool_address are required for pool data.",
    );
  }

  return {
    dataTypes,
    provider: input.provider ?? "auto",
    chain,
    query,
    contractAddress,
    poolAddress,
    interval: input.interval ?? (dataTypes.includes("ohlcv") ? "1h" : undefined),
    ...normalizeTimeRange(input.start_time, input.end_time),
    limit: input.limit,
  };
}

export function normalizeDefiDataInput(input: CryptoDefiDataInput): CryptoDefiDataQuery {
  requireSingleSelection(input.data_type, input.bundle);
  const dataTypes = input.data_type
    ? [input.data_type]
    : [...DEFI_BUNDLE_DATA_TYPES[input.bundle!]];
  const protocol = input.protocol ? normalizeSlug(input.protocol) : undefined;
  if ((input.bundle === "protocol_fundamentals" || input.data_type === "protocol") && !protocol) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "protocol is required for protocol fundamentals.",
    );
  }
  return {
    dataTypes,
    protocol,
    chain: input.chain ? normalizeChain(input.chain) : undefined,
    stablecoinId: input.stablecoin_id?.trim() || undefined,
    poolId: input.pool_id?.trim() || undefined,
    ...normalizeTimeRange(input.start_time, input.end_time),
    limit: input.limit,
  };
}

export function normalizeProviderResult<
  TDataType extends string,
  TRecord extends CryptoMarketDataRecord | CryptoDerivativeRecord,
>(
  result: CryptoProviderResult<TDataType, TRecord>,
  query: CryptoMarketQuery,
  providerId: string,
): CryptoProviderResult<TDataType, TRecord> {
  const sections = result.sections.map((section) => ({
    ...section,
    records: section.records.map((record) => {
      const normalized = {
        ...record,
        baseAsset: record.baseAsset.toUpperCase(),
        quoteAsset: record.quoteAsset.toUpperCase(),
        symbol: `${record.baseAsset.toUpperCase()}/${record.quoteAsset.toUpperCase()}`,
        provider: record.provider || providerId,
        timestamp: normalizeTimestamp(record.timestamp),
      } as TRecord;
      if (
        normalized.symbol !== query.symbol ||
        normalized.marketType !== query.marketType ||
        !matchesRequestedVenue(query.venue, normalized.venue, normalized.provider) ||
        normalized.dataType !== section.dataType
      ) {
        throw new CryptoProviderError(
          "UPSTREAM_ERROR",
          `Provider returned mismatched market identity for ${query.symbol} ${query.marketType}.`,
        );
      }
      return normalized;
    }),
  }));

  const issues = [...(result.issues ?? []), ...sections.flatMap((section) => section.issues ?? [])];
  const isPartial =
    result.status === "partial" || sections.some((section) => section.status === "partial");
  if (isPartial && !issues.some((issue) => issue.code === "PARTIAL_DATA")) {
    throw new CryptoProviderError(
      "UPSTREAM_ERROR",
      "Partial provider results must include a PARTIAL_DATA issue.",
    );
  }
  return { ...result, sections };
}

export function normalizeOptionsProviderResult(
  result: CryptoProviderResult<CryptoOptionDataType, CryptoOptionRecord>,
  query: CryptoOptionsDataQuery,
  providerId: string,
): CryptoProviderResult<CryptoOptionDataType, CryptoOptionRecord> {
  const sections = result.sections.map((section) => ({
    ...section,
    records: section.records.map((record) => {
      const normalized = {
        ...record,
        baseAsset: record.baseAsset.toUpperCase(),
        quoteAsset: record.quoteAsset.toUpperCase(),
        symbol: `${record.baseAsset.toUpperCase()}/${record.quoteAsset.toUpperCase()}`,
        provider: record.provider || providerId,
        timestamp: normalizeTimestamp(record.timestamp),
      } as CryptoOptionRecord;
      if (
        normalized.symbol !== query.symbol ||
        normalized.venue.toLowerCase() !== query.venue ||
        normalized.dataType !== section.dataType
      ) {
        throw new CryptoProviderError(
          "UPSTREAM_ERROR",
          `Options provider returned mismatched identity for ${query.symbol}.`,
        );
      }
      return normalized;
    }),
  }));
  const issues = [...(result.issues ?? []), ...sections.flatMap((section) => section.issues ?? [])];
  const isPartial =
    result.status === "partial" || sections.some((section) => section.status === "partial");
  if (isPartial && !issues.some((issue) => issue.code === "PARTIAL_DATA")) {
    throw new CryptoProviderError(
      "UPSTREAM_ERROR",
      "Partial options results must include a PARTIAL_DATA issue.",
    );
  }
  return { ...result, sections };
}

export function normalizeDexProviderResult(
  result: CryptoProviderResult<CryptoDexDataType, CryptoDexRecord>,
  query: CryptoDexDataQuery,
  providerId: string,
): CryptoProviderResult<CryptoDexDataType, CryptoDexRecord> {
  const sections = result.sections.map((section) => ({
    ...section,
    records: section.records.map((record) => {
      const normalized = {
        ...record,
        chain: normalizeChain(record.chain),
        provider: record.provider || providerId,
        timestamp: normalizeTimestamp(record.timestamp),
      };
      if (
        normalized.dataType !== section.dataType ||
        (query.chain && normalized.chain !== query.chain) ||
        (query.poolAddress &&
          normalized.poolAddress &&
          normalized.poolAddress.toLowerCase() !== query.poolAddress.toLowerCase())
      ) {
        throw new CryptoProviderError(
          "UPSTREAM_ERROR",
          "DEX provider returned mismatched identity.",
        );
      }
      return normalized;
    }),
  }));
  validatePartialResult(result, sections);
  return { ...result, sections };
}

export function normalizeDefiProviderResult(
  result: CryptoProviderResult<CryptoDefiDataType, CryptoDefiRecord>,
  query: CryptoDefiDataQuery,
  providerId: string,
): CryptoProviderResult<CryptoDefiDataType, CryptoDefiRecord> {
  const sections = result.sections.map((section) => ({
    ...section,
    records: section.records.map((record) => {
      const normalized = {
        ...record,
        chain: record.chain ? normalizeChain(record.chain) : undefined,
        protocol: record.protocol ? normalizeSlug(record.protocol) : undefined,
        provider: record.provider || providerId,
        timestamp: normalizeTimestamp(record.timestamp),
      };
      if (
        normalized.dataType !== section.dataType ||
        normalized.venue !== "aggregate" ||
        (query.chain && normalized.chain && normalized.chain !== query.chain) ||
        (query.protocol && normalized.protocol && normalized.protocol !== query.protocol)
      ) {
        throw new CryptoProviderError(
          "UPSTREAM_ERROR",
          "DeFi provider returned mismatched identity.",
        );
      }
      return normalized;
    }),
  }));
  validatePartialResult(result, sections);
  return { ...result, sections };
}

function validatePartialResult<TDataType extends string, TRecord extends CryptoDataRecord>(
  result: CryptoProviderResult<TDataType, TRecord>,
  sections: CryptoProviderResult<TDataType, TRecord>["sections"],
): void {
  const issues = [...(result.issues ?? []), ...sections.flatMap((section) => section.issues ?? [])];
  const isPartial =
    result.status === "partial" || sections.some((section) => section.status === "partial");
  if (isPartial && !issues.some((issue) => issue.code === "PARTIAL_DATA")) {
    throw new CryptoProviderError(
      "UPSTREAM_ERROR",
      "Partial provider results must include a PARTIAL_DATA issue.",
    );
  }
}
