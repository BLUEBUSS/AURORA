import { CryptoProviderError } from "../errors.js";
import type { CryptoProvider } from "../provider.js";
import type {
  CryptoDerivativeRecord,
  CryptoDerivativeSectionType,
  CryptoDerivativesDataQuery,
  CryptoDerivativesDataResult,
  CryptoInterval,
  CryptoMarketDataQuery,
  CryptoMarketDataRecord,
  CryptoMarketDataResult,
  CryptoMarketDataType,
  CryptoProviderSection,
} from "../types.js";
import { createCryptoFetch, requestJson, setQuery, type CryptoFetch } from "./http.js";

const DEFAULT_BASE_URL = "https://api.bybit.com";

const INTERVALS: Record<CryptoInterval, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  "1w": "W",
};

const DERIVATIVE_INTERVALS: Partial<Record<CryptoInterval, string>> = {
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

const INTERVAL_MILLISECONDS: Record<CryptoInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
};

interface BybitOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  baseUrl?: string;
}

interface BybitResponse<T> {
  retCode: number;
  retMsg: string;
  time?: number;
  result: T;
}

interface BybitListResult<T> {
  list: T[];
}

type MarketSection = CryptoProviderSection<CryptoMarketDataType, CryptoMarketDataRecord>;
type DerivativeSection = CryptoProviderSection<CryptoDerivativeSectionType, CryptoDerivativeRecord>;

export class BybitCryptoProvider implements CryptoProvider {
  readonly id = "bybit";
  private readonly fetchImpl: CryptoFetch;
  private readonly baseUrl: string;

  constructor(options: BybitOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  async getMarketData(query: CryptoMarketDataQuery): Promise<CryptoMarketDataResult> {
    const sections = await this.collectSections(query.dataTypes, (dataType) =>
      this.getMarketSection(query, dataType),
    );
    return this.resultFromSections(sections);
  }

  async getDerivativesData(
    query: CryptoDerivativesDataQuery,
  ): Promise<CryptoDerivativesDataResult> {
    const sections = await this.collectSections(query.dataTypes, (dataType) =>
      this.getDerivativeSection(query, dataType),
    );
    return this.resultFromSections(sections);
  }

  private async collectSections<
    TDataType extends string,
    TRecord extends CryptoMarketDataRecord | CryptoDerivativeRecord,
  >(
    dataTypes: TDataType[],
    load: (dataType: TDataType) => Promise<CryptoProviderSection<TDataType, TRecord>>,
  ): Promise<CryptoProviderSection<TDataType, TRecord>[]> {
    const settled = await Promise.allSettled(dataTypes.map((dataType) => load(dataType)));
    if (dataTypes.length === 1 && settled[0].status === "rejected") throw settled[0].reason;
    return settled.map((outcome, index) =>
      outcome.status === "fulfilled"
        ? outcome.value
        : this.partialSection(
            dataTypes[index],
            outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          ),
    );
  }

  private resultFromSections<
    TDataType extends string,
    TRecord extends CryptoMarketDataRecord | CryptoDerivativeRecord,
  >(sections: CryptoProviderSection<TDataType, TRecord>[]) {
    return {
      status: sections.some((section) => section.status === "partial") ? "partial" : "complete",
      sections,
    } as const;
  }

  private getMarketSection(
    query: CryptoMarketDataQuery,
    dataType: CryptoMarketDataType,
  ): Promise<MarketSection> {
    switch (dataType) {
      case "snapshot":
        return this.getSnapshot(query);
      case "ohlcv":
        return this.getOhlcv(query);
      case "trades":
        return this.getTrades(query);
      case "orderbook":
        return this.getOrderbook(query);
      case "instruments":
        return this.getInstrument(query);
    }
  }

  private getDerivativeSection(
    query: CryptoDerivativesDataQuery,
    dataType: CryptoDerivativeSectionType,
  ): Promise<DerivativeSection> {
    switch (dataType) {
      case "funding":
        return this.getFunding(query);
      case "open_interest":
        return this.getOpenInterest(query);
      case "basis":
        return this.getBasis(query);
      case "long_short_ratio":
        return this.getLongShortRatio(query);
      case "contract_metadata":
        return this.getContractMetadata(query);
      case "taker_flow":
        return Promise.resolve(
          this.partialSection(
            dataType,
            "Bybit does not expose a matching public REST taker-flow history endpoint.",
          ),
        );
      case "liquidations":
        return Promise.resolve(
          this.partialSection(
            dataType,
            "Bybit liquidation events require the later WebSocket collector; REST history is not fabricated.",
          ),
        );
      case "insurance_risk":
        return Promise.resolve(
          this.partialSection(
            dataType,
            "Bybit insurance-pool mapping is not enabled in this synchronous provider slice.",
          ),
        );
    }
  }

  private category(query: CryptoMarketDataQuery | CryptoDerivativesDataQuery): string {
    if (query.marketType === "spot") return "spot";
    return query.quoteAsset === "USD" ? "inverse" : "linear";
  }

  private venueSymbol(query: CryptoMarketDataQuery | CryptoDerivativesDataQuery): string {
    return `${query.baseAsset}${query.quoteAsset}`;
  }

  private identity(query: CryptoMarketDataQuery | CryptoDerivativesDataQuery, timestamp: string) {
    return {
      baseAsset: query.baseAsset,
      quoteAsset: query.quoteAsset,
      symbol: query.symbol,
      marketType: query.marketType,
      venue: "bybit",
      provider: this.id,
      timestamp,
    };
  }

  private async getSnapshot(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const response = await this.getList<Record<string, unknown>>("/v5/market/tickers", {
      category: this.category(query),
      symbol: this.venueSymbol(query),
    });
    const ticker = response.result.list[0];
    if (!ticker) return { dataType: "snapshot", status: "complete", records: [] };
    const timestamp = new Date(response.time ?? Date.now()).toISOString();
    return {
      dataType: "snapshot",
      status: "complete",
      records: [
        {
          ...this.identity(query, timestamp),
          dataType: "snapshot",
          price: Number(ticker.lastPrice),
          priceUnit: query.quoteAsset,
          volume24h: Number(ticker.volume24h),
          volumeUnit: query.baseAsset,
          quoteVolume24h: Number(ticker.turnover24h),
          quoteVolumeUnit: query.quoteAsset,
          change24h: Number(ticker.price24hPcnt),
          change24hUnit: "decimal",
        },
      ],
    };
  }

  private async getOhlcv(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const interval = query.interval ?? "1h";
    const response = await this.getList<unknown[]>("/v5/market/kline", {
      category: this.category(query),
      symbol: this.venueSymbol(query),
      interval: INTERVALS[interval],
      start: query.startTime ? new Date(query.startTime).getTime() : undefined,
      end: query.endTime ? new Date(query.endTime).getTime() : undefined,
      limit: Math.min(query.limit ?? 200, 1_000),
    });
    return {
      dataType: "ohlcv",
      status: "complete",
      records: response.result.list.toReversed().map((row) => {
        const openTime = Number(row[0]);
        return {
          ...this.identity(query, new Date(openTime).toISOString()),
          dataType: "ohlcv" as const,
          interval,
          openTime: new Date(openTime).toISOString(),
          closeTime: new Date(openTime + INTERVAL_MILLISECONDS[interval]).toISOString(),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          priceUnit: query.quoteAsset,
          volume: Number(row[5]),
          volumeUnit: query.baseAsset,
          quoteVolume: Number(row[6]),
          quoteVolumeUnit: query.quoteAsset,
        };
      }),
    };
  }

  private async getTrades(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const response = await this.getList<Record<string, unknown>>("/v5/market/recent-trade", {
      category: this.category(query),
      symbol: this.venueSymbol(query),
      limit: Math.min(query.limit ?? 100, 1_000),
    });
    return {
      dataType: "trades",
      status: "complete",
      records: response.result.list.map((trade) => ({
        ...this.identity(query, new Date(Number(trade.time)).toISOString()),
        dataType: "trades",
        tradeId: String(trade.execId),
        price: Number(trade.price),
        priceUnit: query.quoteAsset,
        quantity: Number(trade.size),
        quantityUnit: query.baseAsset,
        side: String(trade.side).toLowerCase() === "buy" ? "buy" : "sell",
      })),
    };
  }

  private async getOrderbook(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const response = await this.get<{
      b?: unknown[][];
      a?: unknown[][];
      ts?: number;
    }>("/v5/market/orderbook", {
      category: this.category(query),
      symbol: this.venueSymbol(query),
      limit: Math.min(query.depth ?? query.limit ?? 50, 1_000),
    });
    const timestamp = new Date(response.result.ts ?? response.time ?? Date.now()).toISOString();
    const records: CryptoMarketDataRecord[] = [];
    for (const [side, levels] of [
      ["bid", response.result.b ?? []],
      ["ask", response.result.a ?? []],
    ] as const) {
      levels.forEach((level, index) => {
        records.push({
          ...this.identity(query, timestamp),
          dataType: "orderbook",
          side,
          level: index + 1,
          price: Number(level[0]),
          priceUnit: query.quoteAsset,
          quantity: Number(level[1]),
          quantityUnit: query.baseAsset,
        });
      });
    }
    return { dataType: "orderbook", status: "complete", records };
  }

  private async getInstrument(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const response = await this.getList<Record<string, unknown>>("/v5/market/instruments-info", {
      category: this.category(query),
      symbol: this.venueSymbol(query),
    });
    const instrument = response.result.list[0];
    if (!instrument) return { dataType: "instruments", status: "complete", records: [] };
    const priceFilter = instrument.priceFilter as Record<string, unknown> | undefined;
    const lotSizeFilter = instrument.lotSizeFilter as Record<string, unknown> | undefined;
    return {
      dataType: "instruments",
      status: "complete",
      records: [
        {
          ...this.identity(query, new Date(response.time ?? Date.now()).toISOString()),
          dataType: "instruments",
          venueSymbol: String(instrument.symbol),
          status: String(instrument.status ?? "unknown"),
          contractExpiry: instrument.deliveryTime
            ? new Date(Number(instrument.deliveryTime)).toISOString()
            : undefined,
          tickSize: priceFilter?.tickSize ? Number(priceFilter.tickSize) : undefined,
          lotSize: lotSizeFilter?.qtyStep ? Number(lotSizeFilter.qtyStep) : undefined,
        },
      ],
    };
  }

  private async getFunding(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    const response = await this.getList<Record<string, unknown>>("/v5/market/funding/history", {
      category: this.category(query),
      symbol: this.venueSymbol(query),
      startTime: query.startTime ? new Date(query.startTime).getTime() : undefined,
      endTime: query.endTime ? new Date(query.endTime).getTime() : undefined,
      limit: Math.min(query.limit ?? 100, 200),
    });
    return {
      dataType: "funding",
      status: "complete",
      records: response.result.list.toReversed().map((item) => ({
        ...this.identity(query, new Date(Number(item.fundingRateTimestamp)).toISOString()),
        dataType: "funding",
        marketType: query.marketType,
        metric: "funding_rate",
        value: Number(item.fundingRate),
        unit: "decimal",
        interval: "8h",
        methodology: "reported",
      })),
    };
  }

  private async getOpenInterest(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    const intervalTime = this.derivativeInterval(query.interval);
    const response = await this.getList<Record<string, unknown>>("/v5/market/open-interest", {
      category: this.category(query),
      symbol: this.venueSymbol(query),
      intervalTime,
      startTime: query.startTime ? new Date(query.startTime).getTime() : undefined,
      endTime: query.endTime ? new Date(query.endTime).getTime() : undefined,
      limit: Math.min(query.limit ?? 50, 200),
    });
    return {
      dataType: "open_interest",
      status: "complete",
      records: response.result.list.toReversed().map((item) => ({
        ...this.identity(query, new Date(Number(item.timestamp)).toISOString()),
        dataType: "open_interest",
        marketType: query.marketType,
        metric: "open_interest",
        value: Number(item.openInterest),
        unit: "contracts",
        interval: query.interval,
        methodology: "reported",
      })),
    };
  }

  private async getBasis(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    const response = await this.getList<Record<string, unknown>>("/v5/market/tickers", {
      category: this.category(query),
      symbol: this.venueSymbol(query),
    });
    const ticker = response.result.list[0];
    if (!ticker) return { dataType: "basis", status: "complete", records: [] };
    const markPrice = Number(ticker.markPrice);
    const indexPrice = Number(ticker.indexPrice);
    return {
      dataType: "basis",
      status: "complete",
      records: [
        {
          ...this.identity(query, new Date(response.time ?? Date.now()).toISOString()),
          dataType: "basis",
          marketType: query.marketType,
          metric: "basis",
          value: indexPrice === 0 ? 0 : (markPrice - indexPrice) / indexPrice,
          unit: "decimal",
          methodology: "derived",
        },
      ],
    };
  }

  private async getLongShortRatio(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    const response = await this.getList<Record<string, unknown>>("/v5/market/account-ratio", {
      category: this.category(query),
      symbol: this.venueSymbol(query),
      period: this.derivativeInterval(query.interval),
      limit: Math.min(query.limit ?? 50, 500),
    });
    return {
      dataType: "long_short_ratio",
      status: "complete",
      records: response.result.list.toReversed().map((item) => {
        const sellRatio = Number(item.sellRatio);
        return {
          ...this.identity(query, new Date(Number(item.timestamp)).toISOString()),
          dataType: "long_short_ratio",
          marketType: query.marketType,
          metric: "long_short_ratio",
          value: sellRatio === 0 ? 0 : Number(item.buyRatio) / sellRatio,
          unit: "ratio",
          interval: query.interval,
          methodology: "derived",
        };
      }),
    };
  }

  private async getContractMetadata(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    const response = await this.getList<Record<string, unknown>>("/v5/market/instruments-info", {
      category: this.category(query),
      symbol: this.venueSymbol(query),
    });
    return {
      dataType: "contract_metadata",
      status: "complete",
      records: response.result.list.map((item) => ({
        ...this.identity(query, new Date(response.time ?? Date.now()).toISOString()),
        dataType: "contract_metadata",
        marketType: query.marketType,
        metric: "contract_status",
        value: item.status === "Trading" ? 1 : 0,
        unit: "boolean",
        contractExpiry: item.deliveryTime
          ? new Date(Number(item.deliveryTime)).toISOString()
          : undefined,
        methodology: "reported",
      })),
    };
  }

  private derivativeInterval(interval: CryptoInterval | undefined): string {
    const normalized = interval ?? "1h";
    const value = DERIVATIVE_INTERVALS[normalized];
    if (!value) {
      throw new CryptoProviderError(
        "INVALID_ARGUMENT",
        `Bybit derivatives history does not support interval ${normalized}.`,
      );
    }
    return value;
  }

  private async getList<T>(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<BybitResponse<BybitListResult<T>>> {
    return this.get<BybitListResult<T>>(path, params);
  }

  private async get<T>(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<BybitResponse<T>> {
    const url = setQuery(new URL(path, this.baseUrl), params);
    const response = await requestJson<BybitResponse<T>>(this.fetchImpl, url);
    if (response.retCode === 10006) {
      throw new CryptoProviderError("RATE_LIMITED", "Bybit rate limit exceeded.");
    }
    if (response.retCode !== 0) {
      throw new CryptoProviderError(
        "UPSTREAM_ERROR",
        `Bybit returned ${response.retCode}: ${response.retMsg}`,
      );
    }
    return response;
  }

  private partialSection<
    TDataType extends string,
    TRecord extends CryptoMarketDataRecord | CryptoDerivativeRecord,
  >(dataType: TDataType, message: string): CryptoProviderSection<TDataType, TRecord> {
    return {
      dataType,
      status: "partial",
      records: [],
      issues: [{ code: "PARTIAL_DATA", message }],
    };
  }
}
