import { CryptoProviderError } from "../errors.js";
import type { CryptoProvider } from "../provider.js";
import type {
  CryptoDerivativeRecord,
  CryptoDerivativeSectionType,
  CryptoDerivativesDataQuery,
  CryptoDerivativesDataResult,
  CryptoMarketDataQuery,
  CryptoMarketDataResult,
  CryptoProviderSection,
} from "../types.js";
import { createCryptoFetch, requestJson, setQuery, type CryptoFetch } from "./http.js";

const DEFAULT_BASE_URL = "https://api.coinalyze.net";

interface CoinalyzeOptions {
  apiKey: string;
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  baseUrl?: string;
}

interface CoinalyzeExchange {
  name: string;
  code: string;
}

interface CoinalyzeMarket {
  symbol: string;
  exchange: string;
  base_asset: string;
  quote_asset: string;
  is_perpetual: boolean;
}

interface CoinalyzeCurrentValue {
  symbol: string;
  value: number;
  update: number;
}

type DerivativeSection = CryptoProviderSection<CryptoDerivativeSectionType, CryptoDerivativeRecord>;

export class CoinalyzeCryptoProvider implements CryptoProvider {
  readonly id = "coinalyze";
  private readonly apiKey: string;
  private readonly fetchImpl: CryptoFetch;
  private readonly baseUrl: string;
  private exchangesPromise?: Promise<CoinalyzeExchange[]>;
  private marketsPromise?: Promise<CoinalyzeMarket[]>;

  constructor(options: CoinalyzeOptions) {
    if (!options.apiKey.trim()) {
      throw new CryptoProviderError("AUTHENTICATION_FAILED", "Coinalyze API key is required.");
    }
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  async getMarketData(_query: CryptoMarketDataQuery): Promise<CryptoMarketDataResult> {
    throw new CryptoProviderError(
      "UPSTREAM_UNAVAILABLE",
      "Coinalyze is a derivatives provider and does not supply venue market-data sections.",
    );
  }

  async getDerivativesData(
    query: CryptoDerivativesDataQuery,
  ): Promise<CryptoDerivativesDataResult> {
    const symbols = await this.resolveSymbols(query);
    const settled = await Promise.allSettled(
      query.dataTypes.map((dataType) => this.getSection(query, symbols, dataType)),
    );
    if (query.dataTypes.length === 1 && settled[0].status === "rejected") {
      throw settled[0].reason;
    }
    const sections = settled.map(
      (outcome, index): DerivativeSection =>
        outcome.status === "fulfilled"
          ? outcome.value
          : {
              dataType: query.dataTypes[index],
              status: "partial",
              records: [],
              issues: [
                {
                  code: "PARTIAL_DATA",
                  message:
                    outcome.reason instanceof Error
                      ? outcome.reason.message
                      : String(outcome.reason),
                },
              ],
            },
    );
    return {
      status: sections.some((section) => section.status === "partial") ? "partial" : "complete",
      sections,
    };
  }

  private async getSection(
    query: CryptoDerivativesDataQuery,
    symbols: CoinalyzeMarket[],
    dataType: CryptoDerivativeSectionType,
  ): Promise<DerivativeSection> {
    switch (dataType) {
      case "funding":
        return this.getCurrentValues(
          query,
          symbols,
          dataType,
          "funding-rate",
          "funding_rate",
          "percent",
        );
      case "open_interest":
        return this.getCurrentValues(
          query,
          symbols,
          dataType,
          "open-interest",
          "open_interest",
          "USD",
        );
      case "contract_metadata":
        return {
          dataType,
          status: "complete",
          records: symbols.map((market) => ({
            ...this.identity(query, market, new Date().toISOString()),
            dataType,
            marketType: query.marketType,
            metric: "contract_available",
            value: 1,
            unit: "boolean",
            methodology: "reported",
          })),
        };
      default:
        return {
          dataType,
          status: "partial",
          records: [],
          issues: [
            {
              code: "PARTIAL_DATA",
              message: `Coinalyze ${dataType} mapping is not enabled in the first provider slice.`,
            },
          ],
        };
    }
  }

  private async getCurrentValues(
    query: CryptoDerivativesDataQuery,
    symbols: CoinalyzeMarket[],
    dataType: "funding" | "open_interest",
    endpoint: string,
    metric: string,
    unit: string,
  ): Promise<DerivativeSection> {
    const raw = await this.get<CoinalyzeCurrentValue[]>(`/v1/${endpoint}`, {
      symbols: symbols.map((market) => market.symbol).join(","),
    });
    const marketBySymbol = new Map(symbols.map((market) => [market.symbol, market]));
    return {
      dataType,
      status: "complete",
      records: raw.flatMap((item) => {
        const market = marketBySymbol.get(item.symbol);
        if (!market) return [];
        return [
          {
            ...this.identity(query, market, new Date(item.update).toISOString()),
            dataType,
            marketType: query.marketType,
            metric,
            value: Number(item.value),
            unit,
            methodology: "reported" as const,
          },
        ];
      }),
    };
  }

  private async resolveSymbols(query: CryptoDerivativesDataQuery): Promise<CoinalyzeMarket[]> {
    const [exchanges, markets] = await Promise.all([this.getExchanges(), this.getMarkets()]);
    const exchangeNames = new Map(exchanges.map((exchange) => [exchange.code, exchange.name]));
    const requestedVenue = query.venue?.toLowerCase();
    const matches = markets.filter((market) => {
      if (market.base_asset.toUpperCase() !== query.baseAsset) return false;
      if (market.quote_asset.toUpperCase() !== query.quoteAsset) return false;
      if (query.marketType === "perpetual" && !market.is_perpetual) return false;
      if (query.marketType === "future" && market.is_perpetual) return false;
      if (!requestedVenue || requestedVenue === "aggregate" || requestedVenue === "coinalyze")
        return true;
      return exchangeNames.get(market.exchange)?.toLowerCase() === requestedVenue;
    });
    if (matches.length === 0) {
      throw new CryptoProviderError(
        "NO_DATA",
        `Coinalyze has no matching contract for ${query.symbol} ${query.marketType}.`,
      );
    }
    return matches.slice(0, 20);
  }

  private getExchanges(): Promise<CoinalyzeExchange[]> {
    this.exchangesPromise ??= this.get<CoinalyzeExchange[]>("/v1/exchanges");
    return this.exchangesPromise;
  }

  private getMarkets(): Promise<CoinalyzeMarket[]> {
    this.marketsPromise ??= this.get<CoinalyzeMarket[]>("/v1/future-markets");
    return this.marketsPromise;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = setQuery(new URL(path, this.baseUrl), { ...params, api_key: this.apiKey });
    return requestJson<T>(this.fetchImpl, url);
  }

  private identity(query: CryptoDerivativesDataQuery, market: CoinalyzeMarket, timestamp: string) {
    const venue = market.symbol.split(".").at(-1) ?? market.exchange;
    return {
      baseAsset: query.baseAsset,
      quoteAsset: query.quoteAsset,
      symbol: query.symbol,
      marketType: query.marketType,
      venue: this.venueName(venue),
      provider: this.id,
      timestamp,
    };
  }

  private venueName(code: string): string {
    const known: Record<string, string> = {
      A: "binance",
      "6": "bybit",
      "2": "deribit",
      "3": "okx",
      H: "hyperliquid",
    };
    return known[code] ?? code.toLowerCase();
  }
}
