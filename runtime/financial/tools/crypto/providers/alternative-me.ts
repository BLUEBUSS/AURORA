import { CryptoProviderError } from "../errors.js";
import type { CryptoSentimentProvider } from "../provider.js";
import type {
  CryptoSentimentDataQuery,
  CryptoSentimentDataResult,
  CryptoSentimentRecord,
} from "../types.js";
import { createCryptoFetch, requestJson, setQuery, type CryptoFetch } from "./http.js";

const API_URL = "https://api.alternative.me/fng/";

interface AlternativeMeOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
}

interface FearGreedResponse {
  name?: string;
  data?: Array<{
    value: string;
    value_classification: string;
    timestamp: string;
    time_until_update?: string;
  }>;
}

export class AlternativeMeSentimentProvider implements CryptoSentimentProvider {
  readonly id = "alternative_me";
  private readonly fetchImpl: CryptoFetch;

  constructor(options: AlternativeMeOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
  }

  async getSentimentData(query: CryptoSentimentDataQuery): Promise<CryptoSentimentDataResult> {
    if (query.dataTypes.length !== 1 || query.dataTypes[0] !== "fear_greed") {
      throw new CryptoProviderError("INVALID_ARGUMENT", "Alternative.me provides only fear_greed.");
    }
    const url = setQuery(new URL(API_URL), {
      limit: query.limit ?? 1,
      format: "json",
    });
    const data = await requestJson<FearGreedResponse>(this.fetchImpl, url);
    const records: CryptoSentimentRecord[] = (data.data ?? []).map((item) => ({
      dataType: "fear_greed",
      provider: this.id,
      venue: "aggregate",
      timestamp: new Date(Number(item.timestamp) * 1_000).toISOString(),
      signalType: "bitcoin_market_sentiment_proxy",
      value: Number(item.value),
      unit: "index_points",
      classification: item.value_classification,
      marketScope: "bitcoin_market_proxy",
      attribution: "Alternative.me Fear and Greed Index",
      methodology: "reported",
    }));
    return {
      status: "complete",
      sections: [{ dataType: "fear_greed", status: "complete", records }],
    };
  }
}
