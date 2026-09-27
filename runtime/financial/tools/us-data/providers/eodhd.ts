import { UsDataProviderError } from "../errors.js";
import type { UsEquityMarketProvider } from "../provider.js";
import type {
  UsEquityBarRecord,
  UsEquityFrequency,
  UsEquityMarketDataQuery,
  UsEquityMarketDataResult,
} from "../types.js";
import { createUsDataFetch, requestJson, setQuery, type UsDataFetch } from "./http.js";

const DEFAULT_BASE_URL = "https://eodhd.com/api/eod/";

interface EodhdEquityMarketProviderOptions {
  apiToken: string;
  fetchImpl?: UsDataFetch;
  proxyUrl?: string;
  baseUrl?: string;
}

interface EodhdBar {
  date: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  adjusted_close?: number | string;
  volume?: number | string;
}

const PERIOD: Record<UsEquityFrequency, string> = {
  daily: "d",
  weekly: "w",
  monthly: "m",
};

export class EodhdEquityMarketProvider implements UsEquityMarketProvider {
  readonly id = "eodhd";
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: UsDataFetch;

  constructor(options: EodhdEquityMarketProviderOptions) {
    if (!options.apiToken.trim()) {
      throw new UsDataProviderError("CONFIGURATION_MISSING", "EODHD_API_TOKEN is required.");
    }
    this.apiToken = options.apiToken.trim();
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? createUsDataFetch({ proxyUrl: options.proxyUrl });
  }

  async getEquityMarketData(query: UsEquityMarketDataQuery): Promise<UsEquityMarketDataResult> {
    const eodSymbol = toEodhdSymbol(query.symbol);
    const url = setQuery(new URL(encodeURIComponent(eodSymbol), this.baseUrl), {
      api_token: this.apiToken,
      fmt: "json",
      period: PERIOD[query.frequency],
      from: query.startDate,
      to: query.endDate,
    });
    const response = await requestJson<EodhdBar[] | EodhdError>(this.fetchImpl, url);
    if (!Array.isArray(response)) {
      throw new UsDataProviderError(
        "UPSTREAM_ERROR",
        response.errors ?? response.message ?? "EODHD returned an unexpected response.",
      );
    }

    const rows = query.limit ? response.slice(-query.limit) : response;
    const records = rows
      .flatMap((row) => toRecord(row, query))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      status: "complete",
      sections: [{ dataType: "ohlcv", status: "complete", records }],
    };
  }
}

interface EodhdError {
  errors?: string;
  message?: string;
}

function toEodhdSymbol(symbol: string): string {
  if (/\.[A-Z]{2,6}$/.test(symbol)) return symbol;
  return `${symbol.replace(".", "-")}.US`;
}

function toRecord(row: EodhdBar, query: UsEquityMarketDataQuery): UsEquityBarRecord[] {
  const open = numberValue(row.open);
  const high = numberValue(row.high);
  const low = numberValue(row.low);
  const close = numberValue(row.close);
  const volume = numberValue(row.volume);
  if (!row.date || open === undefined || high === undefined || low === undefined) return [];
  if (close === undefined || volume === undefined) return [];

  const adjustedClose = numberValue(row.adjusted_close);
  return [
    {
      dataType: "ohlcv",
      symbol: query.symbol,
      date: row.date,
      open,
      high,
      low,
      close,
      volume,
      adjustedClose,
      frequency: query.frequency,
      currency: "USD",
      provider: "eodhd",
      source: "EOD Historical Data",
    },
  ];
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
