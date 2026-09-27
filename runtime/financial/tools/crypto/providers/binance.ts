import type { CryptoProvider } from "../provider.js";
import type {
  CryptoDerivativeRecord,
  CryptoDerivativeSectionType,
  CryptoDerivativesDataQuery,
  CryptoDerivativesDataResult,
  CryptoMarketDataQuery,
  CryptoMarketDataRecord,
  CryptoMarketDataResult,
  CryptoMarketDataType,
  CryptoProviderSection,
} from "../types.js";
import { createCryptoFetch, requestJson, setQuery, type CryptoFetch } from "./http.js";

const DEFAULT_SPOT_URL = "https://api.binance.com";
const DEFAULT_FUTURES_URL = "https://fapi.binance.com";

interface BinanceOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  spotBaseUrl?: string;
  futuresBaseUrl?: string;
}

type MarketSection = CryptoProviderSection<CryptoMarketDataType, CryptoMarketDataRecord>;
type DerivativeSection = CryptoProviderSection<CryptoDerivativeSectionType, CryptoDerivativeRecord>;

export class BinanceCryptoProvider implements CryptoProvider {
  readonly id = "binance";
  private readonly fetchImpl: CryptoFetch;
  private readonly spotBaseUrl: string;
  private readonly futuresBaseUrl: string;

  constructor(options: BinanceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.spotBaseUrl = options.spotBaseUrl ?? DEFAULT_SPOT_URL;
    this.futuresBaseUrl = options.futuresBaseUrl ?? DEFAULT_FUTURES_URL;
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
    if (dataTypes.length === 1 && settled[0].status === "rejected") {
      throw settled[0].reason;
    }
    return settled.map((outcome, index) =>
      outcome.status === "fulfilled"
        ? outcome.value
        : {
            dataType: dataTypes[index],
            status: "partial",
            records: [],
            issues: [
              {
                code: "PARTIAL_DATA",
                message:
                  outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
              },
            ],
          },
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

  private async getMarketSection(
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

  private async getDerivativeSection(
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
        return this.getRatio(query, "globalLongShortAccountRatio", "long_short_ratio");
      case "taker_flow":
        return this.getRatio(query, "takerlongshortRatio", "taker_buy_sell_ratio");
      case "contract_metadata":
        return this.getContractMetadata(query);
      case "liquidations":
        return this.partialDerivativeSection(
          dataType,
          "Binance liquidation data requires the later WebSocket collector; no REST history is fabricated.",
        );
      case "insurance_risk":
        return this.partialDerivativeSection(
          dataType,
          "Binance insurance-risk coverage is not enabled in the first synchronous provider.",
        );
    }
  }

  private marketBase(query: CryptoMarketDataQuery): string {
    return query.marketType === "spot" ? this.spotBaseUrl : this.futuresBaseUrl;
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
      venue: "binance",
      provider: this.id,
      timestamp,
    };
  }

  private async getSnapshot(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const path = query.marketType === "spot" ? "/api/v3/ticker/24hr" : "/fapi/v1/ticker/24hr";
    const url = setQuery(new URL(path, this.marketBase(query)), {
      symbol: this.venueSymbol(query),
    });
    const raw = await requestJson<Record<string, string | number>>(this.fetchImpl, url);
    const timestamp = new Date(Number(raw.closeTime ?? Date.now())).toISOString();
    return {
      dataType: "snapshot",
      status: "complete",
      records: [
        {
          ...this.identity(query, timestamp),
          dataType: "snapshot",
          price: Number(raw.lastPrice),
          priceUnit: query.quoteAsset,
          volume24h: Number(raw.volume),
          volumeUnit: query.baseAsset,
          quoteVolume24h: Number(raw.quoteVolume),
          quoteVolumeUnit: query.quoteAsset,
          change24h: Number(raw.priceChangePercent) / 100,
          change24hUnit: "decimal",
        },
      ],
    };
  }

  private async getOhlcv(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const path = query.marketType === "spot" ? "/api/v3/klines" : "/fapi/v1/klines";
    const url = setQuery(new URL(path, this.marketBase(query)), {
      symbol: this.venueSymbol(query),
      interval: query.interval ?? "1h",
      startTime: query.startTime ? new Date(query.startTime).getTime() : undefined,
      endTime: query.endTime ? new Date(query.endTime).getTime() : undefined,
      limit: query.limit ?? 100,
    });
    const raw = await requestJson<unknown[][]>(this.fetchImpl, url);
    const interval = query.interval ?? "1h";
    return {
      dataType: "ohlcv",
      status: "complete",
      records: raw.map((row) => ({
        ...this.identity(query, new Date(Number(row[0])).toISOString()),
        dataType: "ohlcv",
        interval,
        openTime: new Date(Number(row[0])).toISOString(),
        closeTime: new Date(Number(row[6])).toISOString(),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        priceUnit: query.quoteAsset,
        volume: Number(row[5]),
        volumeUnit: query.baseAsset,
        quoteVolume: Number(row[7]),
        quoteVolumeUnit: query.quoteAsset,
      })),
    };
  }

  private async getTrades(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const path = query.marketType === "spot" ? "/api/v3/trades" : "/fapi/v1/trades";
    const url = setQuery(new URL(path, this.marketBase(query)), {
      symbol: this.venueSymbol(query),
      limit: Math.min(query.limit ?? 100, 1_000),
    });
    const raw = await requestJson<Array<Record<string, unknown>>>(this.fetchImpl, url);
    return {
      dataType: "trades",
      status: "complete",
      records: raw.map((trade) => ({
        ...this.identity(query, new Date(Number(trade.time)).toISOString()),
        dataType: "trades",
        tradeId: String(trade.id),
        price: Number(trade.price),
        priceUnit: query.quoteAsset,
        quantity: Number(trade.qty),
        quantityUnit: query.baseAsset,
        side: trade.isBuyerMaker ? "sell" : "buy",
      })),
    };
  }

  private async getOrderbook(query: CryptoMarketDataQuery): Promise<MarketSection> {
    const path = query.marketType === "spot" ? "/api/v3/depth" : "/fapi/v1/depth";
    const url = setQuery(new URL(path, this.marketBase(query)), {
      symbol: this.venueSymbol(query),
      limit: query.depth ?? Math.min(query.limit ?? 100, 1_000),
    });
    const raw = await requestJson<{ bids: unknown[][]; asks: unknown[][] }>(this.fetchImpl, url);
    const timestamp = new Date().toISOString();
    const records: CryptoMarketDataRecord[] = [];
    for (const [side, levels] of [
      ["bid", raw.bids],
      ["ask", raw.asks],
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
    const path = query.marketType === "spot" ? "/api/v3/exchangeInfo" : "/fapi/v1/exchangeInfo";
    const url = setQuery(new URL(path, this.marketBase(query)), {
      symbol: this.venueSymbol(query),
    });
    const raw = await requestJson<{ symbols?: Array<Record<string, unknown>> }>(
      this.fetchImpl,
      url,
    );
    const instrument = raw.symbols?.find((item) => item.symbol === this.venueSymbol(query));
    if (!instrument) return { dataType: "instruments", status: "complete", records: [] };
    return {
      dataType: "instruments",
      status: "complete",
      records: [
        {
          ...this.identity(query, new Date().toISOString()),
          dataType: "instruments",
          venueSymbol: String(instrument.symbol),
          status: String(instrument.status ?? "unknown"),
        },
      ],
    };
  }

  private async getFunding(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    const url = setQuery(new URL("/fapi/v1/fundingRate", this.futuresBaseUrl), {
      symbol: this.venueSymbol(query),
      startTime: query.startTime ? new Date(query.startTime).getTime() : undefined,
      endTime: query.endTime ? new Date(query.endTime).getTime() : undefined,
      limit: Math.min(query.limit ?? 100, 1_000),
    });
    const raw = await requestJson<Array<Record<string, unknown>>>(this.fetchImpl, url);
    return {
      dataType: "funding",
      status: "complete",
      records: raw.map((item) => ({
        ...this.identity(query, new Date(Number(item.fundingTime)).toISOString()),
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
    if (query.startTime && query.endTime) {
      const url = setQuery(new URL("/futures/data/openInterestHist", this.futuresBaseUrl), {
        symbol: this.venueSymbol(query),
        period: query.interval ?? "1h",
        startTime: new Date(query.startTime).getTime(),
        endTime: new Date(query.endTime).getTime(),
        limit: Math.min(query.limit ?? 100, 500),
      });
      const raw = await requestJson<Array<Record<string, unknown>>>(this.fetchImpl, url);
      return {
        dataType: "open_interest",
        status: "complete",
        records: raw.map((item) => ({
          ...this.identity(query, new Date(Number(item.timestamp)).toISOString()),
          dataType: "open_interest",
          marketType: query.marketType,
          metric: "open_interest",
          value: Number(item.sumOpenInterest),
          unit: "contracts",
          interval: query.interval,
          methodology: "reported",
        })),
      };
    }
    const url = setQuery(new URL("/fapi/v1/openInterest", this.futuresBaseUrl), {
      symbol: this.venueSymbol(query),
    });
    const raw = await requestJson<Record<string, unknown>>(this.fetchImpl, url);
    return {
      dataType: "open_interest",
      status: "complete",
      records: [
        {
          ...this.identity(query, new Date(Number(raw.time ?? Date.now())).toISOString()),
          dataType: "open_interest",
          marketType: query.marketType,
          metric: "open_interest",
          value: Number(raw.openInterest),
          unit: "contracts",
          methodology: "reported",
        },
      ],
    };
  }

  private async getBasis(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    const url = setQuery(new URL("/fapi/v1/premiumIndex", this.futuresBaseUrl), {
      symbol: this.venueSymbol(query),
    });
    const raw = await requestJson<Record<string, unknown>>(this.fetchImpl, url);
    const markPrice = Number(raw.markPrice);
    const indexPrice = Number(raw.indexPrice);
    const basis = indexPrice === 0 ? 0 : (markPrice - indexPrice) / indexPrice;
    return {
      dataType: "basis",
      status: "complete",
      records: [
        {
          ...this.identity(query, new Date(Number(raw.time ?? Date.now())).toISOString()),
          dataType: "basis",
          marketType: query.marketType,
          metric: "basis",
          value: basis,
          unit: "decimal",
          methodology: "derived",
        },
      ],
    };
  }

  private async getRatio(
    query: CryptoDerivativesDataQuery,
    endpoint: string,
    metric: string,
  ): Promise<DerivativeSection> {
    const dataType = metric === "long_short_ratio" ? "long_short_ratio" : "taker_flow";
    const url = setQuery(new URL(`/futures/data/${endpoint}`, this.futuresBaseUrl), {
      symbol: this.venueSymbol(query),
      period: query.interval ?? "1h",
      startTime: query.startTime ? new Date(query.startTime).getTime() : undefined,
      endTime: query.endTime ? new Date(query.endTime).getTime() : undefined,
      limit: Math.min(query.limit ?? 100, 500),
    });
    const raw = await requestJson<Array<Record<string, unknown>>>(this.fetchImpl, url);
    return {
      dataType,
      status: "complete",
      records: raw.map((item) => ({
        ...this.identity(query, new Date(Number(item.timestamp)).toISOString()),
        dataType,
        marketType: query.marketType,
        metric,
        value: Number(item.longShortRatio ?? item.buySellRatio),
        unit: "ratio",
        interval: query.interval,
        methodology: "reported",
      })),
    };
  }

  private async getContractMetadata(query: CryptoDerivativesDataQuery): Promise<DerivativeSection> {
    const url = new URL("/fapi/v1/exchangeInfo", this.futuresBaseUrl);
    const raw = await requestJson<{ symbols?: Array<Record<string, unknown>> }>(
      this.fetchImpl,
      url,
    );
    const instrument = raw.symbols?.find((item) => item.symbol === this.venueSymbol(query));
    if (!instrument) return { dataType: "contract_metadata", status: "complete", records: [] };
    return {
      dataType: "contract_metadata",
      status: "complete",
      records: [
        {
          ...this.identity(query, new Date().toISOString()),
          dataType: "contract_metadata",
          marketType: query.marketType,
          metric: "contract_status",
          value: instrument.status === "TRADING" ? 1 : 0,
          unit: "boolean",
          contractExpiry:
            typeof instrument.deliveryDate === "number"
              ? new Date(instrument.deliveryDate).toISOString()
              : undefined,
          methodology: "reported",
        },
      ],
    };
  }

  private partialDerivativeSection(
    dataType: CryptoDerivativeSectionType,
    message: string,
  ): DerivativeSection {
    return {
      dataType,
      status: "partial",
      records: [],
      issues: [{ code: "PARTIAL_DATA", message }],
    };
  }
}
