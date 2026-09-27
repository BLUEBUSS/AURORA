import { CryptoProviderError } from "../errors.js";
import { normalizeChain } from "../normalize.js";
import type { CryptoSentimentProvider } from "../provider.js";
import type {
  CryptoProviderSection,
  CryptoSentimentDataQuery,
  CryptoSentimentDataResult,
  CryptoSentimentDataType,
  CryptoSentimentRecord,
} from "../types.js";
import { createCryptoFetch, requestJson, type CryptoFetch } from "./http.js";

const API_BASE = "https://api.dexscreener.com";

interface DexScreenerSentimentOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  now?: () => number;
}

interface TokenSignal {
  url?: string;
  chainId: string;
  tokenAddress: string;
  description?: string;
  amount?: number;
  totalAmount?: number;
}

type SentimentSection = CryptoProviderSection<CryptoSentimentDataType, CryptoSentimentRecord>;

export class DexScreenerSentimentProvider implements CryptoSentimentProvider {
  readonly id = "dexscreener";
  private readonly fetchImpl: CryptoFetch;
  private readonly now: () => number;

  constructor(options: DexScreenerSentimentOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.now = options.now ?? Date.now;
  }

  async getSentimentData(query: CryptoSentimentDataQuery): Promise<CryptoSentimentDataResult> {
    if (query.dataTypes.some((item) => item !== "new_tokens" && item !== "promotion_activity")) {
      throw new CryptoProviderError(
        "INVALID_ARGUMENT",
        "DEX Screener provides only new_tokens and promotion_activity.",
      );
    }
    const sections: SentimentSection[] = [];
    for (const dataType of query.dataTypes) {
      try {
        sections.push({
          dataType,
          status: "complete",
          records: await this.load(dataType, query),
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
        ? [{ code: "PARTIAL_DATA", message: "Some DEX Screener discovery sections failed." }]
        : undefined,
    };
  }

  private async load(
    dataType: CryptoSentimentDataType,
    query: CryptoSentimentDataQuery,
  ): Promise<CryptoSentimentRecord[]> {
    const path =
      dataType === "new_tokens" ? "/token-profiles/latest/v1" : "/token-boosts/latest/v1";
    const rows = await requestJson<TokenSignal[]>(this.fetchImpl, new URL(path, API_BASE));
    return rows
      .filter((row) => !query.chain || normalizeChain(row.chainId) === query.chain)
      .slice(0, query.limit ?? 100)
      .map((row) => this.record(dataType, row));
  }

  private record(dataType: CryptoSentimentDataType, row: TokenSignal): CryptoSentimentRecord {
    const promotion = dataType === "promotion_activity";
    return {
      dataType,
      provider: this.id,
      venue: "aggregate",
      timestamp: new Date(this.now()).toISOString(),
      signalType: promotion ? "paid_promotion_activity" : "dex_profile_recency",
      chain: normalizeChain(row.chainId),
      tokenAddress: row.tokenAddress,
      url: row.url,
      description: row.description,
      promotionType: promotion ? "boost" : undefined,
      amount: row.amount,
      totalAmount: row.totalAmount,
      marketScope: promotion ? "dexscreener_paid_visibility" : "dexscreener_profile_feed",
      attribution: "DEX Screener",
      methodology: "reported",
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
