import { UsDataProviderError } from "../errors.js";
import type { UsEquityMarketProvider } from "../provider.js";
import type {
  UsEquityBarRecord,
  UsEquityFrequency,
  UsEquityMarketDataQuery,
  UsEquityMarketDataResult,
} from "../types.js";
import { createUsDataFetch, requestJson, setQuery, type UsDataFetch } from "./http.js";

const DEFAULT_BASE_URL = "https://www.alphavantage.co/query";

interface AlphaVantageEquityMarketProviderOptions {
  apiKey: string;
  fetchImpl?: UsDataFetch;
  proxyUrl?: string;
  baseUrl?: string;
}

interface AlphaVantageResponse {
  [key: string]: unknown;
  "Error Message"?: string;
  Note?: string;
  Information?: string;
}

interface AlphaVantageSeriesConfig {
  fn: string;
  key: string;
}

const SERIES: Record<UsEquityFrequency, AlphaVantageSeriesConfig> = {
  daily: { fn: "TIME_SERIES_DAILY", key: "Time Series (Daily)" },
  weekly: { fn: "TIME_SERIES_WEEKLY_ADJUSTED", key: "Weekly Adjusted Time Series" },
  monthly: { fn: "TIME_SERIES_MONTHLY_ADJUSTED", key: "Monthly Adjusted Time Series" },
};

export class AlphaVantageEquityMarketProvider implements UsEquityMarketProvider {
  readonly id = "alpha_vantage";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: UsDataFetch;

  constructor(options: AlphaVantageEquityMarketProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new UsDataProviderError("CONFIGURATION_MISSING", "ALPHA_VANTAGE_API_KEY is required.");
    }
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? createUsDataFetch({ proxyUrl: options.proxyUrl });
  }

  async getEquityMarketData(query: UsEquityMarketDataQuery): Promise<UsEquityMarketDataResult> {
    const config = SERIES[query.frequency];
    const outputSize =
      query.frequency === "daily" && (query.startDate || (query.limit ?? 0) > 100)
        ? "full"
        : "compact";
    const url = setQuery(new URL(this.baseUrl), {
      function: config.fn,
      symbol: query.symbol,
      outputsize: outputSize,
      apikey: this.apiKey,
    });
    const response = await requestJson<AlphaVantageResponse>(this.fetchImpl, url);
    const message = response["Error Message"] ?? response.Note ?? response.Information;
    if (message) {
      throw new UsDataProviderError(
        response.Note || response.Information ? "RATE_LIMITED" : "UPSTREAM_ERROR",
        message,
      );
    }

    const series = response[config.key] as Record<string, AlphaVantageBar> | undefined;
    if (!series) {
      throw new UsDataProviderError(
        "UPSTREAM_ERROR",
        `Alpha Vantage did not include ${config.key} in the response.`,
      );
    }

    const records = Object.entries(series)
      .flatMap(([date, row]) => toRecord(date, row, query))
      .filter((record) => isInDateRange(record.date, query.startDate, query.endDate))
      .sort((a, b) => a.date.localeCompare(b.date));
    const limited = query.limit ? records.slice(-query.limit) : records;
    return {
      status: "complete",
      sections: [{ dataType: "ohlcv", status: "complete", records: limited }],
    };
  }
}

interface AlphaVantageBar {
  "1. open"?: string;
  "2. high"?: string;
  "3. low"?: string;
  "4. close"?: string;
  "5. adjusted close"?: string;
  "5. volume"?: string;
  "6. volume"?: string;
  "7. dividend amount"?: string;
}

function toRecord(
  date: string,
  row: AlphaVantageBar,
  query: UsEquityMarketDataQuery,
): UsEquityBarRecord[] {
  const open = numberValue(row["1. open"]);
  const high = numberValue(row["2. high"]);
  const low = numberValue(row["3. low"]);
  const close = numberValue(row["4. close"]);
  const volume = numberValue(row["6. volume"] ?? row["5. volume"]);
  if (open === undefined || high === undefined || low === undefined) return [];
  if (close === undefined || volume === undefined) return [];

  return [
    {
      dataType: "ohlcv",
      symbol: query.symbol,
      date,
      open,
      high,
      low,
      close,
      volume,
      adjustedClose: numberValue(row["5. adjusted close"]),
      dividend: numberValue(row["7. dividend amount"]),
      frequency: query.frequency,
      currency: "USD",
      provider: "alpha_vantage",
      source: "Alpha Vantage",
    },
  ];
}

function isInDateRange(date: string, startDate?: string, endDate?: string): boolean {
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
