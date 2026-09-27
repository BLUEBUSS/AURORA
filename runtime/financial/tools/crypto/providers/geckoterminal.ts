import { CryptoProviderError } from "../errors.js";
import { normalizeChain, normalizeTimestamp } from "../normalize.js";
import type { CryptoDexProvider } from "../provider.js";
import type {
  CryptoDexDataQuery,
  CryptoDexDataResult,
  CryptoDexDataType,
  CryptoDexRecord,
  CryptoInterval,
  CryptoProviderSection,
} from "../types.js";
import { createCryptoFetch, requestJson, type CryptoFetch } from "./http.js";

const API_BASE = "https://api.geckoterminal.com/api/v2";
const ACCEPT = "application/vnd.api+json;version=20230302";

interface GeckoTerminalOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  now?: () => number;
}

type DexSection = CryptoProviderSection<CryptoDexDataType, CryptoDexRecord>;

export class GeckoTerminalCryptoProvider implements CryptoDexProvider {
  readonly id = "geckoterminal";
  private readonly fetchImpl: CryptoFetch;
  private readonly now: () => number;

  constructor(options: GeckoTerminalOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.now = options.now ?? Date.now;
  }

  async getDexData(query: CryptoDexDataQuery): Promise<CryptoDexDataResult> {
    const needsPool = query.dataTypes.some((dataType) =>
      ["pool_snapshot", "liquidity", "transaction_activity"].includes(dataType),
    );
    const poolPromise = needsPool && query.poolAddress ? this.pool(query) : undefined;
    const sections: DexSection[] = [];
    for (const dataType of query.dataTypes) {
      try {
        sections.push({
          dataType,
          status: "complete",
          records: await this.load(dataType, query, poolPromise),
        });
      } catch (error) {
        if (query.dataTypes.length === 1) throw error;
        sections.push({
          dataType,
          status: "partial",
          records: [],
          issues: [{ code: "PARTIAL_DATA", message: errorMessage(error) }],
        });
      }
    }
    const partial = sections.some((section) => section.status === "partial");
    return {
      status: partial ? "partial" : "complete",
      sections,
      issues: partial
        ? [{ code: "PARTIAL_DATA", message: "Some GeckoTerminal sections failed." }]
        : undefined,
    };
  }

  private load(
    dataType: CryptoDexDataType,
    query: CryptoDexDataQuery,
    poolPromise?: Promise<GeckoPool>,
  ): Promise<CryptoDexRecord[]> {
    switch (dataType) {
      case "token_search":
        return this.search(query);
      case "pools":
        return this.tokenPools(query);
      case "pool_snapshot":
        return this.fromPool(poolPromise, query, "pool_snapshot");
      case "liquidity":
        return this.fromPool(poolPromise, query, "liquidity");
      case "transaction_activity":
        return this.activity(poolPromise, query);
      case "ohlcv":
        return this.ohlcv(query);
      case "trades":
        return this.trades(query);
    }
  }

  private async search(query: CryptoDexDataQuery): Promise<CryptoDexRecord[]> {
    if (!query.query) throw new CryptoProviderError("INVALID_ARGUMENT", "query is required.");
    const data = await this.get<GeckoListResponse>("/search/pools", { query: query.query });
    return (data.data ?? [])
      .filter((pool) => !query.chain || poolChain(pool) === query.chain)
      .slice(0, query.limit ?? 20)
      .map((pool) => this.poolRecord(pool, "token_search", query));
  }

  private async tokenPools(query: CryptoDexDataQuery): Promise<CryptoDexRecord[]> {
    if (!query.chain || !query.contractAddress) {
      throw new CryptoProviderError("INVALID_ARGUMENT", "chain and contractAddress are required.");
    }
    const data = await this.get<GeckoListResponse>(
      `/networks/${networkId(query.chain)}/tokens/${encodeURIComponent(query.contractAddress)}/pools`,
      { page: "1" },
    );
    return (data.data ?? [])
      .slice(0, query.limit ?? 20)
      .map((pool) =>
        this.poolRecord(pool, "pools", { ...query, poolAddress: pool.attributes.address }),
      );
  }

  private async pool(query: CryptoDexDataQuery): Promise<GeckoPool> {
    requirePool(query);
    const data = await this.get<GeckoItemResponse>(
      `/networks/${networkId(query.chain!)}/pools/${encodeURIComponent(query.poolAddress!)}`,
    );
    if (!data.data) throw new CryptoProviderError("NO_DATA", "GeckoTerminal pool was not found.");
    return data.data;
  }

  private async fromPool(
    poolPromise: Promise<GeckoPool> | undefined,
    query: CryptoDexDataQuery,
    dataType: "pool_snapshot" | "liquidity",
  ): Promise<CryptoDexRecord[]> {
    if (!poolPromise) throw new CryptoProviderError("INVALID_ARGUMENT", "poolAddress is required.");
    return [this.poolRecord(await poolPromise, dataType, query)];
  }

  private async activity(
    poolPromise: Promise<GeckoPool> | undefined,
    query: CryptoDexDataQuery,
  ): Promise<CryptoDexRecord[]> {
    if (!poolPromise) throw new CryptoProviderError("INVALID_ARGUMENT", "poolAddress is required.");
    const pool = await poolPromise;
    const common = this.poolRecord(pool, "transaction_activity", query);
    const windows = [
      ["5m", "m5"],
      ["1h", "h1"],
      ["6h", "h6"],
      ["24h", "h24"],
    ] as const;
    return windows.map(([window, key]) => ({
      ...common,
      window,
      buys: numberValue(pool.attributes.transactions?.[key]?.buys),
      sells: numberValue(pool.attributes.transactions?.[key]?.sells),
      buyers: optionalNumber(pool.attributes.transactions?.[key]?.buyers),
      sellers: optionalNumber(pool.attributes.transactions?.[key]?.sellers),
      volumeUsd: optionalNumber(pool.attributes.volume_usd?.[key]),
    }));
  }

  private async ohlcv(query: CryptoDexDataQuery): Promise<CryptoDexRecord[]> {
    requirePool(query);
    const interval = query.interval ?? "1h";
    const resolution = ohlcvResolution(interval);
    const params: Record<string, string> = {
      aggregate: String(resolution.aggregate),
      limit: String(Math.min(query.limit ?? 100, 1000)),
      currency: "usd",
    };
    if (query.endTime)
      params.before_timestamp = String(Math.floor(Date.parse(query.endTime) / 1000));
    const data = await this.get<GeckoOhlcvResponse>(
      `/networks/${networkId(query.chain!)}/pools/${encodeURIComponent(query.poolAddress!)}/ohlcv/${resolution.timeframe}`,
      params,
    );
    return (data.data?.attributes.ohlcv_list ?? [])
      .filter(([timestamp]) => inRange(timestamp * 1000, query))
      .map(([timestamp, open, high, low, close, volume]) => ({
        ...this.identity(query, "ohlcv", timestamp * 1000),
        interval,
        openTime: normalizeTimestamp(timestamp * 1000),
        closeTime: normalizeTimestamp(timestamp * 1000 + intervalMilliseconds(interval)),
        open: numberValue(open),
        high: numberValue(high),
        low: numberValue(low),
        close: numberValue(close),
        volumeUsd: numberValue(volume),
        methodology: "reported",
      }));
  }

  private async trades(query: CryptoDexDataQuery): Promise<CryptoDexRecord[]> {
    requirePool(query);
    const data = await this.get<GeckoTradesResponse>(
      `/networks/${networkId(query.chain!)}/pools/${encodeURIComponent(query.poolAddress!)}/trades`,
    );
    return (data.data ?? [])
      .filter((trade) => inRange(Date.parse(trade.attributes.block_timestamp), query))
      .slice(0, query.limit ?? 100)
      .map((trade) => ({
        ...this.identity(query, "trades", trade.attributes.block_timestamp),
        tradeId: trade.id,
        transactionHash: trade.attributes.tx_hash,
        side: trade.attributes.kind === "sell" ? "sell" : "buy",
        priceUsd: optionalNumber(trade.attributes.price_to_in_usd),
        volumeUsd: optionalNumber(trade.attributes.volume_in_usd),
        baseAmount: optionalNumber(trade.attributes.to_token_amount),
        quoteAmount: optionalNumber(trade.attributes.from_token_amount),
        methodology: "reported",
      }));
  }

  private poolRecord(
    pool: GeckoPool,
    dataType: "token_search" | "pools" | "pool_snapshot" | "liquidity" | "transaction_activity",
    query: CryptoDexDataQuery,
  ): CryptoDexRecord {
    const [baseSymbol = "UNKNOWN", quoteSymbol = "UNKNOWN"] = pool.attributes.name
      .split(/\s*\/\s*/)
      .map((part) => part.split(" ")[0]);
    return {
      ...this.identity(
        { ...query, chain: poolChain(pool), poolAddress: pool.attributes.address },
        dataType,
      ),
      venue: pool.relationships?.dex?.data.id ?? "unknown",
      tokenAddress: dataType === "pools" ? query.contractAddress : undefined,
      baseToken: {
        address: relationshipAddress(pool.relationships?.base_token?.data.id),
        symbol: baseSymbol,
      },
      quoteToken: {
        address: relationshipAddress(pool.relationships?.quote_token?.data.id),
        symbol: quoteSymbol,
      },
      priceUsd: optionalNumber(pool.attributes.base_token_price_usd),
      priceNative: optionalNumber(pool.attributes.base_token_price_native_currency),
      priceChange24h: optionalNumber(pool.attributes.price_change_percentage?.h24),
      liquidityUsd: optionalNumber(pool.attributes.reserve_in_usd),
      volume24hUsd: optionalNumber(pool.attributes.volume_usd?.h24),
      marketCapUsd: optionalNumber(pool.attributes.market_cap_usd),
      fdvUsd: optionalNumber(pool.attributes.fdv_usd),
      methodology: "reported",
    };
  }

  private identity(
    query: CryptoDexDataQuery,
    dataType: CryptoDexDataType,
    timestamp: string | number = this.now(),
  ) {
    return {
      dataType,
      chain: query.chain!,
      poolAddress: query.poolAddress,
      venue: "geckoterminal",
      provider: this.id,
      timestamp: normalizeTimestamp(timestamp),
    };
  }

  private get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return requestJson<T>(this.fetchImpl, url, { headers: { Accept: ACCEPT } });
  }
}

interface GeckoPool {
  id: string;
  attributes: {
    address: string;
    name: string;
    base_token_price_usd?: string;
    base_token_price_native_currency?: string;
    price_change_percentage?: Record<string, string>;
    volume_usd?: Record<string, string>;
    reserve_in_usd?: string;
    market_cap_usd?: string;
    fdv_usd?: string;
    transactions?: Record<
      string,
      { buys?: number; sells?: number; buyers?: number; sellers?: number }
    >;
  };
  relationships?: {
    base_token?: { data: { id: string } };
    quote_token?: { data: { id: string } };
    dex?: { data: { id: string } };
  };
}
interface GeckoListResponse {
  data?: GeckoPool[];
}
interface GeckoItemResponse {
  data?: GeckoPool;
}
interface GeckoOhlcvResponse {
  data?: { attributes: { ohlcv_list?: Array<[number, number, number, number, number, number]> } };
}
interface GeckoTrade {
  id: string;
  attributes: {
    tx_hash?: string;
    block_timestamp: string;
    kind?: string;
    volume_in_usd?: string;
    from_token_amount?: string;
    to_token_amount?: string;
    price_to_in_usd?: string;
  };
}
interface GeckoTradesResponse {
  data?: GeckoTrade[];
}

function poolChain(pool: GeckoPool): string {
  return normalizeChain(pool.id.split("_", 1)[0]);
}
function relationshipAddress(id = "unknown"): string {
  const separator = id.indexOf("_");
  return separator >= 0 ? id.slice(separator + 1) : id;
}
function requirePool(query: CryptoDexDataQuery): void {
  if (!query.chain || !query.poolAddress)
    throw new CryptoProviderError("INVALID_ARGUMENT", "chain and poolAddress are required.");
}
function networkId(chain: string): string {
  return (
    (
      {
        ethereum: "eth",
        arbitrum: "arbitrum",
        optimism: "optimism",
        bsc: "bsc",
        polygon: "polygon_pos",
        avalanche: "avax",
        solana: "solana",
        base: "base",
      } as Record<string, string>
    )[chain] ?? chain
  );
}
function ohlcvResolution(interval: CryptoInterval): {
  timeframe: "minute" | "hour" | "day";
  aggregate: number;
} {
  const map: Record<CryptoInterval, { timeframe: "minute" | "hour" | "day"; aggregate: number }> = {
    "1m": { timeframe: "minute", aggregate: 1 },
    "5m": { timeframe: "minute", aggregate: 5 },
    "15m": { timeframe: "minute", aggregate: 15 },
    "1h": { timeframe: "hour", aggregate: 1 },
    "4h": { timeframe: "hour", aggregate: 4 },
    "1d": { timeframe: "day", aggregate: 1 },
    "1w": { timeframe: "day", aggregate: 7 },
  };
  return map[interval];
}
function intervalMilliseconds(interval: CryptoInterval): number {
  return (
    {
      "1m": 60_000,
      "5m": 300_000,
      "15m": 900_000,
      "1h": 3_600_000,
      "4h": 14_400_000,
      "1d": 86_400_000,
      "1w": 604_800_000,
    } as Record<CryptoInterval, number>
  )[interval];
}
function inRange(timestamp: number, query: CryptoDexDataQuery): boolean {
  return (
    (!query.startTime || timestamp >= Date.parse(query.startTime)) &&
    (!query.endTime || timestamp <= Date.parse(query.endTime))
  );
}
function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
