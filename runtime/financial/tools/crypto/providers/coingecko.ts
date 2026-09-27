import { CryptoProviderError } from "../errors.js";
import type { CryptoAssetProvider } from "../provider.js";
import type {
  CryptoAssetDataQuery,
  CryptoAssetDataResult,
  CryptoAssetDataType,
  CryptoAssetRecord,
  CryptoProviderSection,
} from "../types.js";
import { createCryptoFetch, requestJson, setQuery, type CryptoFetch } from "./http.js";

const API_BASE = "https://api.coingecko.com/api/v3";

interface CoinGeckoOptions {
  apiKey: string;
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  now?: () => number;
}

type AssetSection = CryptoProviderSection<CryptoAssetDataType, CryptoAssetRecord>;

export class CoinGeckoCryptoProvider implements CryptoAssetProvider {
  readonly id = "coingecko";
  private readonly apiKey: string;
  private readonly fetchImpl: CryptoFetch;
  private readonly now: () => number;

  constructor(options: CoinGeckoOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.now = options.now ?? Date.now;
  }

  async getAssetData(query: CryptoAssetDataQuery): Promise<CryptoAssetDataResult> {
    const assetId = query.asset ? await this.resolveAsset(query.asset) : undefined;
    const needsMarket = query.dataTypes.some((item) =>
      ["market_snapshot", "supply", "rankings"].includes(item),
    );
    const marketRows = needsMarket ? await this.markets(query, assetId) : [];
    const sections: AssetSection[] = [];
    for (const dataType of query.dataTypes) {
      try {
        sections.push({
          dataType,
          status: "complete",
          records: await this.load(dataType, query, assetId, marketRows),
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
        ? [{ code: "PARTIAL_DATA", message: "Some CoinGecko sections failed." }]
        : undefined,
    };
  }

  private load(
    dataType: CryptoAssetDataType,
    query: CryptoAssetDataQuery,
    assetId: string | undefined,
    marketRows: CoinGeckoMarket[],
  ): Promise<CryptoAssetRecord[]> | CryptoAssetRecord[] {
    switch (dataType) {
      case "profile":
        return this.profile(requiredAsset(assetId));
      case "market_snapshot":
        return marketRows.map((row) => this.marketRecord(row, query.quoteCurrency));
      case "supply":
        return marketRows.map((row) => this.supplyRecord(row));
      case "rankings":
        return marketRows.map((row) => this.rankingRecord(row));
      case "categories":
        return this.categories(query);
      case "exchanges":
        return this.exchanges(requiredAsset(assetId), query);
      case "trending":
        return this.trending(query.limit);
    }
  }

  private async resolveAsset(asset: string): Promise<string> {
    const data = await this.get<CoinGeckoSearch>("/search", { query: asset });
    const normalized = asset.toLowerCase();
    const match =
      (data.coins ?? []).find(
        (coin) =>
          coin.id.toLowerCase() === normalized ||
          coin.symbol.toLowerCase() === normalized ||
          coin.name.toLowerCase() === normalized,
      ) ?? data.coins?.[0];
    if (!match) throw new CryptoProviderError("NO_DATA", `CoinGecko could not resolve ${asset}.`);
    return match.id;
  }

  private markets(query: CryptoAssetDataQuery, assetId?: string): Promise<CoinGeckoMarket[]> {
    return this.get("/coins/markets", {
      vs_currency: query.quoteCurrency.toLowerCase(),
      ids: assetId,
      category: assetId ? undefined : query.category,
      order: "market_cap_desc",
      per_page: query.limit ?? (assetId ? 1 : 100),
      page: 1,
      sparkline: "false",
    });
  }

  private async profile(assetId: string): Promise<CryptoAssetRecord[]> {
    const row = await this.get<CoinGeckoProfile>(`/coins/${encodeURIComponent(assetId)}`, {
      localization: "false",
      tickers: "false",
      market_data: "false",
      community_data: "false",
      developer_data: "false",
      sparkline: "false",
    });
    return [
      {
        ...this.identity("profile", row.last_updated),
        assetId: row.id,
        symbol: row.symbol.toUpperCase(),
        name: row.name,
        description: row.description?.en,
        homepage: row.links?.homepage?.find(Boolean),
        imageUrl: row.image?.large,
        genesisDate: row.genesis_date ?? undefined,
        hashingAlgorithm: row.hashing_algorithm ?? undefined,
        categories: row.categories,
        platforms: row.platforms,
        methodology: "reported",
      },
    ];
  }

  private marketRecord(row: CoinGeckoMarket, quoteCurrency: string): CryptoAssetRecord {
    return {
      ...this.assetIdentity("market_snapshot", row, quoteCurrency),
      price: numberValue(row.current_price),
      marketCap: numberValue(row.market_cap),
      fullyDilutedValuation: numberValue(row.fully_diluted_valuation),
      volume24h: numberValue(row.total_volume),
      change24h: percentToDecimal(row.price_change_percentage_24h),
      high24h: numberValue(row.high_24h),
      low24h: numberValue(row.low_24h),
      methodology: "reported",
    };
  }

  private supplyRecord(row: CoinGeckoMarket): CryptoAssetRecord {
    return {
      ...this.assetIdentity("supply", row),
      circulatingSupply: numberValue(row.circulating_supply),
      totalSupply: numberValue(row.total_supply),
      maxSupply: numberValue(row.max_supply),
      methodology: "reported",
    };
  }

  private rankingRecord(row: CoinGeckoMarket): CryptoAssetRecord {
    return {
      ...this.assetIdentity("rankings", row),
      marketCapRank: integerValue(row.market_cap_rank),
      methodology: "reported",
    };
  }

  private async categories(query: CryptoAssetDataQuery): Promise<CryptoAssetRecord[]> {
    const rows = await this.get<CoinGeckoCategory[]>("/coins/categories/list");
    return rows
      .filter((row) => !query.category || row.category_id === query.category)
      .slice(0, query.limit ?? 100)
      .map((row) => ({
        ...this.identity("categories"),
        categoryId: row.category_id,
        categoryName: row.name,
        methodology: "reported",
      }));
  }

  private async exchanges(
    assetId: string,
    query: CryptoAssetDataQuery,
  ): Promise<CryptoAssetRecord[]> {
    const data = await this.get<CoinGeckoTickers>(`/coins/${encodeURIComponent(assetId)}/tickers`, {
      page: 1,
      order: "trust_score_desc",
      include_exchange_logo: "false",
    });
    return (data.tickers ?? []).slice(0, query.limit ?? 100).map((row) => ({
      ...this.identity("exchanges"),
      assetId,
      exchangeId: row.market.identifier,
      exchangeName: row.market.name,
      volume24h: numberValue(row.converted_volume?.usd),
      quoteCurrency: "USD",
      trustScore: row.trust_score,
      methodology: "reported",
    }));
  }

  private async trending(limit?: number): Promise<CryptoAssetRecord[]> {
    const data = await this.get<CoinGeckoTrending>("/search/trending");
    return (data.coins ?? []).slice(0, limit ?? 15).map(({ item }) => ({
      ...this.identity("trending"),
      assetId: item.id,
      symbol: item.symbol.toUpperCase(),
      name: item.name,
      marketCapRank: integerValue(item.market_cap_rank),
      score: item.score,
      methodology: "reported",
    }));
  }

  private assetIdentity(
    dataType: CryptoAssetDataType,
    row: CoinGeckoMarket,
    quoteCurrency?: string,
  ) {
    return {
      ...this.identity(dataType, row.last_updated),
      assetId: row.id,
      symbol: row.symbol.toUpperCase(),
      name: row.name,
      quoteCurrency,
    };
  }

  private identity(dataType: CryptoAssetDataType, timestamp?: string) {
    return {
      dataType,
      provider: this.id,
      venue: "aggregate" as const,
      timestamp: timestamp ?? new Date(this.now()).toISOString(),
    };
  }

  private get<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const url = setQuery(new URL(`${API_BASE}${path}`), params);
    return requestJson<T>(this.fetchImpl, url, { headers: { "x-cg-demo-api-key": this.apiKey } });
  }
}

interface CoinGeckoSearch {
  coins?: Array<{ id: string; name: string; symbol: string; market_cap_rank?: number }>;
}
interface CoinGeckoMarket {
  id: string;
  symbol: string;
  name: string;
  current_price?: number;
  market_cap?: number;
  market_cap_rank?: number;
  fully_diluted_valuation?: number;
  total_volume?: number;
  high_24h?: number;
  low_24h?: number;
  price_change_percentage_24h?: number;
  circulating_supply?: number;
  total_supply?: number;
  max_supply?: number;
  last_updated: string;
}
interface CoinGeckoProfile {
  id: string;
  symbol: string;
  name: string;
  description?: { en?: string };
  links?: { homepage?: string[] };
  image?: { large?: string };
  genesis_date?: string | null;
  hashing_algorithm?: string | null;
  categories?: string[];
  platforms?: Record<string, string>;
  last_updated?: string;
}
interface CoinGeckoCategory {
  category_id: string;
  name: string;
}
interface CoinGeckoTickers {
  tickers?: Array<{
    market: { identifier: string; name: string };
    trust_score?: string;
    converted_volume?: { usd?: number };
  }>;
}
interface CoinGeckoTrending {
  coins?: Array<{
    item: { id: string; name: string; symbol: string; market_cap_rank?: number; score: number };
  }>;
}
function requiredAsset(value?: string): string {
  if (!value) throw new CryptoProviderError("INVALID_ARGUMENT", "asset is required.");
  return value;
}
function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function integerValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}
function percentToDecimal(value: unknown): number | undefined {
  const number = numberValue(value);
  return number === undefined ? undefined : number / 100;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
