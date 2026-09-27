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

const API_BASE = "https://api.coinpaprika.com/v1";
const UNSUPPORTED = new Set<CryptoAssetDataType>(["categories", "trending"]);

interface CoinPaprikaOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  now?: () => number;
}
type AssetSection = CryptoProviderSection<CryptoAssetDataType, CryptoAssetRecord>;

export class CoinPaprikaCryptoProvider implements CryptoAssetProvider {
  readonly id = "coinpaprika";
  private readonly fetchImpl: CryptoFetch;
  private readonly now: () => number;

  constructor(options: CoinPaprikaOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.now = options.now ?? Date.now;
  }

  async getAssetData(query: CryptoAssetDataQuery): Promise<CryptoAssetDataResult> {
    if (query.dataTypes.some((item) => UNSUPPORTED.has(item))) {
      throw new CryptoProviderError(
        "INVALID_ARGUMENT",
        "CoinPaprika does not support approved categories or trending sections.",
      );
    }
    const assetId = query.asset ? await this.resolveAsset(query.asset) : undefined;
    const needsTicker = query.dataTypes.some((item) =>
      ["market_snapshot", "supply", "rankings"].includes(item),
    );
    const tickerRows = needsTicker ? await this.tickers(query, assetId) : [];
    const sections: AssetSection[] = [];
    for (const dataType of query.dataTypes) {
      try {
        sections.push({
          dataType,
          status: "complete",
          records: await this.load(dataType, query, assetId, tickerRows),
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
        ? [{ code: "PARTIAL_DATA", message: "Some CoinPaprika sections failed." }]
        : undefined,
    };
  }

  private load(
    dataType: CryptoAssetDataType,
    query: CryptoAssetDataQuery,
    assetId: string | undefined,
    rows: PaprikaTicker[],
  ) {
    switch (dataType) {
      case "profile":
        return this.profile(requiredAsset(assetId));
      case "market_snapshot":
        return rows.map((row) => this.marketRecord(row, query.quoteCurrency));
      case "supply":
        return rows.map((row) => this.supplyRecord(row));
      case "rankings":
        return rows.map((row) => this.rankingRecord(row));
      case "exchanges":
        return this.exchanges(requiredAsset(assetId), query);
      case "categories":
      case "trending":
        throw new CryptoProviderError(
          "INVALID_ARGUMENT",
          `${dataType} is unsupported by CoinPaprika.`,
        );
    }
  }

  private async resolveAsset(asset: string): Promise<string> {
    const data = await this.get<PaprikaSearch>("/search", { q: asset, c: "currencies", limit: 20 });
    const target = asset.toLowerCase();
    const match =
      (data.currencies ?? []).find(
        (item) =>
          item.id.toLowerCase() === target ||
          item.symbol.toLowerCase() === target ||
          item.name.toLowerCase() === target,
      ) ?? data.currencies?.[0];
    if (!match) throw new CryptoProviderError("NO_DATA", `CoinPaprika could not resolve ${asset}.`);
    return match.id;
  }

  private tickers(query: CryptoAssetDataQuery, assetId?: string): Promise<PaprikaTicker[]> {
    if (assetId)
      return this.get<PaprikaTicker>(`/tickers/${encodeURIComponent(assetId)}`, {
        quotes: query.quoteCurrency,
      }).then((row) => [row]);
    return this.get<PaprikaTicker[]>("/tickers", {
      quotes: query.quoteCurrency,
      limit: query.limit ?? 100,
    });
  }

  private async profile(assetId: string): Promise<CryptoAssetRecord[]> {
    const row = await this.get<PaprikaProfile>(`/coins/${encodeURIComponent(assetId)}`);
    return [
      {
        ...this.identity("profile"),
        assetId: row.id,
        symbol: row.symbol.toUpperCase(),
        name: row.name,
        description: row.description,
        homepage: row.links?.website?.find(Boolean),
        genesisDate: row.started_at,
        categories: row.tags?.map((tag) => tag.name),
        proofType: row.proof_type,
        openSource: row.open_source,
        methodology: "reported",
      },
    ];
  }

  private marketRecord(row: PaprikaTicker, quote: string): CryptoAssetRecord {
    const data = row.quotes?.[quote];
    return {
      ...this.assetIdentity("market_snapshot", row, quote),
      price: numberValue(data?.price),
      marketCap: numberValue(data?.market_cap),
      volume24h: numberValue(data?.volume_24h),
      change24h: percentToDecimal(data?.percent_change_24h),
      methodology: "reported",
    };
  }

  private supplyRecord(row: PaprikaTicker): CryptoAssetRecord {
    return {
      ...this.assetIdentity("supply", row),
      circulatingSupply: numberValue(row.circulating_supply),
      totalSupply: numberValue(row.total_supply),
      maxSupply: numberValue(row.max_supply),
      methodology: "reported",
    };
  }

  private rankingRecord(row: PaprikaTicker): CryptoAssetRecord {
    return {
      ...this.assetIdentity("rankings", row),
      marketCapRank: row.rank,
      methodology: "reported",
    };
  }

  private async exchanges(
    assetId: string,
    query: CryptoAssetDataQuery,
  ): Promise<CryptoAssetRecord[]> {
    const rows = await this.get<PaprikaExchange[]>(
      `/coins/${encodeURIComponent(assetId)}/exchanges`,
    );
    return rows.slice(0, query.limit ?? 100).map((row) => ({
      ...this.identity("exchanges"),
      assetId,
      exchangeId: row.id,
      exchangeName: row.name,
      volume24h: numberValue(row.quotes?.[query.quoteCurrency]?.adjusted_volume_24h),
      quoteCurrency: query.quoteCurrency,
      score: numberValue(row.adjusted_volume_24h_share),
      methodology: "reported",
    }));
  }

  private assetIdentity(dataType: CryptoAssetDataType, row: PaprikaTicker, quoteCurrency?: string) {
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
    return requestJson<T>(this.fetchImpl, setQuery(new URL(`${API_BASE}${path}`), params));
  }
}

interface PaprikaSearch {
  currencies?: Array<{
    id: string;
    name: string;
    symbol: string;
    rank: number;
    is_active: boolean;
  }>;
}
interface PaprikaQuote {
  price?: number;
  volume_24h?: number;
  market_cap?: number;
  percent_change_24h?: number;
}
interface PaprikaTicker {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  circulating_supply?: number;
  total_supply?: number;
  max_supply?: number;
  last_updated: string;
  quotes?: Record<string, PaprikaQuote>;
}
interface PaprikaProfile {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  started_at?: string;
  open_source?: boolean;
  proof_type?: string;
  links?: { website?: string[] };
  tags?: Array<{ id: string; name: string }>;
}
interface PaprikaExchange {
  id: string;
  name: string;
  adjusted_volume_24h_share?: number;
  quotes?: Record<string, { adjusted_volume_24h?: number }>;
}
function requiredAsset(value?: string): string {
  if (!value) throw new CryptoProviderError("INVALID_ARGUMENT", "asset is required.");
  return value;
}
function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function percentToDecimal(value: unknown): number | undefined {
  const number = numberValue(value);
  return number === undefined ? undefined : number / 100;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
