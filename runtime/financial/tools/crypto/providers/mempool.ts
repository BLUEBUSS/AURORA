import { CryptoProviderError } from "../errors.js";
import type { CryptoOnchainProvider } from "../provider.js";
import type {
  CryptoOnchainDataQuery,
  CryptoOnchainDataResult,
  CryptoOnchainDataType,
  CryptoOnchainRecord,
  CryptoProviderSection,
} from "../types.js";
import { createCryptoFetch, requestJson, type CryptoFetch } from "./http.js";

const API_BASE = "https://mempool.space";

interface MempoolOptions {
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  now?: () => number;
}

type OnchainSection = CryptoProviderSection<CryptoOnchainDataType, CryptoOnchainRecord>;

export class MempoolCryptoProvider implements CryptoOnchainProvider {
  readonly id = "mempool";
  private readonly fetchImpl: CryptoFetch;
  private readonly now: () => number;

  constructor(options: MempoolOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.now = options.now ?? Date.now;
  }

  async getOnchainData(query: CryptoOnchainDataQuery): Promise<CryptoOnchainDataResult> {
    if (query.chain !== "bitcoin") {
      throw new CryptoProviderError("INVALID_ARGUMENT", "mempool.space supports Bitcoin only.");
    }
    const sections: OnchainSection[] = [];
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
        ? [{ code: "PARTIAL_DATA", message: "Some mempool.space sections failed." }]
        : undefined,
    };
  }

  private load(dataType: CryptoOnchainDataType, query: CryptoOnchainDataQuery) {
    switch (dataType) {
      case "network_metrics":
        return this.networkMetrics();
      case "gas_fees":
        return this.fees();
      case "blocks":
        return this.blocks(query.limit);
      case "mempool":
        return this.recentMempool(query.limit);
      case "address_activity":
        return this.addressActivity(query.address);
      default:
        throw new CryptoProviderError(
          "INVALID_ARGUMENT",
          `${dataType} is not supported by mempool.space.`,
        );
    }
  }

  private async networkMetrics(): Promise<CryptoOnchainRecord[]> {
    const data = await this.get<MempoolSummary>("/api/mempool");
    return [
      this.metric("network_metrics", "transaction_count", data.count, "count"),
      this.metric("network_metrics", "virtual_size", data.vsize, "vbytes"),
      this.metric("network_metrics", "total_fee", data.total_fee, "sats"),
    ];
  }

  private async fees(): Promise<CryptoOnchainRecord[]> {
    const data = await this.get<RecommendedFees>("/api/v1/fees/recommended");
    return [
      ["fastest_fee", data.fastestFee],
      ["half_hour_fee", data.halfHourFee],
      ["hour_fee", data.hourFee],
      ["economy_fee", data.economyFee],
      ["minimum_fee", data.minimumFee],
    ].map(([name, value]) => this.metric("gas_fees", String(name), Number(value), "sat/vB"));
  }

  private async blocks(limit?: number): Promise<CryptoOnchainRecord[]> {
    const rows = await this.get<MempoolBlock[]>("/api/v1/blocks");
    return rows.slice(0, limit ?? 10).map((row) => ({
      ...this.identity("blocks", row.timestamp * 1_000),
      blockHash: row.id,
      blockNumber: row.height,
      metric: "transaction_count",
      metricValue: row.tx_count,
      unit: "count",
      blockSize: row.size,
      blockWeight: row.weight,
      methodology: "reported",
    }));
  }

  private async recentMempool(limit?: number): Promise<CryptoOnchainRecord[]> {
    const rows = await this.get<MempoolTransaction[]>("/api/mempool/recent");
    return rows.slice(0, limit ?? 10).map((row) => ({
      ...this.identity("mempool"),
      transactionHash: row.txid,
      value: row.value,
      unit: "sats",
      fee: row.fee,
      feeUnit: "sats",
      virtualSize: row.vsize,
      methodology: "reported",
    }));
  }

  private async addressActivity(address?: string): Promise<CryptoOnchainRecord[]> {
    if (!address) throw new CryptoProviderError("INVALID_ARGUMENT", "address is required.");
    const data = await this.get<AddressSummary>(`/api/address/${encodeURIComponent(address)}`);
    const confirmedBalance = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
    const mempoolBalance = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
    return [
      this.metric("address_activity", "confirmed_balance", confirmedBalance, "sats", address),
      this.metric(
        "address_activity",
        "confirmed_transaction_count",
        data.chain_stats.tx_count,
        "count",
        address,
      ),
      this.metric("address_activity", "mempool_balance", mempoolBalance, "sats", address),
      this.metric(
        "address_activity",
        "mempool_transaction_count",
        data.mempool_stats.tx_count,
        "count",
        address,
      ),
    ];
  }

  private metric(
    dataType: CryptoOnchainDataType,
    metric: string,
    metricValue: number,
    unit: string,
    address?: string,
  ): CryptoOnchainRecord {
    return {
      ...this.identity(dataType),
      address,
      metric,
      metricValue,
      unit,
      methodology: "reported",
    };
  }

  private identity(dataType: CryptoOnchainDataType, timestamp = this.now()) {
    return {
      dataType,
      chain: "bitcoin",
      network: "bitcoin",
      provider: this.id,
      timestamp: new Date(timestamp).toISOString(),
    };
  }

  private get<T>(path: string): Promise<T> {
    return requestJson<T>(this.fetchImpl, new URL(path, API_BASE));
  }
}

interface MempoolSummary {
  count: number;
  vsize: number;
  total_fee: number;
}
interface RecommendedFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}
interface MempoolBlock {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
}
interface MempoolTransaction {
  txid: string;
  fee: number;
  vsize: number;
  value: number;
}
interface AddressStats {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
}
interface AddressSummary {
  address: string;
  chain_stats: AddressStats;
  mempool_stats: AddressStats;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
