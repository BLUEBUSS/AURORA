import { CryptoProviderError } from "./errors.js";
import { normalizeChain, normalizeTimestamp } from "./normalize.js";
import type { CryptoSentimentDataInput } from "./schemas.js";
import type {
  CryptoSentimentDataQuery,
  CryptoSentimentDataResult,
  CryptoSentimentDataType,
  CryptoSentimentProviderId,
  CryptoSentimentRecord,
} from "./types.js";

const SENTIMENT_BUNDLE_DATA_TYPES = {
  market_sentiment: ["fear_greed", "trending"],
  token_discovery: ["new_tokens", "promotion_activity"],
} as const satisfies Record<string, readonly CryptoSentimentDataType[]>;

const PROVIDER_SECTIONS: Record<
  Exclude<CryptoSentimentProviderId, "auto">,
  Set<CryptoSentimentDataType>
> = {
  alternative_me: new Set(["fear_greed"]),
  coingecko: new Set(["trending"]),
  dexscreener: new Set(["new_tokens", "promotion_activity"]),
};

export function normalizeSentimentDataInput(
  input: CryptoSentimentDataInput,
): CryptoSentimentDataQuery {
  requireSingleSelection(input.data_type, input.bundle);
  const dataTypes = input.data_type
    ? [input.data_type]
    : [...SENTIMENT_BUNDLE_DATA_TYPES[input.bundle!]];
  const provider = input.provider ?? "auto";
  if (
    provider !== "auto" &&
    dataTypes.some((dataType) => !PROVIDER_SECTIONS[provider].has(dataType))
  ) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      `${provider} cannot provide the requested sentiment section.`,
    );
  }
  return {
    dataTypes,
    provider,
    chain: input.chain ? normalizeChain(input.chain) : undefined,
    limit: input.limit,
  };
}

export function normalizeSentimentProviderResult(
  result: CryptoSentimentDataResult,
  query: CryptoSentimentDataQuery,
  providerId: string,
): CryptoSentimentDataResult {
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
      "Partial sentiment results must include a PARTIAL_DATA issue.",
    );
  }
  return { ...result, sections };
}

function normalizeRecord(
  record: CryptoSentimentRecord,
  dataType: CryptoSentimentDataType,
  query: CryptoSentimentDataQuery,
  providerId: string,
): CryptoSentimentRecord {
  const normalized = {
    ...record,
    provider: record.provider || providerId,
    timestamp: normalizeTimestamp(record.timestamp),
    symbol: record.symbol?.toUpperCase(),
    chain: record.chain ? normalizeChain(record.chain) : undefined,
  };
  if (
    normalized.dataType !== dataType ||
    normalized.venue !== "aggregate" ||
    !normalized.attribution ||
    (query.chain && normalized.chain && normalized.chain !== query.chain)
  ) {
    throw new CryptoProviderError(
      "UPSTREAM_ERROR",
      "Sentiment provider returned mismatched or unlabeled data.",
    );
  }
  return normalized;
}

function requireSingleSelection(dataType?: string, bundle?: string): void {
  if ((!dataType && !bundle) || (dataType && bundle)) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "Provide exactly one of data_type or bundle.",
    );
  }
}
