import { CryptoProviderError } from "../errors.js";
import type { CryptoOnchainProvider } from "../provider.js";
import type {
  CryptoOnchainDataQuery,
  CryptoOnchainDataResult,
  CryptoOnchainRecord,
} from "../types.js";
import { createCryptoFetch, requestJson, setQuery, type CryptoFetch } from "./http.js";

const API_BASE = "https://api.dune.com";

interface DuneOptions {
  apiKey: string;
  allowedQueryIds: Iterable<number>;
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  now?: () => number;
}

interface DuneLatestResult {
  execution_id?: string;
  query_id?: number;
  result?: {
    metadata?: { column_names?: string[] };
    rows?: Array<Record<string, unknown>>;
  };
}

export class DuneCryptoProvider implements CryptoOnchainProvider {
  readonly id = "dune";
  private readonly apiKey: string;
  private readonly allowedQueryIds: Set<number>;
  private readonly fetchImpl: CryptoFetch;
  private readonly now: () => number;

  constructor(options: DuneOptions) {
    this.apiKey = options.apiKey;
    this.allowedQueryIds = new Set(options.allowedQueryIds);
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.now = options.now ?? Date.now;
  }

  async getOnchainData(query: CryptoOnchainDataQuery): Promise<CryptoOnchainDataResult> {
    if (query.dataTypes.length !== 1 || query.dataTypes[0] !== "saved_query" || !query.queryId) {
      throw new CryptoProviderError(
        "INVALID_ARGUMENT",
        "Dune accepts one saved_query with query_id.",
      );
    }
    if (!this.allowedQueryIds.has(query.queryId)) {
      throw new CryptoProviderError(
        "INVALID_ARGUMENT",
        `Dune query ${query.queryId} is not in DUNE_SAVED_QUERY_IDS.`,
      );
    }
    const url = setQuery(new URL(`/api/v1/query/${query.queryId}/results`, API_BASE), {
      limit: Math.min(query.limit ?? 100, 1_000),
    });
    const data = await requestJson<DuneLatestResult>(this.fetchImpl, url, {
      headers: { "X-Dune-API-Key": this.apiKey },
    });
    const records: CryptoOnchainRecord[] = (data.result?.rows ?? []).map((row) => ({
      dataType: "saved_query",
      chain: query.chain,
      network: query.chain,
      provider: this.id,
      timestamp: new Date(this.now()).toISOString(),
      queryId: query.queryId,
      executionId: data.execution_id,
      columns: data.result?.metadata?.column_names,
      row,
      methodology: "reported",
    }));
    return {
      status: "complete",
      sections: [{ dataType: "saved_query", status: "complete", records }],
    };
  }
}
