import { CryptoProviderError } from "../errors.js";
import type { CryptoOptionsProvider } from "../provider.js";
import type {
  CryptoInterval,
  CryptoOptionDataType,
  CryptoOptionRecord,
  CryptoOptionsDataQuery,
  CryptoOptionsDataResult,
  CryptoProviderSection,
} from "../types.js";
import { createCryptoFetch, requestJson, setQuery, type CryptoFetch } from "./http.js";

const DEFAULT_BASE_URL = "https://www.deribit.com";
const CACHE_MS = 60_000;

const VOLATILITY_RESOLUTIONS: Partial<Record<CryptoInterval, string>> = {
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

interface DeribitOptionsProviderOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  baseUrl?: string;
  now?: () => number;
}

interface DeribitResponse<T> {
  jsonrpc: string;
  result?: T;
  error?: { code: number; message: string };
}

interface DeribitOptionInstrument {
  instrument_name: string;
  base_currency: string;
  quote_currency: string;
  counter_currency?: string;
  settlement_currency?: string;
  expiration_timestamp: number;
  strike: number;
  option_type: "call" | "put";
  is_active?: boolean;
  contract_size?: number;
  tick_size?: number;
  min_trade_amount?: number;
}

interface DeribitOptionTicker {
  timestamp?: number;
  last_price?: number;
  mark_price?: number;
  best_bid_price?: number;
  best_ask_price?: number;
  underlying_price?: number;
  open_interest?: number;
  mark_iv?: number;
  bid_iv?: number;
  ask_iv?: number;
  greeks?: { delta?: number; gamma?: number; vega?: number; theta?: number; rho?: number };
  stats?: { volume?: number };
}

interface DeribitOptionSummary {
  instrument_name: string;
  mark_iv?: number;
  underlying_price?: number;
  open_interest?: number;
  volume?: number;
}

type OptionSection = CryptoProviderSection<CryptoOptionDataType, CryptoOptionRecord>;

export class DeribitCryptoOptionsProvider implements CryptoOptionsProvider {
  readonly id = "deribit";
  private readonly fetchImpl: CryptoFetch;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly instrumentsCache = new Map<
    string,
    { expiresAt: number; promise: Promise<DeribitOptionInstrument[]> }
  >();
  private readonly summariesCache = new Map<
    string,
    { expiresAt: number; promise: Promise<DeribitOptionSummary[]> }
  >();
  private readonly tickerPromises = new Map<string, Promise<DeribitOptionTicker>>();

  constructor(options: DeribitOptionsProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.now = options.now ?? Date.now;
  }

  async getOptionsData(query: CryptoOptionsDataQuery): Promise<CryptoOptionsDataResult> {
    const settled = await Promise.allSettled(
      query.dataTypes.map((dataType) => this.getSection(query, dataType)),
    );
    if (query.dataTypes.length === 1 && settled[0].status === "rejected") {
      throw settled[0].reason;
    }
    const sections = settled.map(
      (outcome, index): OptionSection =>
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

  private getSection(
    query: CryptoOptionsDataQuery,
    dataType: CryptoOptionDataType,
  ): Promise<OptionSection> {
    switch (dataType) {
      case "chain":
        return this.getChain(query);
      case "ticker":
        return this.getTickerSection(query);
      case "orderbook":
        return this.getOrderbook(query);
      case "trades":
        return this.getTrades(query);
      case "greeks":
        return this.getGreeks(query);
      case "implied_volatility":
        return this.getImpliedVolatility(query);
      case "volatility_index":
        return this.getVolatilityIndex(query);
      case "expiry_structure":
        return this.getExpiryStructure(query);
    }
  }

  private async getChain(query: CryptoOptionsDataQuery): Promise<OptionSection> {
    const instruments = await this.filterInstruments(query);
    return {
      dataType: "chain",
      status: "complete",
      records: instruments.slice(0, query.limit ?? 500).map((instrument) => ({
        ...this.contractIdentity(query, instrument, this.now()),
        dataType: "chain",
        status: instrument.is_active === false ? "inactive" : "active",
        settlementCurrency: instrument.settlement_currency,
        contractSize: instrument.contract_size,
        tickSize: instrument.tick_size,
        minimumTradeAmount: instrument.min_trade_amount,
      })),
    };
  }

  private async getTickerSection(query: CryptoOptionsDataQuery): Promise<OptionSection> {
    const instrument = await this.resolveExactInstrument(query);
    const ticker = await this.getTicker(instrument.instrument_name);
    return {
      dataType: "ticker",
      status: "complete",
      records: [
        {
          ...this.contractIdentity(query, instrument, ticker.timestamp ?? this.now()),
          dataType: "ticker",
          lastPrice: ticker.last_price,
          markPrice: ticker.mark_price,
          bidPrice: ticker.best_bid_price,
          askPrice: ticker.best_ask_price,
          underlyingPrice: ticker.underlying_price,
          openInterest: ticker.open_interest,
          volume24h: ticker.stats?.volume,
          priceUnit: instrument.settlement_currency ?? query.baseAsset,
          quantityUnit: "contracts",
        },
      ],
    };
  }

  private async getOrderbook(query: CryptoOptionsDataQuery): Promise<OptionSection> {
    const instrument = await this.resolveExactInstrument(query);
    const book = await this.get<{ timestamp?: number; bids?: unknown[][]; asks?: unknown[][] }>(
      "public/get_order_book",
      {
        instrument_name: instrument.instrument_name,
        depth: Math.min(query.depth ?? query.limit ?? 20, 10_000),
      },
    );
    const records: CryptoOptionRecord[] = [];
    for (const [side, levels] of [
      ["bid", book.bids ?? []],
      ["ask", book.asks ?? []],
    ] as const) {
      levels.forEach((level, index) => {
        records.push({
          ...this.contractIdentity(query, instrument, book.timestamp ?? this.now()),
          dataType: "orderbook",
          side,
          level: index + 1,
          price: Number(level[0]),
          priceUnit: instrument.settlement_currency ?? query.baseAsset,
          quantity: Number(level[1]),
          quantityUnit: "contracts",
        });
      });
    }
    return { dataType: "orderbook", status: "complete", records };
  }

  private async getTrades(query: CryptoOptionsDataQuery): Promise<OptionSection> {
    const instrument = await this.resolveExactInstrument(query);
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
        ...this.contractIdentity(query, instrument, Number(trade.timestamp)),
        dataType: "trades",
        tradeId: String(trade.trade_id),
        side: trade.direction === "buy" ? "buy" : "sell",
        price: Number(trade.price),
        priceUnit: instrument.settlement_currency ?? query.baseAsset,
        quantity: Number(trade.amount),
        quantityUnit: "contracts",
        impliedVolatility:
          trade.iv === undefined ? undefined : this.percentageToDecimal(Number(trade.iv)),
        impliedVolatilityUnit: "decimal",
      })),
    };
  }

  private async getGreeks(query: CryptoOptionsDataQuery): Promise<OptionSection> {
    const instrument = await this.resolveExactInstrument(query);
    const ticker = await this.getTicker(instrument.instrument_name);
    return {
      dataType: "greeks",
      status: "complete",
      records: [
        {
          ...this.contractIdentity(query, instrument, ticker.timestamp ?? this.now()),
          dataType: "greeks",
          ...ticker.greeks,
          methodology: "reported",
        },
      ],
    };
  }

  private async getImpliedVolatility(query: CryptoOptionsDataQuery): Promise<OptionSection> {
    if (query.expiry && query.strike && query.optionType) {
      const instrument = await this.resolveExactInstrument(query);
      const ticker = await this.getTicker(instrument.instrument_name);
      return {
        dataType: "implied_volatility",
        status: "complete",
        records: [this.impliedVolatilityRecord(query, instrument, ticker, "reported")],
      };
    }

    const [instruments, summaries] = await Promise.all([
      this.filterInstruments(query),
      this.getSummaries(query.baseAsset),
    ]);
    const instrumentByName = new Map(
      instruments.map((instrument) => [instrument.instrument_name, instrument]),
    );
    const atmByExpiryAndType = new Map<
      string,
      { instrument: DeribitOptionInstrument; summary: DeribitOptionSummary; distance: number }
    >();
    for (const summary of summaries) {
      const instrument = instrumentByName.get(summary.instrument_name);
      if (!instrument || summary.mark_iv === undefined || summary.underlying_price === undefined)
        continue;
      const expiry = new Date(instrument.expiration_timestamp).toISOString();
      const key = `${expiry}:${instrument.option_type}`;
      const distance = Math.abs(instrument.strike - summary.underlying_price);
      const current = atmByExpiryAndType.get(key);
      if (!current || distance < current.distance) {
        atmByExpiryAndType.set(key, { instrument, summary, distance });
      }
    }
    return {
      dataType: "implied_volatility",
      status: "complete",
      records: [...atmByExpiryAndType.values()]
        .sort(
          (left, right) =>
            left.instrument.expiration_timestamp - right.instrument.expiration_timestamp ||
            left.instrument.option_type.localeCompare(right.instrument.option_type),
        )
        .slice(0, query.limit ?? 100)
        .map(({ instrument, summary }) => ({
          ...this.contractIdentity(query, instrument, this.now()),
          dataType: "implied_volatility" as const,
          markIv: this.percentageToDecimal(summary.mark_iv!),
          unit: "decimal" as const,
          methodology: "reported" as const,
        })),
    };
  }

  private async getVolatilityIndex(query: CryptoOptionsDataQuery): Promise<OptionSection> {
    const interval = query.interval ?? "1d";
    const resolution = VOLATILITY_RESOLUTIONS[interval];
    if (!resolution) {
      throw new CryptoProviderError(
        "INVALID_ARGUMENT",
        `Deribit volatility index does not support interval ${interval}.`,
      );
    }
    const end = query.endTime ? new Date(query.endTime).getTime() : this.now();
    const start = query.startTime
      ? new Date(query.startTime).getTime()
      : end - (query.limit ?? 100) * INTERVAL_MILLISECONDS[interval];
    const result = await this.get<{ data?: number[][] }>("public/get_volatility_index_data", {
      currency: query.baseAsset,
      start_timestamp: start,
      end_timestamp: end,
      resolution,
    });
    return {
      dataType: "volatility_index",
      status: "complete",
      records: (result.data ?? []).map((row) => ({
        ...this.identity(query, Number(row[0])),
        dataType: "volatility_index",
        indexName: `${query.baseAsset}-DVOL`,
        interval,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        unit: "index_points",
      })),
    };
  }

  private async getExpiryStructure(query: CryptoOptionsDataQuery): Promise<OptionSection> {
    const [instruments, summaries] = await Promise.all([
      this.filterInstruments(query),
      this.getSummaries(query.baseAsset),
    ]);
    const instrumentByName = new Map(
      instruments.map((instrument) => [instrument.instrument_name, instrument]),
    );
    const groups = new Map<
      string,
      {
        expiryMs: number;
        callOpenInterest: number;
        putOpenInterest: number;
        callVolume24h: number;
        putVolume24h: number;
      }
    >();
    for (const summary of summaries) {
      const instrument = instrumentByName.get(summary.instrument_name);
      if (!instrument) continue;
      const expiry = new Date(instrument.expiration_timestamp).toISOString();
      const group = groups.get(expiry) ?? {
        expiryMs: instrument.expiration_timestamp,
        callOpenInterest: 0,
        putOpenInterest: 0,
        callVolume24h: 0,
        putVolume24h: 0,
      };
      if (instrument.option_type === "call") {
        group.callOpenInterest += Number(summary.open_interest ?? 0);
        group.callVolume24h += Number(summary.volume ?? 0);
      } else {
        group.putOpenInterest += Number(summary.open_interest ?? 0);
        group.putVolume24h += Number(summary.volume ?? 0);
      }
      groups.set(expiry, group);
    }
    return {
      dataType: "expiry_structure",
      status: "complete",
      records: [...groups.entries()]
        .sort(([, left], [, right]) => left.expiryMs - right.expiryMs)
        .map(([expiry, group]) => ({
          ...this.identity(query, this.now()),
          dataType: "expiry_structure",
          expiry,
          daysToExpiry: Math.max(0, (group.expiryMs - this.now()) / 86_400_000),
          callOpenInterest: group.callOpenInterest,
          putOpenInterest: group.putOpenInterest,
          callVolume24h: group.callVolume24h,
          putVolume24h: group.putVolume24h,
          totalOpenInterest: group.callOpenInterest + group.putOpenInterest,
          openInterestUnit: "contracts",
          volumeUnit: "contracts",
        })),
    };
  }

  private impliedVolatilityRecord(
    query: CryptoOptionsDataQuery,
    instrument: DeribitOptionInstrument,
    ticker: DeribitOptionTicker,
    methodology: "reported" | "derived",
  ): CryptoOptionRecord {
    return {
      ...this.contractIdentity(query, instrument, ticker.timestamp ?? this.now()),
      dataType: "implied_volatility",
      markIv: this.optionalPercentage(ticker.mark_iv),
      bidIv: this.optionalPercentage(ticker.bid_iv),
      askIv: this.optionalPercentage(ticker.ask_iv),
      unit: "decimal",
      methodology,
    };
  }

  private async resolveExactInstrument(
    query: CryptoOptionsDataQuery,
  ): Promise<DeribitOptionInstrument> {
    const matches = await this.filterInstruments(query);
    const instrument = matches.find(
      (item) => item.strike === query.strike && item.option_type === query.optionType,
    );
    if (!instrument) {
      throw new CryptoProviderError(
        "NO_DATA",
        `Deribit has no matching option for ${query.symbol} ${query.expiry} ${query.strike} ${query.optionType}.`,
      );
    }
    return instrument;
  }

  private async filterInstruments(
    query: CryptoOptionsDataQuery,
  ): Promise<DeribitOptionInstrument[]> {
    const instruments = await this.getInstruments(query.baseAsset);
    const expiryDate = query.expiry?.slice(0, 10);
    return instruments.filter((instrument) => {
      if (instrument.base_currency.toUpperCase() !== query.baseAsset) return false;
      const counterCurrency = instrument.counter_currency ?? instrument.quote_currency;
      if (counterCurrency.toUpperCase() !== query.quoteAsset) return false;
      if (instrument.is_active === false) return false;
      if (
        expiryDate &&
        new Date(instrument.expiration_timestamp).toISOString().slice(0, 10) !== expiryDate
      )
        return false;
      if (query.strike !== undefined && instrument.strike !== query.strike) return false;
      if (query.optionType && instrument.option_type !== query.optionType) return false;
      return true;
    });
  }

  private getInstruments(currency: string): Promise<DeribitOptionInstrument[]> {
    const cached = this.instrumentsCache.get(currency);
    if (cached && cached.expiresAt > this.now()) return cached.promise;
    const promise = this.get<DeribitOptionInstrument[]>("public/get_instruments", {
      currency,
      kind: "option",
      expired: "false",
    });
    this.instrumentsCache.set(currency, { expiresAt: this.now() + CACHE_MS, promise });
    void promise.catch(() => {
      this.instrumentsCache.delete(currency);
    });
    return promise;
  }

  private getSummaries(currency: string): Promise<DeribitOptionSummary[]> {
    const cached = this.summariesCache.get(currency);
    if (cached && cached.expiresAt > this.now()) return cached.promise;
    const promise = this.get<DeribitOptionSummary[]>("public/get_book_summary_by_currency", {
      currency,
      kind: "option",
    });
    this.summariesCache.set(currency, { expiresAt: this.now() + CACHE_MS, promise });
    void promise.catch(() => {
      this.summariesCache.delete(currency);
    });
    return promise;
  }

  private getTicker(instrumentName: string): Promise<DeribitOptionTicker> {
    const pending = this.tickerPromises.get(instrumentName);
    if (pending) return pending;
    const promise = this.get<DeribitOptionTicker>("public/ticker", {
      instrument_name: instrumentName,
    });
    this.tickerPromises.set(instrumentName, promise);
    void promise.then(
      () => this.tickerPromises.delete(instrumentName),
      () => this.tickerPromises.delete(instrumentName),
    );
    return promise;
  }

  private identity(query: CryptoOptionsDataQuery, timestamp: number) {
    return {
      baseAsset: query.baseAsset,
      quoteAsset: query.quoteAsset,
      symbol: query.symbol,
      venue: "deribit",
      provider: this.id,
      timestamp: new Date(timestamp).toISOString(),
    };
  }

  private contractIdentity(
    query: CryptoOptionsDataQuery,
    instrument: DeribitOptionInstrument,
    timestamp: number,
  ) {
    return {
      ...this.identity(query, timestamp),
      instrumentName: instrument.instrument_name,
      expiry: new Date(instrument.expiration_timestamp).toISOString(),
      strike: instrument.strike,
      optionType: instrument.option_type,
    };
  }

  private optionalPercentage(value: number | undefined): number | undefined {
    return value === undefined ? undefined : this.percentageToDecimal(value);
  }

  private percentageToDecimal(value: number): number {
    return value / 100;
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
}
