import { CryptoProviderError } from "./errors.js";
import { normalizeChain, normalizeTimestamp } from "./normalize.js";
import type { CryptoOnchainDataInput } from "./schemas.js";
import type {
  CryptoOnchainDataQuery,
  CryptoOnchainDataResult,
  CryptoOnchainDataType,
  CryptoOnchainRecord,
} from "./types.js";

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const EVM_CHAINS = new Set(["ethereum", "polygon", "arbitrum"]);
const ADDRESS_DATA_TYPES = new Set<CryptoOnchainDataType>(["address_activity", "token_transfers"]);
const BITCOIN_DATA_TYPES = new Set<CryptoOnchainDataType>(["network_metrics", "blocks", "mempool"]);

const ONCHAIN_BUNDLE_DATA_TYPES = {
  evm_address_overview: ["address_activity", "token_transfers"],
  bitcoin_network_overview: ["network_metrics", "gas_fees", "blocks", "mempool"],
} as const satisfies Record<string, readonly CryptoOnchainDataType[]>;

export function normalizeOnchainDataInput(input: CryptoOnchainDataInput): CryptoOnchainDataQuery {
  requireSingleSelection(input.data_type, input.bundle);
  const dataTypes = input.data_type
    ? [input.data_type]
    : [...ONCHAIN_BUNDLE_DATA_TYPES[input.bundle!]];
  const chain = normalizeOnchainChain(input.chain);
  const provider = input.provider ?? "auto";
  const address = normalizeAddress(input.address, chain, "address");
  const contractAddress = normalizeAddress(input.contract_address, chain, "contract_address");

  validateProvider(provider, chain, dataTypes);
  validateDataRequirements(input, chain, dataTypes, address, contractAddress);

  return {
    dataTypes,
    provider,
    chain,
    address,
    contractAddress,
    fromBlock: input.from_block,
    toBlock: input.to_block,
    topic0: input.topic0?.toLowerCase(),
    queryId: input.query_id,
    limit: input.limit,
  };
}

export function normalizeOnchainProviderResult(
  result: CryptoOnchainDataResult,
  query: CryptoOnchainDataQuery,
  providerId: string,
): CryptoOnchainDataResult {
  const sections = result.sections.map((section) => ({
    ...section,
    records: section.records.map((record) =>
      normalizeRecord(record, query, section.dataType, providerId),
    ),
  }));
  const issues = [...(result.issues ?? []), ...sections.flatMap((section) => section.issues ?? [])];
  const partial =
    result.status === "partial" || sections.some((section) => section.status === "partial");
  if (partial && !issues.some((issue) => issue.code === "PARTIAL_DATA")) {
    throw new CryptoProviderError(
      "UPSTREAM_ERROR",
      "Partial on-chain results must include a PARTIAL_DATA issue.",
    );
  }
  return { ...result, sections };
}

function normalizeRecord(
  record: CryptoOnchainRecord,
  query: CryptoOnchainDataQuery,
  dataType: CryptoOnchainDataType,
  providerId: string,
): CryptoOnchainRecord {
  const chain = normalizeOnchainChain(record.chain);
  const normalized = {
    ...record,
    chain,
    network: normalizeOnchainChain(record.network),
    provider: record.provider || providerId,
    timestamp: normalizeTimestamp(record.timestamp),
    address: normalizeAddress(record.address, chain, "address"),
    contractAddress: normalizeAddress(record.contractAddress, chain, "contractAddress"),
    fromAddress: normalizeAddress(record.fromAddress, chain, "fromAddress"),
    toAddress: normalizeAddress(record.toAddress, chain, "toAddress"),
  };
  if (
    normalized.dataType !== dataType ||
    normalized.chain !== query.chain ||
    (query.address && normalized.address && normalized.address !== query.address) ||
    (query.queryId && normalized.queryId && normalized.queryId !== query.queryId)
  ) {
    throw new CryptoProviderError(
      "UPSTREAM_ERROR",
      "On-chain provider returned mismatched identity.",
    );
  }
  return normalized;
}

function validateProvider(
  provider: CryptoOnchainDataQuery["provider"],
  chain: string,
  dataTypes: CryptoOnchainDataType[],
): void {
  if (provider === "etherscan" && !EVM_CHAINS.has(chain)) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "Etherscan supports approved free EVM chains only.",
    );
  }
  if (provider === "mempool" && chain !== "bitcoin") {
    throw new CryptoProviderError("INVALID_ARGUMENT", "mempool.space supports Bitcoin only.");
  }
  if (provider === "dune" && (dataTypes.length !== 1 || dataTypes[0] !== "saved_query")) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "Dune runtime access is limited to saved_query.",
    );
  }
}

function validateDataRequirements(
  input: CryptoOnchainDataInput,
  chain: string,
  dataTypes: CryptoOnchainDataType[],
  address: string | undefined,
  contractAddress: string | undefined,
): void {
  if (dataTypes.some((dataType) => ADDRESS_DATA_TYPES.has(dataType)) && !address) {
    throw new CryptoProviderError("INVALID_ARGUMENT", "address is required for address activity.");
  }
  if (input.bundle === "evm_address_overview" && !EVM_CHAINS.has(chain)) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "evm_address_overview requires an approved EVM chain.",
    );
  }
  if (input.bundle === "bitcoin_network_overview" && chain !== "bitcoin") {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "bitcoin_network_overview requires chain=bitcoin.",
    );
  }
  if (dataTypes.some((dataType) => BITCOIN_DATA_TYPES.has(dataType)) && chain !== "bitcoin") {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "This section is currently available for Bitcoin only.",
    );
  }
  if (dataTypes.includes("logs")) {
    if (
      !EVM_CHAINS.has(chain) ||
      !contractAddress ||
      input.from_block === undefined ||
      input.to_block === undefined
    ) {
      throw new CryptoProviderError(
        "INVALID_ARGUMENT",
        "logs require an approved EVM chain, contract_address, from_block, and to_block.",
      );
    }
  }
  if (
    input.from_block !== undefined &&
    input.to_block !== undefined &&
    input.from_block > input.to_block
  ) {
    throw new CryptoProviderError("INVALID_ARGUMENT", "from_block must not exceed to_block.");
  }
  if (dataTypes.includes("saved_query") && !input.query_id) {
    throw new CryptoProviderError("INVALID_ARGUMENT", "query_id is required for saved_query.");
  }
  if (!dataTypes.includes("saved_query") && input.query_id !== undefined) {
    throw new CryptoProviderError("INVALID_ARGUMENT", "query_id is only valid for saved_query.");
  }
}

function normalizeOnchainChain(value: string): string {
  const normalized = normalizeChain(value);
  return normalized === "btc" ? "bitcoin" : normalized;
}

function normalizeAddress(
  value: string | undefined,
  chain: string,
  field: string,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (EVM_CHAINS.has(chain)) {
    if (!EVM_ADDRESS_PATTERN.test(trimmed)) {
      throw new CryptoProviderError("INVALID_ARGUMENT", `${field} must be a 20-byte EVM address.`);
    }
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function requireSingleSelection(dataType?: string, bundle?: string): void {
  if ((!dataType && !bundle) || (dataType && bundle)) {
    throw new CryptoProviderError(
      "INVALID_ARGUMENT",
      "Provide exactly one of data_type or bundle.",
    );
  }
}
