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

const DEFAULT_BASE_URL = "https://www.deribit.com";
const INSTRUMENT_CACHE_MS = 300_000;

const RESOLUTIONS: Partial<Record<CryptoInterval, string>> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "1d": "1D",
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

interface DeribitOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  baseUrl?: string;
  now?: () => number;
}

interface DeribitResponse<T> {
  jsonrpc: string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface DeribitInstrument {
  instrument_name: string;
  kind: string;
  base_currency: string;
  quote_currency: string;
  settlement_period?: string;
  expiration_timestamp?: number;
  is_active?: boolean;
  tick_size?: number;
  min_trade_amount?: number;
}

interface DeribitTicker {
  timestamp?: number;
  last_price?: number;
  mark_price?: number;
  index_price?: number;
  funding_8h?: number;
  open_interest?: number;
  stats?: { volume?: number; volume_usd?: number; price_change?: number };
}

type MarketSection = CryptoProviderSection<CryptoMarketDataType, CryptoMarketDataRecord>;
type DerivativeSection = CryptoProviderSection<CryptoDerivativeSectionType, CryptoDerivativeRecord>;

export class DeribitCryptoProvider implements CryptoProvider {
  readonly id = "deribit";
  private readonly fetchImpl: CryptoFetch;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly instrumentCache = new Map<
    string,
    { expiresAt: number; promise: Promise<DeribitInstrument[]> }
  >();
  private readonly tickerPromises = new Map<string, Promise<DeribitTicker>>();

  constructor(options: DeribitOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.now = options.now ?? Date.now;
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
        return this.getInstrumentSection(query);
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
        return query.startTime
          ? Promise.resolve(
              this.partialSection(
                dataType,
                "Deribit public REST does not expose open-interest history for this contract.",
              ),
            )
          : this.getOpenInterest(query);
      case "basis":
        return query.startTime
          ? Promise.resolve(
              this.partialSection(
                dataType,
                "Deribit public REST does not expose historical basis for this contract.",
              ),
            )
          : this.getBasis(query);
      case "contract_metadata":
        return this.getContractMetadata(query);
      case "long_short_ratio":
      case "taker_flow":
      case "liquidations":
      case "insurance_risk":
        return Promise.resolve(
          this.partialSection(
            dataType,
            `Deribit does not expose a matching public REST ${dataType} history endpoint.`,
          ),
        );
    }
  }

  private identity(query: CryptoMarketDataQuery | CryptoDerivativesDataQuery, timestamp: string) {
    return {
      baseAsset: query.baseAsset,
      quoteAsset: query.quoteAsset,
      symbol: query.symbol,
      marketType: query.marketType,
      venue: "deribit",
      provider: this.id,
      timestamp,
    };
  }

  private async getSnapshot(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const instrument = await this.resolveInstrument(query);
    const ticker = await this.getTicker(instrument.instrument_name);
    const timestamp = new Date(ticker.timestamp ?? this.now()).toISOString();
    return {
      dataType: "snapshot",
      status: "complete",
      records: [
        {
          ...this.identity(query, timestamp),
          dataType: "snapshot",
          price: Number(ticker.last_price),
          priceUnit: query.quoteAsset,
          volume24h: Number(ticker.stats?.volume),
          volumeUnit: query.baseAsset,
          quoteVolume24h: Number(ticker.stats?.volume_usd),
          quoteVolumeUnit: "USD",
          change24h: Number(ticker.stats?.price_change) / 100,
          change24hUnit: "decimal",
        },
      ],
    };
  }

  private async getOhlcv(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const instrument = await this.resolveInstrument(query);
    const interval = query.interval ?? "1h";
    const resolution = RESOLUTIONS[interval];
    if (!resolution) {
      throw new CryptoProviderError(
        "INVALID_ARGUMENT",
        `Deribit chart data does not support interval ${interval}.`,
      );
    }
    const end = query.endTime ? new Date(query.endTime).getTime() : this.now();
    const start = query.startTime
      ? new Date(query.startTime).getTime()
      : end - (query.limit ?? 100) * INTERVAL_MILLISECONDS[interval];
    const chart = await this.get<{
      status: string;
      ticks: number[];
      open: number[];
      high: number[];
      low: number[];
      close: number[];
      volume: number[];
    }>("public/get_tradingview_chart_data", {
      instrument_name: instrument.instrument_name,
      start_timestamp: start,
      end_timestamp: end,
      resolution,
    });
    if (chart.status !== "ok") {
      throw new CryptoProviderError("NO_DATA", `Deribit returned chart status ${chart.status}.`);
    }
    return {
      dataType: "ohlcv",
      status: "complete",
      records: chart.ticks.map((tick, index) => ({
        ...this.identity(query, new Date(tick).toISOString()),
        dataType: "ohlcv",
        interval,
        openTime: new Date(tick).toISOString(),
        closeTime: new Date(tick + INTERVAL_MILLISECONDS[interval]).toISOString(),
        open: Number(chart.open[index]),
        high: Number(chart.high[index]),
        low: Number(chart.low[index]),
        close: Number(chart.close[index]),
        priceUnit: query.quoteAsset,
        volume: Number(chart.volume[index]),
        volumeUnit: query.baseAsset,
      })),
    };
  }

  private async getTrades(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const instrument = await this.resolveInstrument(query);
    const result = await this.get<{ trades?: Array<Record<string, unknown>> }>(
      "public/get_last_trades_by_instrument",
      {
        instrument_name: instrument.instrument_name,
        count: Math.min(query.limit ?? 100, 1_000),
        sorting: "desc",
      },
    );
    return {
      dataType: "trades",
      status: "complete",
      records: (result.trades ?? []).map((trade) => ({
        ...this.identity(query, new Date(Number(trade.timestamp)).toISOString()),
        dataType: "trades",
        tradeId: String(trade.trade_id),
        price: Number(trade.price),
        priceUnit: query.quoteAsset,
        quantity: Number(trade.amount),
        quantityUnit: query.baseAsset,
        side: trade.direction === "buy" ? "buy" : "sell",
      })),
    };
  }

  private async getOrderbook(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const instrument = await this.resolveInstrument(query);
    const result = await this.get<{ timestamp?: number; bids?: unknown[][]; asks?: unknown[][] }>(
      "public/get_order_book",
      {
        instrument_name: instrument.instrument_name,
        depth: Math.min(query.depth ?? query.limit ?? 20, 10_000),
      },
    );
    const timestamp = new Date(result.timestamp ?? this.now()).toISOString();
    const records: CryptoMarketDataRecord[] = [];
    for (const [side, levels] of [
      ["bid", result.bids ?? []],
      ["ask", result.asks ?? []],
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

  private async getInstrumentSection(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const instrument = await this.resolveInstrument(query);
    return {
      dataType: "instruments",
      status: "complete",
      records: [
        {
          ...this.identity(query, new Date(this.now()).toISOString()),
          dataType: "instruments",
          venueSymbol: instrument.instrument_name,
          status: instrument.is_active === false ? "inactive" : "active",
          contractExpiry: instrument.expiration_timestamp
            ? new Date(instrument.expiration_timestamp).toISOString()
            : undefined,
          tickSize: instrument.tick_size,
          lotSize: instrument.min_trade_amount,
        },
      ],
    };
  }

  private async getFunding(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    if (query.marketType !== "perpetual") {
      return this.partialSection(
        "funding",
        "Deribit funding rates apply to perpetual contracts, not dated futures.",
      );
    }
    const instrument = await this.resolveInstrument(query);
    if (query.startTime && query.endTime) {
      const history = await this.get<Array<Record<string, unknown>>>(
        "public/get_funding_rate_history",
        {
          instrument_name: instrument.instrument_name,
          start_timestamp: new Date(query.startTime).getTime(),
          end_timestamp: new Date(query.endTime).getTime(),
        },
      );
      return {
        dataType: "funding",
        status: "complete",
        records: history.map((item) => ({
          ...this.identity(query, new Date(Number(item.timestamp)).toISOString()),
          dataType: "funding",
          marketType: query.marketType,
          metric: "funding_rate",
          value: Number(item.interest_8h),
          unit: "decimal",
          interval: "8h",
          methodology: "reported",
        })),
      };
    }
    const ticker = await this.getTicker(instrument.instrument_name);
    return {
      dataType: "funding",
      status: "complete",
      records: [
        {
          ...this.identity(query, new Date(ticker.timestamp ?? this.now()).toISOString()),
          dataType: "funding",
          marketType: query.marketType,
          metric: "funding_rate",
          value: Number(ticker.funding_8h),
          unit: "decimal",
          interval: "8h",
          methodology: "reported",
        },
      ],
    };
  }

  private async getOpenInterest(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    const instrument = await this.resolveInstrument(query);
    const ticker = await this.getTicker(instrument.instrument_name);
    return {
      dataType: "open_interest",
      status: "complete",
      records: [
        {
          ...this.identity(query, new Date(ticker.timestamp ?? this.now()).toISOString()),
          dataType: "open_interest",
          marketType: query.marketType,
          metric: "open_interest",
          value: Number(ticker.open_interest),
          unit: query.quoteAsset,
          methodology: "reported",
        },
      ],
    };
  }

  private async getBasis(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    const instrument = await this.resolveInstrument(query);
    const ticker = await this.getTicker(instrument.instrument_name);
    const markPrice = Number(ticker.mark_price);
    const indexPrice = Number(ticker.index_price);
    return {
      dataType: "basis",
      status: "complete",
      records: [
        {
          ...this.identity(query, new Date(ticker.timestamp ?? this.now()).toISOString()),
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

  private async getContractMetadata(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    const instrument = await this.resolveInstrument(query);
    return {
      dataType: "contract_metadata",
      status: "complete",
      records: [
        {
          ...this.identity(query, new Date(this.now()).toISOString()),
          dataType: "contract_metadata",
          marketType: query.marketType,
          metric: "contract_status",
          value: instrument.is_active === false ? 0 : 1,
          unit: "boolean",
          contractExpiry: instrument.expiration_timestamp
            ? new Date(instrument.expiration_timestamp).toISOString()
            : undefined,
          methodology: "reported",
        },
      ],
    };
  }

  private async resolveInstrument(
    query: CryptoMarketDataQuery | CryptoDerivativesDataQuery,
  ): Promise<DeribitInstrument> {
    const kind = query.marketType === "spot" ? "spot" : "future";
    const instruments = await this.getInstruments(query.baseAsset, kind);
    const matches = instruments.filter(
      (instrument) =>
        instrument.base_currency.toUpperCase() === query.baseAsset &&
        instrument.quote_currency.toUpperCase() === query.quoteAsset &&
        instrument.is_active !== false,
    );
    const selected =
      query.marketType === "perpetual"
        ? matches.find(
            (instrument) =>
              instrument.settlement_period === "perpetual" ||
              instrument.instrument_name.endsWith("PERPETUAL"),
          )
        : query.marketType === "future"
          ? matches
              .filter((instrument) => instrument.settlement_period !== "perpetual")
              .sort(
                (left, right) =>
                  (left.expiration_timestamp ?? Number.MAX_SAFE_INTEGER) -
                  (right.expiration_timestamp ?? Number.MAX_SAFE_INTEGER),
              )[0]
          : matches[0];
    if (!selected) {
      throw new CryptoProviderError(
        "NO_DATA",
        `Deribit has no active ${query.marketType} instrument for ${query.symbol}.`,
      );
    }
    return selected;
  }

  private getInstruments(currency: string, kind: string): Promise<DeribitInstrument[]> {
    const key = `${currency}:${kind}`;
    const cached = this.instrumentCache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.promise;
    const promise = this.get<DeribitInstrument[]>("public/get_instruments", {
      currency,
      kind,
      expired: "false",
    });
    this.instrumentCache.set(key, { expiresAt: this.now() + INSTRUMENT_CACHE_MS, promise });
    promise.catch(() => this.instrumentCache.delete(key));
    return promise;
  }

  private getTicker(instrumentName: string): Promise<DeribitTicker> {
    const pending = this.tickerPromises.get(instrumentName);
    if (pending) return pending;
    const promise = this.get<DeribitTicker>("public/ticker", {
      instrument_name: instrumentName,
    });
    this.tickerPromises.set(instrumentName, promise);
    void promise.then(
      () => this.tickerPromises.delete(instrumentName),
      () => this.tickerPromises.delete(instrumentName),
    );
    return promise;
  }

  private async get<T>(
    method: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = setQuery(new URL(`/api/v2/${method}`, this.baseUrl), params);
    const response = await requestJson<DeribitResponse<T>>(this.fetchImpl, url);
    if (response.error?.code === 10028) {
      throw new CryptoProviderError("RATE_LIMITED", "Deribit rate limit exceeded.");
    }
    if (response.error || response.result === undefined) {
      throw new CryptoProviderError(
        "UPSTREAM_ERROR",
        `Deribit returned ${response.error?.code ?? "invalid response"}: ${response.error?.message ?? "missing result"}`,
      );
    }
    return response.result;
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
