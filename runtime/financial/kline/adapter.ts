import {
  assessDataQuality,
  DATA_PROVENANCE_SCHEMA_VERSION,
  MARKET_SERIES_SCHEMA_VERSION,
  type DataCitation,
  type DataSourceReference,
  type MarketSeriesIssue,
} from "../data-contracts/index.js";
import type {
  InstrumentIdentity,
  KlineCandle,
  KlineProvenance,
  NormalizedKlinePayload,
} from "./types.js";

type NormalizationOptions = {
  provider?: string;
  source?: string;
  requested?: string;
  retrievedAt?: string;
  timeframe?: "1d" | "1w" | "1m";
  status?: "complete" | "partial";
  fallbackUsed?: boolean;
  issues?: Array<{ code: string; message: string }>;
};

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readTimestamp(record: Record<string, unknown>): string | null {
  const raw = record.trade_date ?? record.date ?? record.time ?? record.timestamp;
  if (typeof raw === "number" || (typeof raw === "string" && /^\d{10,13}$/.test(raw))) {
    const millis = Number(raw) < 10_000_000_000 ? Number(raw) * 1000 : Number(raw);
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const normalized = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === normalized
    ? normalized
    : null;
}

function normalizeCandle(record: Record<string, unknown>): KlineCandle | null {
  const timestamp = readTimestamp(record);
  const open = readNumber(record, ["open", "o"]);
  const high = readNumber(record, ["high", "h"]);
  const low = readNumber(record, ["low", "l"]);
  const close = readNumber(record, ["close", "c"]);
  const volume = readNumber(record, ["vol", "volume", "v"]);
  if (
    !timestamp ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    volume < 0 ||
    high < Math.max(open, close) ||
    low > Math.min(open, close) ||
    low > high
  ) {
    return null;
  }
  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    ...(record.isClosed === false ? { status: "open" as const } : {}),
  };
}

function uniqueIssues(issues: MarketSeriesIssue[]): MarketSeriesIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}\u0000${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceUrl(source: string): string | undefined {
  const normalized = source.toLowerCase();
  if (normalized.includes("binance")) {
    return "https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data";
  }
  if (normalized.includes("alpha vantage")) return "https://www.alphavantage.co/";
  if (normalized.includes("eod")) return "https://eodhd.com/financial-apis/";
  return undefined;
}

function buildSources(
  records: Record<string, unknown>[],
  options: NormalizationOptions,
): DataSourceReference[] {
  const sources = new Map<string, DataSourceReference>();
  for (const record of records) {
    const provider = typeof record.provider === "string" ? record.provider.trim() : "";
    const source = typeof record.source === "string" ? record.source.trim() : "";
    if (!provider || !source) continue;
    const url = sourceUrl(source);
    sources.set(`${provider}\u0000${source}`, { provider, source, ...(url ? { url } : {}) });
  }
  if (sources.size === 0 && options.provider && options.source) {
    const url = sourceUrl(options.source);
    sources.set(`${options.provider}\u0000${options.source}`, {
      provider: options.provider,
      source: options.source,
      ...(url ? { url } : {}),
    });
  }
  return [...sources.values()];
}

export function normalizeMarketRecords(
  records: Record<string, unknown>[],
  instrument: InstrumentIdentity,
  options: NormalizationOptions = {},
): NormalizedKlinePayload {
  const normalized = records
    .map(normalizeCandle)
    .filter((candle): candle is KlineCandle => candle !== null)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const candles: KlineCandle[] = [];
  let duplicateCount = 0;
  for (const candle of normalized) {
    if (candles.at(-1)?.timestamp === candle.timestamp) {
      duplicateCount += 1;
      candles[candles.length - 1] = candle;
    } else {
      candles.push(candle);
    }
  }

  const invalidCount = records.length - normalized.length;
  const issues: MarketSeriesIssue[] = [...(options.issues ?? [])];
  if (invalidCount > 0) {
    issues.push({
      code: "INVALID_CANDLE",
      message: `${invalidCount} malformed OHLCV record(s) were discarded.`,
      droppedRecordCount: invalidCount,
    });
  }
  if (duplicateCount > 0) {
    issues.push({
      code: "DUPLICATE_CANDLE",
      message: `${duplicateCount} duplicate date record(s) were replaced by the last value.`,
      droppedRecordCount: duplicateCount,
    });
  }
  if (options.fallbackUsed && !issues.some((issue) => issue.code === "PROVIDER_FALLBACK")) {
    issues.push({ code: "PROVIDER_FALLBACK", message: "A fallback provider supplied the series." });
  }
  const deduplicatedIssues = uniqueIssues(issues);
  const status =
    options.status === "partial" || invalidCount > 0 || duplicateCount > 0 ? "partial" : "complete";
  const start = candles[0]?.timestamp ?? "";
  const end = candles.at(-1)?.timestamp ?? "";
  const sources = buildSources(records, options);
  const source = sources[0]?.source ?? options.source ?? "unattributed market records";
  const provenance: KlineProvenance = {
    schemaVersion: DATA_PROVENANCE_SCHEMA_VERSION,
    source,
    mode: "live",
    asOf: end,
    coverage: start && end ? `${start} to ${end}` : "no valid records",
    retrievedAt: options.retrievedAt,
  };
  const citations: DataCitation[] = sources.flatMap((item) =>
    item.url ? [{ label: item.source, url: item.url }] : [],
  );

  return {
    schemaVersion: MARKET_SERIES_SCHEMA_VERSION,
    timeframe: options.timeframe ?? "1d",
    instrument,
    candles,
    provenance,
    coverage: {
      start,
      end,
      requested: options.requested,
      status: candles.length === 0 ? "unknown" : status,
    },
    quality: assessDataQuality({
      status,
      records: candles,
      issues: deduplicatedIssues,
      citations,
      isAttributed: () => sources.length > 0,
      failOnMissingAttribution: true,
    }),
    sources,
    issues: deduplicatedIssues,
  };
}
