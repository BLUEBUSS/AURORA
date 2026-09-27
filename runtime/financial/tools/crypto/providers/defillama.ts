import { CryptoProviderError } from "../errors.js";
import { normalizeChain, normalizeTimestamp } from "../normalize.js";
import type { CryptoDefiProvider } from "../provider.js";
import type {
  CryptoDefiDataQuery,
  CryptoDefiDataResult,
  CryptoDefiDataType,
  CryptoDefiRecord,
  CryptoProviderSection,
} from "../types.js";
import { createCryptoFetch, requestJson, type CryptoFetch } from "./http.js";

const API_BASE = "https://api.llama.fi";
const STABLECOIN_BASE = "https://stablecoins.llama.fi";
const YIELDS_BASE = "https://yields.llama.fi";

interface DefiLlamaOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  now?: () => number;
}

type DefiSection = CryptoProviderSection<CryptoDefiDataType, CryptoDefiRecord>;

export class DefiLlamaCryptoProvider implements CryptoDefiProvider {
  readonly id = "defillama";
  private readonly fetchImpl: CryptoFetch;
  private readonly now: () => number;

  constructor(options: DefiLlamaOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.now = options.now ?? Date.now;
  }

  async getDefiData(query: CryptoDefiDataQuery): Promise<CryptoDefiDataResult> {
    const sections: DefiSection[] = [];
    for (const dataType of query.dataTypes) {
      try {
        sections.push({ dataType, status: "complete", records: await this.load(dataType, query) });
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
        ? [{ code: "PARTIAL_DATA", message: "Some DefiLlama sections failed." }]
        : undefined,
    };
  }

  private load(dataType: CryptoDefiDataType, query: CryptoDefiDataQuery) {
    switch (dataType) {
      case "protocol":
        return this.protocol(query);
      case "chain_tvl":
        return this.chainTvl(query);
      case "stablecoins":
        return this.stablecoins(query);
      case "yields":
        return this.yields(query);
      case "dex_volume":
      case "options_volume":
      case "open_interest":
        return this.dimension(dataType, query);
      case "fees_revenue":
        return this.feesRevenue(query);
    }
  }

  private async protocol(query: CryptoDefiDataQuery): Promise<CryptoDefiRecord[]> {
    if (!query.protocol) throw new CryptoProviderError("INVALID_ARGUMENT", "protocol is required.");
    const data = await this.get<ProtocolResponse>(
      API_BASE,
      `/protocol/${encodeURIComponent(query.protocol)}`,
    );
    const latest = [...(data.tvl ?? [])].sort((a, b) => a.date - b.date).at(-1);
    if (!latest) return [];
    return [
      {
        ...this.identity("protocol", latest.date * 1_000),
        protocol: query.protocol,
        name: data.name,
        symbol: data.symbol,
        category: data.category ?? undefined,
        chains: data.chains?.map(normalizeChain),
        metric: "total_tvl",
        value: numberValue(latest.totalLiquidityUSD),
        unit: "USD",
        tvlUsd: numberValue(latest.totalLiquidityUSD),
        methodology: "reported",
      },
    ];
  }

  private async chainTvl(query: CryptoDefiDataQuery): Promise<CryptoDefiRecord[]> {
    if (query.chain && query.startTime && query.endTime) {
      const points = await this.get<Array<{ date: number; tvl: number }>>(
        API_BASE,
        `/v2/historicalChainTvl/${encodeURIComponent(defiLlamaChain(query.chain))}`,
      );
      return points
        .filter((point) => inRange(point.date * 1_000, query))
        .slice(-(query.limit ?? 100))
        .map((point) => ({
          ...this.identity("chain_tvl", point.date * 1_000),
          chain: query.chain,
          metric: "chain_tvl",
          value: numberValue(point.tvl),
          unit: "USD",
          tvlUsd: numberValue(point.tvl),
          methodology: "reported",
        }));
    }

    const chains = await this.get<Array<{ name: string; tvl: number; tokenSymbol?: string }>>(
      API_BASE,
      "/v2/chains",
    );
    return chains
      .filter((item) => !query.chain || normalizeChain(item.name) === query.chain)
      .slice(0, query.limit ?? 100)
      .map((item) => ({
        ...this.identity("chain_tvl"),
        chain: normalizeChain(item.name),
        symbol: item.tokenSymbol,
        metric: "chain_tvl",
        value: numberValue(item.tvl),
        unit: "USD",
        tvlUsd: numberValue(item.tvl),
        methodology: "reported",
      }));
  }

  private async stablecoins(query: CryptoDefiDataQuery): Promise<CryptoDefiRecord[]> {
    const data = await this.get<StablecoinsResponse>(STABLECOIN_BASE, "/stablecoins", {
      includePrices: "true",
    });
    return (data.peggedAssets ?? [])
      .filter((asset) => !query.stablecoinId || String(asset.id) === query.stablecoinId)
      .flatMap((asset) => {
        if (!query.chain) return [stablecoinRecord(asset, undefined, this.now())];
        const chainEntry = Object.entries(asset.chainCirculating ?? {}).find(
          ([chain]) => normalizeChain(chain) === query.chain,
        );
        return chainEntry
          ? [
              stablecoinRecord(
                asset,
                { chain: query.chain, value: peggedValue(chainEntry[1].current) },
                this.now(),
              ),
            ]
          : [];
      })
      .slice(0, query.limit ?? 100);
  }

  private async yields(query: CryptoDefiDataQuery): Promise<CryptoDefiRecord[]> {
    const data = await this.get<YieldsResponse>(YIELDS_BASE, "/pools");
    return (data.data ?? [])
      .filter((pool) => !query.chain || normalizeChain(pool.chain) === query.chain)
      .filter((pool) => !query.protocol || normalizeSlug(pool.project) === query.protocol)
      .filter((pool) => !query.poolId || pool.pool === query.poolId)
      .sort((a, b) => numberValue(b.tvlUsd) - numberValue(a.tvlUsd))
      .slice(0, query.limit ?? 100)
      .map((pool) => ({
        ...this.identity("yields", pool.timestamp),
        protocol: normalizeSlug(pool.project),
        chain: normalizeChain(pool.chain),
        poolId: pool.pool,
        symbol: pool.symbol,
        metric: "apy",
        value: numberValue(pool.apy),
        unit: "percent",
        tvlUsd: numberValue(pool.tvlUsd),
        apy: numberValue(pool.apy),
        apyBase: optionalNumber(pool.apyBase),
        apyReward: optionalNumber(pool.apyReward),
        stablecoin: pool.stablecoin,
        exposure: pool.exposure,
        methodology: "reported",
      }));
  }

  private async dimension(
    dataType: "dex_volume" | "options_volume" | "open_interest",
    query: CryptoDefiDataQuery,
  ): Promise<CryptoDefiRecord[]> {
    const path = {
      dex_volume: "/overview/dexs",
      options_volume: "/overview/options",
      open_interest: "/overview/open-interest",
    }[dataType];
    const data = await this.get<DimensionResponse>(API_BASE, path);
    return this.dimensionRecords(dataType, data.protocols ?? [], query);
  }

  private async feesRevenue(query: CryptoDefiDataQuery): Promise<CryptoDefiRecord[]> {
    const [fees, revenue] = await Promise.all([
      this.get<DimensionResponse>(API_BASE, "/overview/fees", { dataType: "dailyFees" }),
      this.get<DimensionResponse>(API_BASE, "/overview/fees", { dataType: "dailyRevenue" }),
    ]);
    const revenueBySlug = new Map(
      (revenue.protocols ?? []).map((item) => [dimensionSlug(item), numberValue(item.total24h)]),
    );
    return this.dimensionRecords("fees_revenue", fees.protocols ?? [], query).map((record) => ({
      ...record,
      revenue24hUsd: revenueBySlug.get(record.protocol ?? ""),
    }));
  }

  private dimensionRecords(
    dataType: "dex_volume" | "options_volume" | "open_interest" | "fees_revenue",
    protocols: DimensionProtocol[],
    query: CryptoDefiDataQuery,
  ): CryptoDefiRecord[] {
    return protocols
      .filter((item) => !query.protocol || dimensionSlug(item) === query.protocol)
      .filter(
        (item) =>
          !query.chain ||
          (item.chains ?? []).some((chain) => normalizeChain(chain) === query.chain),
      )
      .slice(0, query.limit ?? 100)
      .map((item) => ({
        ...this.identity(dataType),
        protocol: dimensionSlug(item),
        chain: query.chain,
        name: item.displayName ?? item.name,
        category: item.category,
        chains: item.chains?.map(normalizeChain),
        metric: dataType === "fees_revenue" ? "fees" : dataType,
        value: numberValue(item.total24h),
        unit: "USD",
        total24hUsd: optionalNumber(item.total24h),
        total7dUsd: optionalNumber(item.total7d),
        total30dUsd: optionalNumber(item.total30d),
        change1d: optionalNumber(item.change_1d),
        methodology: "reported",
      }));
  }

  private identity(dataType: CryptoDefiDataType, timestamp: string | number = this.now()) {
    return {
      dataType,
      provider: this.id,
      venue: "aggregate" as const,
      timestamp: normalizeTimestamp(timestamp),
    };
  }

  private get<T>(base: string, path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return requestJson<T>(this.fetchImpl, url);
  }
}

interface ProtocolResponse {
  name?: string;
  symbol?: string;
  category?: string | null;
  chains?: string[];
  tvl?: Array<{ date: number; totalLiquidityUSD: number }>;
}

interface StablecoinAsset {
  id: string | number;
  name?: string;
  symbol?: string;
  pegType?: string;
  price?: number;
  circulating?: Record<string, number>;
  chainCirculating?: Record<string, { current?: Record<string, number> }>;
}
interface StablecoinsResponse {
  peggedAssets?: StablecoinAsset[];
}
interface YieldPool {
  pool: string;
  chain: string;
  project: string;
  symbol?: string;
  tvlUsd: number;
  apy: number;
  apyBase?: number;
  apyReward?: number;
  stablecoin?: boolean;
  exposure?: string;
  timestamp?: string;
}
interface YieldsResponse {
  data?: YieldPool[];
}
interface DimensionProtocol {
  name?: string;
  displayName?: string;
  slug?: string;
  module?: string;
  category?: string;
  chains?: string[];
  total24h?: number | null;
  total7d?: number | null;
  total30d?: number | null;
  change_1d?: number | null;
}
interface DimensionResponse {
  protocols?: DimensionProtocol[];
}

function stablecoinRecord(
  asset: StablecoinAsset,
  chainValue: { chain: string; value: number } | undefined,
  now: number,
): CryptoDefiRecord {
  const value = chainValue?.value ?? peggedValue(asset.circulating);
  return {
    dataType: "stablecoins",
    provider: "defillama",
    venue: "aggregate",
    timestamp: normalizeTimestamp(now),
    stablecoinId: String(asset.id),
    chain: chainValue?.chain,
    name: asset.name,
    symbol: asset.symbol,
    category: asset.pegType,
    metric: "circulating_supply",
    value,
    unit: "USD",
    methodology: "reported",
  };
}

function peggedValue(value: Record<string, number> | undefined): number {
  return Object.values(value ?? {}).reduce((sum, item) => sum + numberValue(item), 0);
}
function dimensionSlug(item: DimensionProtocol): string {
  return normalizeSlug(item.slug ?? item.module ?? item.name ?? "unknown");
}
function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}
function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function optionalNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function inRange(timestamp: number, query: CryptoDefiDataQuery): boolean {
  return (
    (!query.startTime || timestamp >= Date.parse(query.startTime)) &&
    (!query.endTime || timestamp <= Date.parse(query.endTime))
  );
}
function defiLlamaChain(chain: string): string {
  return (
    (
      {
        ethereum: "Ethereum",
        arbitrum: "Arbitrum",
        optimism: "OP Mainnet",
        bsc: "BSC",
        polygon: "Polygon",
        avalanche: "Avalanche",
        solana: "Solana",
      } as Record<string, string>
    )[chain] ?? chain
  );
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
