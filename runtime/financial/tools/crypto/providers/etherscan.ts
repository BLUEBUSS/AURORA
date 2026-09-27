import { CryptoProviderError } from "../errors.js";
import type { CryptoOnchainProvider } from "../provider.js";
import type {
  CryptoOnchainDataQuery,
  CryptoOnchainDataResult,
  CryptoOnchainDataType,
  CryptoOnchainRecord,
  CryptoProviderSection,
} from "../types.js";
import { createCryptoFetch, requestJson, setQuery, type CryptoFetch } from "./http.js";

const API_BASE = "https://api.etherscan.io/v2/api";
const FREE_CHAIN_IDS: Record<string, string> = {
  ethereum: "1",
  polygon: "137",
  arbitrum: "42161",
};
const NATIVE_UNITS: Record<string, string> = {
  ethereum: "ETH",
  polygon: "POL",
  arbitrum: "ETH",
};

interface EtherscanOptions {
  apiKey: string;
  fetchImpl?: CryptoFetch;
  proxyUrl?: string;
  now?: () => number;
}

interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

type OnchainSection = CryptoProviderSection<CryptoOnchainDataType, CryptoOnchainRecord>;

export class EtherscanCryptoProvider implements CryptoOnchainProvider {
  readonly id = "etherscan";
  private readonly apiKey: string;
  private readonly fetchImpl: CryptoFetch;
  private readonly now: () => number;

  constructor(options: EtherscanOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? createCryptoFetch({ proxyUrl: options.proxyUrl });
    this.now = options.now ?? Date.now;
  }

  async getOnchainData(query: CryptoOnchainDataQuery): Promise<CryptoOnchainDataResult> {
    this.chainId(query.chain);
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
        ? [{ code: "PARTIAL_DATA", message: "Some Etherscan sections failed." }]
        : undefined,
    };
  }

  private load(dataType: CryptoOnchainDataType, query: CryptoOnchainDataQuery) {
    switch (dataType) {
      case "address_activity":
        return this.transactions(query);
      case "token_transfers":
        return this.tokenTransfers(query);
      case "logs":
        return this.logs(query);
      case "gas_fees":
        return this.gasFees(query);
      default:
        throw new CryptoProviderError(
          "INVALID_ARGUMENT",
          `${dataType} is not supported by the Etherscan provider.`,
        );
    }
  }

  private async transactions(query: CryptoOnchainDataQuery): Promise<CryptoOnchainRecord[]> {
    if (!query.address) throw new CryptoProviderError("INVALID_ARGUMENT", "address is required.");
    const rows = await this.get<EtherscanTransaction[]>(query, {
      module: "account",
      action: "txlist",
      address: query.address,
      startblock: query.fromBlock ?? 0,
      endblock: query.toBlock ?? 99_999_999,
      page: 1,
      offset: cappedLimit(query.limit),
      sort: "desc",
    });
    return rows.map((row) => {
      const gasFee = (numeric(row.gasPrice) * numeric(row.gasUsed)) / 1e18;
      return {
        ...this.identity("address_activity", query.chain, row.timeStamp),
        address: query.address,
        transactionHash: row.hash,
        blockNumber: integer(row.blockNumber),
        fromAddress: lower(row.from),
        toAddress: lower(row.to),
        direction: direction(query.address!, row.from, row.to),
        value: numeric(row.value) / 1e18,
        unit: NATIVE_UNITS[query.chain],
        fee: gasFee,
        feeUnit: NATIVE_UNITS[query.chain],
        success: row.isError === "0",
        methodology: "reported",
      };
    });
  }

  private async tokenTransfers(query: CryptoOnchainDataQuery): Promise<CryptoOnchainRecord[]> {
    if (!query.address) throw new CryptoProviderError("INVALID_ARGUMENT", "address is required.");
    const rows = await this.get<EtherscanTokenTransfer[]>(query, {
      module: "account",
      action: "tokentx",
      address: query.address,
      contractaddress: query.contractAddress,
      startblock: query.fromBlock ?? 0,
      endblock: query.toBlock ?? 99_999_999,
      page: 1,
      offset: cappedLimit(query.limit),
      sort: "desc",
    });
    return rows.map((row) => {
      const decimals = integer(row.tokenDecimal);
      return {
        ...this.identity("token_transfers", query.chain, row.timeStamp),
        address: query.address,
        contractAddress: lower(row.contractAddress),
        transactionHash: row.hash,
        blockNumber: integer(row.blockNumber),
        fromAddress: lower(row.from),
        toAddress: lower(row.to),
        direction: direction(query.address!, row.from, row.to),
        value: numeric(row.value) / 10 ** decimals,
        unit: row.tokenSymbol,
        tokenSymbol: row.tokenSymbol,
        tokenName: row.tokenName,
        tokenDecimals: decimals,
        methodology: "reported",
      };
    });
  }

  private async logs(query: CryptoOnchainDataQuery): Promise<CryptoOnchainRecord[]> {
    if (!query.contractAddress || query.fromBlock === undefined || query.toBlock === undefined) {
      throw new CryptoProviderError("INVALID_ARGUMENT", "logs require contract and block range.");
    }
    const rows = await this.get<EtherscanLog[]>(query, {
      module: "logs",
      action: "getLogs",
      address: query.contractAddress,
      fromBlock: query.fromBlock,
      toBlock: query.toBlock,
      topic0: query.topic0,
      page: 1,
      offset: cappedLimit(query.limit),
    });
    return rows.map((row) => ({
      ...this.identity("logs", query.chain, row.timeStamp),
      contractAddress: lower(row.address),
      transactionHash: row.transactionHash,
      blockNumber: integer(row.blockNumber),
      topics: row.topics,
      logData: row.data,
      methodology: "reported",
    }));
  }

  private async gasFees(query: CryptoOnchainDataQuery): Promise<CryptoOnchainRecord[]> {
    const result = await this.get<EtherscanGasOracle>(query, {
      module: "gastracker",
      action: "gasoracle",
    });
    return [
      ["safe_gas_price", result.SafeGasPrice],
      ["propose_gas_price", result.ProposeGasPrice],
      ["fast_gas_price", result.FastGasPrice],
      ["base_fee", result.suggestBaseFee],
    ].map(([metric, value]) => ({
      ...this.identity("gas_fees", query.chain),
      metric,
      metricValue: numeric(value),
      unit: "gwei",
      methodology: "reported",
    }));
  }

  private async get<T>(
    query: CryptoOnchainDataQuery,
    params: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = setQuery(new URL(API_BASE), {
      chainid: this.chainId(query.chain),
      apikey: this.apiKey,
      ...params,
    });
    const response = await requestJson<EtherscanResponse<T>>(this.fetchImpl, url);
    if (response.status === "1") return response.result;
    const message = `${response.message} ${String(response.result)}`.trim();
    if (/no transactions|no records|no logs/i.test(message)) return [] as T;
    if (/api key|unauthorized|invalid key/i.test(message)) {
      throw new CryptoProviderError("AUTHENTICATION_FAILED", "Etherscan rejected the API key.");
    }
    if (/rate limit|max rate/i.test(message)) {
      throw new CryptoProviderError("RATE_LIMITED", "Etherscan rate limit exceeded.");
    }
    throw new CryptoProviderError("UPSTREAM_ERROR", `Etherscan error: ${message}`);
  }

  private identity(dataType: CryptoOnchainDataType, chain: string, timestamp?: string) {
    const epoch = timestamp === undefined ? this.now() : integer(timestamp) * 1_000;
    return {
      dataType,
      chain,
      network: chain,
      provider: this.id,
      timestamp: new Date(epoch).toISOString(),
    };
  }

  private chainId(chain: string): string {
    const chainId = FREE_CHAIN_IDS[chain];
    if (!chainId) {
      throw new CryptoProviderError(
        "INVALID_ARGUMENT",
        `${chain} is not enabled on the approved Etherscan free tier.`,
      );
    }
    return chainId;
  }
}

interface EtherscanTransaction {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  gasPrice: string;
  gasUsed: string;
  isError: string;
}
interface EtherscanTokenTransfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  contractAddress: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
}
interface EtherscanLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  timeStamp: string;
  transactionHash: string;
}
interface EtherscanGasOracle {
  SafeGasPrice: string;
  ProposeGasPrice: string;
  FastGasPrice: string;
  suggestBaseFee: string;
}

function cappedLimit(value?: number): number {
  return Math.min(value ?? 100, 1_000);
}
function numeric(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}
function integer(value: string): number {
  return value.startsWith("0x") ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value, 10);
}
function lower(value: string): string {
  return value.toLowerCase();
}
function direction(address: string, from: string, to: string): CryptoOnchainRecord["direction"] {
  const target = address.toLowerCase();
  const isFrom = from.toLowerCase() === target;
  const isTo = to.toLowerCase() === target;
  if (isFrom && isTo) return "self";
  if (isFrom) return "out";
  if (isTo) return "in";
  return "unknown";
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
