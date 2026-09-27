import {
  createCryptoFetch,
  requestJson,
  setQuery,
  type CryptoFetch,
} from "../../crypto/providers/http.js";
import { TradfiPerpetualProviderError, toTradfiPerpetualProviderError } from "../errors.js";
import type { TradfiPerpetualProvider } from "../provider.js";
import type {
  TradfiPerpetualDataType,
  TradfiPerpetualQuery,
  TradfiPerpetualRecord,
  TradfiPerpetualResult,
  TradfiPerpetualSection,
  TradfiPerpetualUnderlyingType,
} from "../types.js";
import { resolveBinanceInstrument } from "./binance-instrument-resolver.js";
import {
  asRecord,
  coverageFrom,
  coverageIssues,
  decimalPercent,
  isEligibleUnderlyingType,
  iso,
  marketIdentityForUnderlyingType,
  numeric,
  optionalIso,
  stringArray,
  type BinanceInstrument,
  type TimedRecord,
  type TimeWindow,
} from "./binance-utils.js";

const DEFAULT_FUTURES_URL = "https://fapi.binance.com";
const EXCHANGE_INFO_TTL_MS = 60_000;
const STATISTICS_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1_000;

interface BinanceTradfiProviderOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  futuresBaseUrl?: string;
  now?: () => number;
  exchangeInfoTtlMs?: number;
}

interface BinanceExchangeInfo {
  symbols?: BinanceInstrument[];
}

export class BinanceTradfiPerpetualProvider implements TradfiPerpetualProvider {
  readonly id = "binance";
  private readonly fetchImpl: CryptoFetch;
  private readonly futuresBaseUrl: string;
  private readonly now: () => number;
  private readonly exchangeInfoTtlMs: number;
  private exchangeInfoCache?: { expiresAt: number; symbols: BinanceInstrument[] };

  constructor(options: BinanceTradfiProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.futuresBaseUrl = options.futuresBaseUrl ?? DEFAULT_FUTURES_URL;
    this.now = options.now ?? Date.now;
    this.exchangeInfoTtlMs = options.exchangeInfoTtlMs ?? EXCHANGE_INFO_TTL_MS;
  }

  async getData(query: TradfiPerpetualQuery): Promise<TradfiPerpetualResult> {
    const symbols = await this.getExchangeInfo();
    if (query.action === "instruments") {
      const section = this.getInstrumentsSection(query, symbols);
      return { status: section.status, sections: [section] };
    }

    const instrument = resolveBinanceInstrument(query, symbols);
    const settled = await Promise.allSettled(
      query.dataTypes.map((dataType) => this.getSection(query, instrument, dataType)),
    );
    if (query.dataTypes.length === 1 && settled[0].status === "rejected") {
      throw settled[0].reason;
    }

    const sections = settled.map((outcome, index): TradfiPerpetualSection => {
      if (outcome.status === "fulfilled") return outcome.value;
      const error = toTradfiPerpetualProviderError(outcome.reason);
      return {
        dataType: query.dataTypes[index],
        status: "partial",
        records: [],
        issues: [{ code: "PARTIAL_DATA", message: `${error.code}: ${error.message}` }],
      };
    });
    return {
      status: sections.some((section) => section.status === "partial") ? "partial" : "complete",
      sections,
    };
  }

  private async getExchangeInfo(): Promise<BinanceInstrument[]> {
    if (this.exchangeInfoCache && this.exchangeInfoCache.expiresAt > this.now()) {
      return this.exchangeInfoCache.symbols;
    }
    const url = new URL("/fapi/v1/exchangeInfo", this.futuresBaseUrl);
    const raw = await requestJson<BinanceExchangeInfo>(this.fetchImpl, url);
    const symbols = raw.symbols ?? [];
    this.exchangeInfoCache = { expiresAt: this.now() + this.exchangeInfoTtlMs, symbols };
    return symbols;
  }

  private getInstrumentsSection(
    query: TradfiPerpetualQuery,
    symbols: BinanceInstrument[],
  ): TradfiPerpetualSection {
    const eligible = this.eligibleInstruments(symbols);
    const selected = query.symbol
      ? [resolveBinanceInstrument(query, symbols)]
      : eligible
          .sort((left, right) =>
            `${left.underlyingType}:${left.baseAsset}`.localeCompare(
              `${right.underlyingType}:${right.baseAsset}`,
            ),
          )
          .slice(0, query.limit);
    const timestamp = iso(this.now());
    return {
      dataType: "instruments",
      status: "complete",
      records: selected.map((instrument) => ({
        ...this.identity(instrument, "instruments", timestamp, "GET /fapi/v1/exchangeInfo"),
        pricePrecision: instrument.pricePrecision,
        quantityPrecision: instrument.quantityPrecision,
        orderTypes: instrument.orderTypes,
        timeInForce: instrument.timeInForce,
      })),
    };
  }

  private async getSection(
    query: TradfiPerpetualQuery,
    instrument: BinanceInstrument,
    dataType: TradfiPerpetualDataType,
  ): Promise<TradfiPerpetualSection> {
    switch (dataType) {
      case "instruments":
        throw new TradfiPerpetualProviderError(
          "INVALID_ARGUMENT",
          "instruments cannot be combined with symbol-specific actions.",
        );
      case "snapshot":
        return this.getSnapshot(instrument);
      case "trade_ohlcv":
      case "mark_ohlcv":
      case "index_ohlcv":
      case "premium_ohlcv":
        return this.getOhlcv(query, instrument, dataType);
      case "funding":
        return this.getFunding(query, instrument);
      case "open_interest":
        return this.getOpenInterest(query, instrument);
      case "global_long_short_ratio":
        return this.getRatio(query, instrument, dataType, "globalLongShortAccountRatio");
      case "top_account_long_short_ratio":
        return this.getRatio(query, instrument, dataType, "topLongShortAccountRatio");
      case "top_position_long_short_ratio":
        return this.getRatio(query, instrument, dataType, "topLongShortPositionRatio");
      case "taker_buy_sell_ratio":
        return this.getRatio(query, instrument, dataType, "takerlongshortRatio");
      case "orderbook":
        return this.getOrderbook(query, instrument);
      case "trades":
        return this.getTrades(query, instrument);
      case "trading_schedule":
        return this.getTradingSchedule(instrument);
      case "technical_indicators":
        throw new TradfiPerpetualProviderError(
          "INVALID_ARGUMENT",
          "technical_indicators is derived from trade_ohlcv and cannot be fetched directly.",
        );
    }
  }

  private async getSnapshot(instrument: BinanceInstrument): Promise<TradfiPerpetualSection> {
    const tickerUrl = setQuery(new URL("/fapi/v1/ticker/24hr", this.futuresBaseUrl), {
      symbol: instrument.symbol,
    });
    const premiumUrl = setQuery(new URL("/fapi/v1/premiumIndex", this.futuresBaseUrl), {
      symbol: instrument.symbol,
    });
    const bookUrl = setQuery(new URL("/fapi/v1/ticker/bookTicker", this.futuresBaseUrl), {
      symbol: instrument.symbol,
    });
    const [ticker, premium, book] = await Promise.all([
      requestJson<Record<string, unknown>>(this.fetchImpl, tickerUrl),
      requestJson<Record<string, unknown>>(this.fetchImpl, premiumUrl),
      requestJson<Record<string, unknown>>(this.fetchImpl, bookUrl),
    ]);
    const eventTime = numeric(ticker.closeTime) ?? numeric(premium.time) ?? this.now();
    return {
      dataType: "snapshot",
      status: "complete",
      records: [
        {
          ...this.identity(
            instrument,
            "snapshot",
            iso(eventTime),
            "GET /fapi/v1/ticker/24hr + /fapi/v1/premiumIndex + /fapi/v1/ticker/bookTicker",
          ),
          lastPrice: numeric(ticker.lastPrice),
          weightedAveragePrice: numeric(ticker.weightedAvgPrice),
          priceChange24h: numeric(ticker.priceChange),
          priceChangePercent24h: decimalPercent(ticker.priceChangePercent),
          volume24h: numeric(ticker.volume),
          quoteVolume24h: numeric(ticker.quoteVolume),
          markPrice: numeric(premium.markPrice),
          indexPrice: numeric(premium.indexPrice),
          estimatedSettlePrice: numeric(premium.estimatedSettlePrice),
          lastFundingRate: numeric(premium.lastFundingRate),
          interestRate: numeric(premium.interestRate),
          nextFundingTime: optionalIso(premium.nextFundingTime),
          bestBidPrice: numeric(book.bidPrice),
          bestBidQuantity: numeric(book.bidQty),
          bestAskPrice: numeric(book.askPrice),
          bestAskQuantity: numeric(book.askQty),
        },
      ],
    };
  }

  private async getOhlcv(
    query: TradfiPerpetualQuery,
    instrument: BinanceInstrument,
    dataType: "trade_ohlcv" | "mark_ohlcv" | "index_ohlcv" | "premium_ohlcv",
  ): Promise<TradfiPerpetualSection> {
    const endpoint = {
      trade_ohlcv: "/fapi/v1/klines",
      mark_ohlcv: "/fapi/v1/markPriceKlines",
      index_ohlcv: "/fapi/v1/indexPriceKlines",
      premium_ohlcv: "/fapi/v1/premiumIndexKlines",
    }[dataType];
    const window = this.resolveWindow(query, instrument);
    if (window.empty) return this.emptyCoverageSection(dataType, window);
    const url = setQuery(new URL(endpoint, this.futuresBaseUrl), {
      [dataType === "index_ohlcv" ? "pair" : "symbol"]: instrument.symbol,
      interval: query.interval,
      startTime: window.effectiveStart,
      endTime: window.effectiveEnd,
      limit: Math.min(query.limit, 1_500),
    });
    const raw = await requestJson<unknown[][]>(this.fetchImpl, url);
    const records = raw
      .filter((row) => row.length >= 7)
      .map((row): TimedRecord => {
        const eventTime = numeric(row[0]) ?? this.now();
        return {
          ...this.identity(instrument, dataType, iso(eventTime), `GET ${endpoint}`),
          eventTime,
          priceSeries: dataType.replace("_ohlcv", ""),
          interval: query.interval,
          openTime: iso(eventTime),
          closeTime: optionalIso(row[6]),
          isClosed: (numeric(row[6]) ?? Number.POSITIVE_INFINITY) <= this.now(),
          open: numeric(row[1]),
          high: numeric(row[2]),
          low: numeric(row[3]),
          close: numeric(row[4]),
          volume: dataType === "trade_ohlcv" ? numeric(row[5]) : undefined,
          quoteVolume: dataType === "trade_ohlcv" ? numeric(row[7]) : undefined,
        };
      });
    return this.coveredSection(dataType, records, window);
  }

  private async getFunding(
    query: TradfiPerpetualQuery,
    instrument: BinanceInstrument,
  ): Promise<TradfiPerpetualSection> {
    const window = this.resolveWindow(query, instrument);
    if (window.empty) return this.emptyCoverageSection("funding", window);
    const endpoint = "/fapi/v1/fundingRate";
    const url = setQuery(new URL(endpoint, this.futuresBaseUrl), {
      symbol: instrument.symbol,
      startTime: window.effectiveStart,
      endTime: window.effectiveEnd,
      limit: Math.min(query.limit, 1_000),
    });
    const raw = await requestJson<Array<Record<string, unknown>>>(this.fetchImpl, url);
    const records = raw.map((item): TimedRecord => {
      const eventTime = numeric(item.fundingTime) ?? this.now();
      return {
        ...this.identity(instrument, "funding", iso(eventTime), `GET ${endpoint}`),
        eventTime,
        fundingRate: numeric(item.fundingRate),
        markPrice: numeric(item.markPrice),
        unit: "decimal",
        methodology: "reported",
      };
    });
    return this.coveredSection("funding", records, window);
  }

  private async getOpenInterest(
    query: TradfiPerpetualQuery,
    instrument: BinanceInstrument,
  ): Promise<TradfiPerpetualSection> {
    if (!query.startTime || !query.endTime) {
      const endpoint = "/fapi/v1/openInterest";
      const url = setQuery(new URL(endpoint, this.futuresBaseUrl), { symbol: instrument.symbol });
      const raw = await requestJson<Record<string, unknown>>(this.fetchImpl, url);
      const eventTime = numeric(raw.time) ?? this.now();
      return {
        dataType: "open_interest",
        status: "complete",
        records: [
          {
            ...this.identity(instrument, "open_interest", iso(eventTime), `GET ${endpoint}`),
            openInterest: numeric(raw.openInterest),
            unit: "contracts",
            methodology: "reported",
          },
        ],
      };
    }

    const endpoint = "/futures/data/openInterestHist";
    const window = this.resolveWindow(query, instrument, this.now() - STATISTICS_LOOKBACK_MS);
    if (window.empty) return this.emptyCoverageSection("open_interest", window);
    const url = setQuery(new URL(endpoint, this.futuresBaseUrl), {
      symbol: instrument.symbol,
      period: query.interval,
      startTime: window.effectiveStart,
      endTime: window.effectiveEnd,
      limit: Math.min(query.limit, 500),
    });
    const raw = await requestJson<Array<Record<string, unknown>>>(this.fetchImpl, url);
    const records = raw.map((item): TimedRecord => {
      const eventTime = numeric(item.timestamp) ?? this.now();
      return {
        ...this.identity(instrument, "open_interest", iso(eventTime), `GET ${endpoint}`),
        eventTime,
        interval: query.interval,
        openInterest: numeric(item.sumOpenInterest),
        openInterestValue: numeric(item.sumOpenInterestValue),
        unit: "contracts",
        valueUnit: "USDT",
        methodology: "reported",
      };
    });
    return this.coveredSection("open_interest", records, window);
  }

  private async getRatio(
    query: TradfiPerpetualQuery,
    instrument: BinanceInstrument,
    dataType:
      | "global_long_short_ratio"
      | "top_account_long_short_ratio"
      | "top_position_long_short_ratio"
      | "taker_buy_sell_ratio",
    endpointName: string,
  ): Promise<TradfiPerpetualSection> {
    const endpoint = `/futures/data/${endpointName}`;
    const window = this.resolveWindow(query, instrument, this.now() - STATISTICS_LOOKBACK_MS);
    if (window.empty) return this.emptyCoverageSection(dataType, window);
    const url = setQuery(new URL(endpoint, this.futuresBaseUrl), {
      symbol: instrument.symbol,
      period: query.interval,
      startTime: window.effectiveStart,
      endTime: window.effectiveEnd,
      limit: Math.min(query.limit, 500),
    });
    const raw = await requestJson<Array<Record<string, unknown>>>(this.fetchImpl, url);
    const records = raw.map((item): TimedRecord => {
      const eventTime = numeric(item.timestamp) ?? this.now();
      return {
        ...this.identity(instrument, dataType, iso(eventTime), `GET ${endpoint}`),
        eventTime,
        interval: query.interval,
        ratio: numeric(item.longShortRatio ?? item.buySellRatio),
        longAccount: numeric(item.longAccount),
        shortAccount: numeric(item.shortAccount),
        longPosition: numeric(item.longPosition),
        shortPosition: numeric(item.shortPosition),
        buyVolume: numeric(item.buyVol),
        sellVolume: numeric(item.sellVol),
        unit: "ratio",
        methodology: "reported",
      };
    });
    return this.coveredSection(dataType, records, window);
  }

  private async getOrderbook(
    query: TradfiPerpetualQuery,
    instrument: BinanceInstrument,
  ): Promise<TradfiPerpetualSection> {
    const endpoint = "/fapi/v1/depth";
    const url = setQuery(new URL(endpoint, this.futuresBaseUrl), {
      symbol: instrument.symbol,
      limit: query.depth,
    });
    const raw = await requestJson<{ bids?: unknown[][]; asks?: unknown[][] }>(this.fetchImpl, url);
    const timestamp = iso(this.now());
    const records: TradfiPerpetualRecord[] = [];
    for (const [side, levels] of [
      ["bid", raw.bids ?? []],
      ["ask", raw.asks ?? []],
    ] as const) {
      levels.forEach((level, index) => {
        records.push({
          ...this.identity(instrument, "orderbook", timestamp, `GET ${endpoint}`),
          side,
          level: index + 1,
          price: numeric(level[0]),
          quantity: numeric(level[1]),
        });
      });
    }
    return { dataType: "orderbook", status: "complete", records };
  }

  private async getTrades(
    query: TradfiPerpetualQuery,
    instrument: BinanceInstrument,
  ): Promise<TradfiPerpetualSection> {
    const endpoint = "/fapi/v1/trades";
    const url = setQuery(new URL(endpoint, this.futuresBaseUrl), {
      symbol: instrument.symbol,
      limit: Math.min(query.limit, 1_000),
    });
    const raw = await requestJson<Array<Record<string, unknown>>>(this.fetchImpl, url);
    return {
      dataType: "trades",
      status: "complete",
      records: raw.map((item) => {
        const eventTime = numeric(item.time) ?? this.now();
        return {
          ...this.identity(instrument, "trades", iso(eventTime), `GET ${endpoint}`),
          tradeId: String(item.id ?? ""),
          side: item.isBuyerMaker ? "sell" : "buy",
          price: numeric(item.price),
          quantity: numeric(item.qty),
          quoteQuantity: numeric(item.quoteQty),
          isRpiTrade: Boolean(item.isRPITrade),
        };
      }),
    };
  }

  private async getTradingSchedule(instrument: BinanceInstrument): Promise<TradfiPerpetualSection> {
    const endpoint = "/fapi/v1/tradingSchedule";
    const raw = await requestJson<Record<string, unknown>>(
      this.fetchImpl,
      new URL(endpoint, this.futuresBaseUrl),
    );
    const marketSchedules = asRecord(raw.marketSchedules);
    const marketSchedule = marketSchedules?.[instrument.underlyingType];
    const groups = Array.isArray(marketSchedule)
      ? marketSchedule
      : marketSchedule
        ? [marketSchedule]
        : [];
    const sessions = groups
      .flatMap((group) => {
        const sessionsValue = asRecord(group)?.sessions;
        return Array.isArray(sessionsValue) ? sessionsValue : [];
      })
      .map((session) => asRecord(session))
      .filter((session): session is Record<string, unknown> => Boolean(session))
      .sort((left, right) => (numeric(left.startTime) ?? 0) - (numeric(right.startTime) ?? 0));
    const now = this.now();
    const firstRelevant = Math.max(
      0,
      sessions.findIndex((session) => (numeric(session.endTime) ?? 0) > now),
    );
    const selected = sessions.slice(firstRelevant, firstRelevant + 3);
    return {
      dataType: "trading_schedule",
      status: "complete",
      records: selected.map((session) => {
        const startTime = numeric(session.startTime) ?? now;
        const endTime = numeric(session.endTime) ?? startTime;
        return {
          ...this.identity(instrument, "trading_schedule", iso(startTime), `GET ${endpoint}`),
          sessionType: String(session.type ?? "UNKNOWN"),
          sessionStartTime: iso(startTime),
          sessionEndTime: iso(endTime),
          isCurrent: startTime <= now && now < endTime,
          scheduleUpdatedAt: optionalIso(raw.updateTime),
        };
      }),
    };
  }

  private eligibleInstruments(symbols: BinanceInstrument[]): BinanceInstrument[] {
    return symbols.filter(
      (instrument) =>
        instrument.contractType === "TRADIFI_PERPETUAL" &&
        isEligibleUnderlyingType(instrument.underlyingType) &&
        instrument.quoteAsset === "USDT",
    );
  }

  private identity(
    instrument: BinanceInstrument,
    dataType: TradfiPerpetualDataType,
    timestamp: string,
    sourceEndpoint: string,
  ): TradfiPerpetualRecord {
    const underlyingType = instrument.underlyingType as TradfiPerpetualUnderlyingType;
    const marketIdentity = marketIdentityForUnderlyingType(underlyingType);
    return {
      dataType,
      instrumentClass: marketIdentity.instrumentClass,
      venue: "binance",
      venueSymbol: instrument.symbol,
      underlyingSymbol: instrument.baseAsset,
      underlyingMarket: marketIdentity.underlyingMarket,
      underlyingType,
      underlyingSubTypes: stringArray(instrument.underlyingSubType),
      quoteAsset: instrument.quoteAsset,
      settlementAsset: instrument.marginAsset,
      contractType: "TRADIFI_PERPETUAL",
      tradingStatus: instrument.status,
      onboardDate: iso(instrument.onboardDate),
      isCashEquity: false,
      provider: this.id,
      sourceEndpoint,
      timestamp,
    };
  }

  private resolveWindow(
    query: TradfiPerpetualQuery,
    instrument: BinanceInstrument,
    endpointFloor?: number,
  ): TimeWindow {
    if (!query.startTime || !query.endTime) {
      return { reasons: [], empty: false };
    }
    const requestedStart = Date.parse(query.startTime);
    const requestedEnd = Date.parse(query.endTime);
    const now = this.now();
    const floor = Math.max(instrument.onboardDate, endpointFloor ?? instrument.onboardDate);
    const reasons: string[] = [];
    if (requestedStart < instrument.onboardDate) {
      reasons.push(`Contract onboarded at ${iso(instrument.onboardDate)}.`);
    }
    if (endpointFloor && requestedStart < endpointFloor) {
      reasons.push("Binance exposes only the latest 30 days for this statistics endpoint.");
    }
    if (requestedEnd > now) reasons.push(`Requested end is later than fetched_at ${iso(now)}.`);
    const effectiveStart = Math.max(requestedStart, floor);
    const effectiveEnd = Math.min(requestedEnd, now);
    return {
      requestedStart,
      requestedEnd,
      effectiveStart,
      effectiveEnd,
      reasons,
      empty: effectiveStart >= effectiveEnd,
    };
  }

  private coveredSection(
    dataType: TradfiPerpetualDataType,
    records: TimedRecord[],
    window: TimeWindow,
  ): TradfiPerpetualSection {
    const coverage = coverageFrom(window, records);
    const issues = coverageIssues(window);
    return {
      dataType,
      status: issues.length ? "partial" : "complete",
      records: records.map(({ eventTime: _eventTime, ...record }) => record),
      coverage,
      issues: issues.length ? issues : undefined,
    };
  }

  private emptyCoverageSection(
    dataType: TradfiPerpetualDataType,
    window: TimeWindow,
  ): TradfiPerpetualSection {
    const reason =
      window.reasons.join(" ") || "The requested range does not overlap available Binance data.";
    return {
      dataType,
      status: "partial",
      records: [],
      coverage: coverageFrom(window, []),
      issues: [{ code: "COVERAGE_LIMITED", message: reason }],
    };
  }
}

export function createDefaultTradfiPerpetualProvider(
  env: Record<string, string | undefined> = process.env,
): BinanceTradfiPerpetualProvider {
  const proxyUrl =
    env.TRADFI_DATA_PROXY ?? env.CRYPTO_PROXY ?? env.HTTPS_PROXY ?? env.HTTP_PROXY ?? env.ALL_PROXY;
  return new BinanceTradfiPerpetualProvider({ proxyUrl });
}
