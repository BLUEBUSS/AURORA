import { CryptoProviderError } from "./errors.js";
import { normalizeTimestamp } from "./normalize.js";
import type { CryptoAssetDataInput } from "./schemas.js";
import type {
  CryptoAssetDataQuery,
  CryptoAssetDataResult,
  CryptoAssetDataType,
  CryptoAssetRecord,
} from "./types.js";

const ASSET_BUNDLE_DATA_TYPES = {
  asset_overview: ["profile", "market_snapshot", "supply", "rankings", "exchanges"],
  market_discovery: ["categories", "trending"],
} as const satisfies Record<string, readonly CryptoAssetDataType[]>;

const ASSET_REQUIRED_TYPES = new Set<CryptoAssetDataType>(["profile", "supply", "exchanges"]);
const COINPAPRIKA_UNSUPPORTED = new Set<CryptoAssetDataType>(["categories", "trending"]);

export function normalizeAssetDataInput(input: CryptoAssetDataInput): CryptoAssetDataQuery {
  requireSingleSelection(input.data_type, input.bundle);
  const dataTypes = input.data_type
    ? [input.data_type]
    : [...ASSET_BUNDLE_DATA_TYPES[input.bundle!]];
  const asset = input.asset ? normalizeSlug(input.asset) : undefined;
  if (dataTypes.some((dataType) => ASSET_REQUIRED_TYPES.has(dataType)) && !asset) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "asset is required for profile, supply, and exchanges.",
    );
  }
  if (
    input.provider === "coinpaprika" &&
    dataTypes.some((dataType) => COINPAPRIKA_UNSUPPORTED.has(dataType))
  ) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "CoinPaprika does not provide the approved categories or trending sections.",
    );
  }
  return {
    dataTypes,
    provider: input.provider ?? "auto",
    asset,
    quoteCurrency: (input.quote_currency ?? "USD").toUpperCase(),
    category: input.category ? normalizeSlug(input.category) : undefined,
    limit: input.limit,
  };
}

export function normalizeAssetProviderResult(
  result: CryptoAssetDataResult,
  query: CryptoAssetDataQuery,
  providerId: string,
): CryptoAssetDataResult {
  const sections = result.sections.map((section) => ({
    ...section,
    records: section.records.map((record) =>
      normalizeRecord(record, section.dataType, query, providerId),
    ),
  }));
  const issues = [...(result.issues ?? []), ...sections.flatMap((section) => section.issues ?? [])];
  const partial =
    result.status === "partial" || sections.some((section) => section.status === "partial");
  if (partial && !issues.some((issue) => issue.code === "PARTIAL_DATA")) {
    throw new CryptoProviderError(
      "UPSTREAM_ERROR",
      "Partial asset results must include a PARTIAL_DATA issue.",
    );
  }
  return { ...result, sections };
}

function normalizeRecord(
  record: CryptoAssetRecord,
  dataType: CryptoAssetDataType,
  query: CryptoAssetDataQuery,
  providerId: string,
): CryptoAssetRecord {
  const normalized = {
    ...record,
    assetId: record.assetId ? normalizeSlug(record.assetId) : undefined,
    symbol: record.symbol?.toUpperCase(),
    provider: record.provider || providerId,
    timestamp: normalizeTimestamp(record.timestamp),
    quoteCurrency: record.quoteCurrency?.toUpperCase(),
  };
  if (
    normalized.dataType !== dataType ||
    normalized.venue !== "aggregate" ||
    (normalized.quoteCurrency && normalized.quoteCurrency !== query.quoteCurrency)
  ) {
    throw new CryptoProviderError("UPSTREAM_ERROR", "Asset provider returned mismatched identity.");
  }
  return normalized;
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function requireSingleSelection(dataType?: string, bundle?: string): void {
  if ((!dataType && !bundle) || (dataType && bundle)) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "Provide exactly one of data_type or bundle.",
    );
  }
}
