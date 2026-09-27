import { CryptoProviderError } from "../errors.js";
import type { CryptoSentimentProvider } from "../provider.js";
import type {
  CryptoSentimentDataQuery,
  CryptoSentimentDataResult,
  CryptoSentimentRecord,
} from "../types.js";
import { createCryptoFetch, requestJson, type CryptoFetch } from "./http.js";

const API_URL = "https://api.coingecko.com/api/v3/search/trending";

interface CoinGeckoSentimentOptions {
  apiKey: string;
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  now?: () => number;
}

interface TrendingResponse {
  coins?: Array<{
    item: {
      id: string;
      name: string;
      symbol: string;
      market_cap_rank?: number;
      score: number;
    };
  }>;
}

export class CoinGeckoSentimentProvider implements CryptoSentimentProvider {
  readonly id = "coingecko";
  private readonly apiKey: string;
  private readonly fetchImpl: CryptoFetch;
  private readonly now: () => number;

  constructor(options: CoinGeckoSentimentOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.now = options.now ?? Date.now;
  }

  async getSentimentData(query: CryptoSentimentDataQuery): Promise<CryptoSentimentDataResult> {
    if (query.dataTypes.length !== 1 || query.dataTypes[0] !== "trending") {
      throw new CryptoProviderError("INVALID_ARGUMENT", "CoinGecko provides only trending here.");
    }
    const data = await requestJson<TrendingResponse>(this.fetchImpl, new URL(API_URL), {
      headers: { "x-cg-demo-api-key": this.apiKey },
    });
    const records: CryptoSentimentRecord[] = (data.coins ?? [])
      .slice(0, query.limit ?? 15)
      .map(({ item }) => ({
        dataType: "trending",
        provider: this.id,
        venue: "aggregate",
        timestamp: new Date(this.now()).toISOString(),
        signalType: "coingecko_search_interest",
        assetId: item.id,
        symbol: item.symbol.toUpperCase(),
        name: item.name,
        marketCapRank: item.market_cap_rank,
        score: item.score,
        marketScope: "coingecko_search_users",
        attribution: "CoinGecko",
        methodology: "reported",
      }));
    return {
      status: "complete",
      sections: [{ dataType: "trending", status: "complete", records }],
    };
  }
}
