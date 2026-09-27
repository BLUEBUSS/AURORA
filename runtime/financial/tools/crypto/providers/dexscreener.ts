import { CryptoProviderError } from "../errors.js";
import { normalizeChain, normalizeTimestamp } from "../normalize.js";
import type { CryptoDexProvider } from "../provider.js";
import type {
  CryptoDexDataQuery,
  CryptoDexDataResult,
  CryptoDexDataType,
  CryptoDexRecord,
  CryptoProviderSection,
} from "../types.js";
import { createCryptoFetch, requestJson, type CryptoFetch } from "./http.js";

const API_BASE = "https://api.dexscreener.com";

interface DexScreenerOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  now?: () => number;
}

type DexSection = CryptoProviderSection<CryptoDexDataType, CryptoDexRecord>;

export class DexScreenerCryptoProvider implements CryptoDexProvider {
  readonly id = "dexscreener";
  private readonly fetchImpl: CryptoFetch;
  private readonly now: () => number;

  constructor(options: DexScreenerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.now = options.now ?? Date.now;
  }

  async getDexData(query: CryptoDexDataQuery): Promise<CryptoDexDataResult> {
    const pairPromise = query.poolAddress ? this.pair(query) : undefined;
    const sections: DexSection[] = [];
    for (const dataType of query.dataTypes) {
      try {
        sections.push({
          dataType,
          status: "complete",
          records: await this.load(dataType, query, pairPromise),
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
        ? [{ code: "PARTIAL_DATA", message: "Some DEX Screener sections failed." }]
        : undefined,
    };
  }

  private load(
    dataType: CryptoDexDataType,
    query: CryptoDexDataQuery,
    pairPromise?: Promise<DexPair>,
  ): Promise<CryptoDexRecord[]> {
    switch (dataType) {
      case "token_search":
        return this.search(query);
      case "pools":
        return this.tokenPairs(query);
      case "pool_snapshot":
        return this.fromPair(pairPromise, query, "pool_snapshot");
      case "liquidity":
        return this.fromPair(pairPromise, query, "liquidity");
      case "transaction_activity":
        return this.activity(pairPromise, query);
      case "ohlcv":
      case "trades":
        throw new CryptoProviderError(
          "INVALID_ARGUMENT",
          `${dataType} is not available from DEX Screener; use GeckoTerminal or provider=auto.`,
        );
    }
  }

  private async search(query: CryptoDexDataQuery): Promise<CryptoDexRecord[]> {
    if (!query.query) throw new CryptoProviderError("INVALID_ARGUMENT", "query is required.");
    const data = await this.get<DexSearchResponse>("/latest/dex/search", { q: query.query });
    return (data.pairs ?? [])
      .filter((pair) => !query.chain || normalizeChain(pair.chainId) === query.chain)
      .slice(0, query.limit ?? 20)
      .map((pair) => this.pairRecord(pair, "token_search", query));
  }

  private async tokenPairs(query: CryptoDexDataQuery): Promise<CryptoDexRecord[]> {
    if (!query.chain || !query.contractAddress) {
      throw new CryptoProviderError("INVALID_ARGUMENT", "chain and contractAddress are required.");
    }
    const pairs = await this.get<DexPair[]>(
      `/token-pairs/v1/${chainId(query.chain)}/${encodeURIComponent(query.contractAddress)}`,
    );
    return (pairs ?? [])
      .slice(0, query.limit ?? 20)
      .map((pair) => this.pairRecord(pair, "pools", query));
  }

  private async pair(query: CryptoDexDataQuery): Promise<DexPair> {
    if (!query.chain || !query.poolAddress) {
      throw new CryptoProviderError("INVALID_ARGUMENT", "chain and poolAddress are required.");
    }
    const data = await this.get<DexSearchResponse>(
      `/latest/dex/pairs/${chainId(query.chain)}/${encodeURIComponent(query.poolAddress)}`,
    );
    const pair = data.pairs?.[0];
    if (!pair) throw new CryptoProviderError("NO_DATA", "DEX Screener pair was not found.");
    return pair;
  }

  private async fromPair(
    pairPromise: Promise<DexPair> | undefined,
    query: CryptoDexDataQuery,
    dataType: "pool_snapshot" | "liquidity",
  ): Promise<CryptoDexRecord[]> {
    if (!pairPromise) throw new CryptoProviderError("INVALID_ARGUMENT", "poolAddress is required.");
    return [this.pairRecord(await pairPromise, dataType, query)];
  }

  private async activity(
    pairPromise: Promise<DexPair> | undefined,
    query: CryptoDexDataQuery,
  ): Promise<CryptoDexRecord[]> {
    if (!pairPromise) throw new CryptoProviderError("INVALID_ARGUMENT", "poolAddress is required.");
    const pair = await pairPromise;
    const common = this.pairRecord(pair, "transaction_activity", query);
    const windows = [
      ["5m", "m5"],
      ["1h", "h1"],
      ["6h", "h6"],
      ["24h", "h24"],
    ] as const;
    return windows.map(([window, key]) => ({
      ...common,
      window,
      buys: numberValue(pair.txns?.[key]?.buys),
      sells: numberValue(pair.txns?.[key]?.sells),
      volumeUsd: optionalNumber(pair.volume?.[key]),
    }));
  }

  private pairRecord(
    pair: DexPair,
    dataType: "token_search" | "pools" | "pool_snapshot" | "liquidity" | "transaction_activity",
    query: CryptoDexDataQuery,
  ): CryptoDexRecord {
    return {
      dataType,
      chain: normalizeChain(pair.chainId),
      poolAddress: pair.pairAddress,
      tokenAddress: dataType === "pools" ? query.contractAddress : undefined,
      venue: pair.dexId,
      provider: this.id,
      timestamp: normalizeTimestamp(this.now()),
      baseToken: pair.baseToken,
      quoteToken: pair.quoteToken,
      priceUsd: optionalNumber(pair.priceUsd),
      priceNative: optionalNumber(pair.priceNative),
      priceChange24h: optionalNumber(pair.priceChange?.h24),
      liquidityUsd: optionalNumber(pair.liquidity?.usd),
      volume24hUsd: optionalNumber(pair.volume?.h24),
      marketCapUsd: optionalNumber(pair.marketCap),
      fdvUsd: optionalNumber(pair.fdv),
      methodology: "reported",
    };
  }

  private get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return requestJson<T>(this.fetchImpl, url);
  }
}

interface DexToken {
  address: string;
  name?: string;
  symbol: string;
}
interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: DexToken;
  quoteToken: DexToken;
  priceNative?: string;
  priceUsd?: string;
  txns?: Record<string, { buys?: number; sells?: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
}
interface DexSearchResponse {
  pairs?: DexPair[] | null;
}

function chainId(chain: string): string {
  return (
    (
      {
        ethereum: "ethereum",
        arbitrum: "arbitrum",
        optimism: "optimism",
        bsc: "bsc",
        polygon: "polygon",
        avalanche: "avalanche",
        solana: "solana",
        base: "base",
      } as Record<string, string>
    )[chain] ?? chain
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
