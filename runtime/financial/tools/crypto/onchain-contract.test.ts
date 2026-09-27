import Ajv from "ajv";
import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { describe, expect, it, vi } from "vitest";
import { popRawRecords } from "../../raw-data-stash.js";
import {
  CryptoOnchainDataInputSchema,
  createCryptoOnchainDataTool,
  type CryptoOnchainDataQuery,
  type CryptoOnchainDataResult,
  type CryptoOnchainProvider,
  type CryptoOnchainRecord,
} from "./index.js";

const ajv = new Ajv.default({ allErrors: true, strict: false });
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const api = { logger } as unknown as AgentToolApi;

function schemaAccepts(value: unknown): boolean {
  return ajv.compile(CryptoOnchainDataInputSchema)(value) as boolean;
}

function record(
  query: CryptoOnchainDataQuery,
  dataType: CryptoOnchainRecord["dataType"],
): CryptoOnchainRecord {
  return {
    dataType,
    chain: query.chain,
    network: query.chain,
    provider: "fake-onchain",
    timestamp: "2026-06-12T00:00:00.000Z",
    address: query.address,
    contractAddress: query.contractAddress,
    queryId: query.queryId,
    metric: dataType,
    metricValue: 1,
    unit: "count",
    methodology: "reported",
  };
}

function fakeOnchainProvider(): CryptoOnchainProvider {
  return {
    id: "fake-onchain",
    getOnchainData: vi.fn(
      async (query: CryptoOnchainDataQuery): Promise<CryptoOnchainDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [record(query, dataType)],
        })),
      }),
    ),
  };
}

describe("crypto onchain input schema", () => {
  it("accepts reviewed EVM, Bitcoin, and saved-query inputs", () => {
    expect(
      schemaAccepts({
        chain: "ethereum",
        address: "0x000000000000000000000000000000000000dEaD",
        bundle: "evm_address_overview",
      }),
    ).toBe(true);
    expect(schemaAccepts({ chain: "bitcoin", bundle: "bitcoin_network_overview" })).toBe(true);
    expect(
      schemaAccepts({
        chain: "ethereum",
        provider: "dune",
        data_type: "saved_query",
        query_id: 123456,
      }),
    ).toBe(true);
  });

  it("rejects arbitrary RPC and SQL fields", () => {
    expect(
      schemaAccepts({ chain: "ethereum", data_type: "network_metrics", rpc_method: "eth_call" }),
    ).toBe(false);
    expect(
      schemaAccepts({ chain: "ethereum", data_type: "saved_query", sql: "select * from txs" }),
    ).toBe(false);
  });
});

describe("crypto onchain tool with a fake provider", () => {
  it("expands the EVM address bundle and canonicalizes chain plus address", async () => {
    const provider = fakeOnchainProvider();
    const tool = createCryptoOnchainDataTool(api, provider)({});
    const result = await tool.execute("onchain-evm-address", {
      chain: "ETH",
      address: "0x000000000000000000000000000000000000dEaD",
      bundle: "evm_address_overview",
    });

    expect(tool.name).toBe("crypto_onchain_data");
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("quality: good");
    expect(provider.getOnchainData).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: "ethereum",
        address: "0x000000000000000000000000000000000000dead",
        provider: "auto",
        dataTypes: ["address_activity", "token_transfers"],
      }),
    );
    expect(popRawRecords("onchain-evm-address")?.records).toHaveLength(2);
  });

  it("expands the Bitcoin network bundle", async () => {
    const provider = fakeOnchainProvider();
    const tool = createCryptoOnchainDataTool(api, provider)({});
    const result = await tool.execute("onchain-bitcoin-network", {
      chain: "BTC",
      bundle: "bitcoin_network_overview",
      limit: 5,
    });

    expect(result.isError).not.toBe(true);
    expect(provider.getOnchainData).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: "bitcoin",
        provider: "auto",
        dataTypes: ["network_metrics", "gas_fees", "blocks", "mempool"],
      }),
    );
  });

  it("requires address inputs for address activity", async () => {
    const provider = fakeOnchainProvider();
    const tool = createCryptoOnchainDataTool(api, provider)({});
    const result = await tool.execute("onchain-missing-address", {
      chain: "ethereum",
      data_type: "address_activity",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
    expect(provider.getOnchainData).not.toHaveBeenCalled();
  });

  it("requires a contract and block range for logs", async () => {
    const provider = fakeOnchainProvider();
    const tool = createCryptoOnchainDataTool(api, provider)({});
    const result = await tool.execute("onchain-invalid-logs", {
      chain: "ethereum",
      data_type: "logs",
      contract_address: "0x000000000000000000000000000000000000dEaD",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
    expect(provider.getOnchainData).not.toHaveBeenCalled();
  });

  it("requires an approved saved query id", async () => {
    const provider = fakeOnchainProvider();
    const tool = createCryptoOnchainDataTool(api, provider)({});
    const result = await tool.execute("onchain-missing-query-id", {
      chain: "ethereum",
      provider: "dune",
      data_type: "saved_query",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
    expect(provider.getOnchainData).not.toHaveBeenCalled();
  });

  it("rejects providers that cannot serve the selected chain", async () => {
    const provider = fakeOnchainProvider();
    const tool = createCryptoOnchainDataTool(api, provider)({});
    const result = await tool.execute("onchain-provider-mismatch", {
      chain: "bitcoin",
      provider: "etherscan",
      data_type: "gas_fees",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
    expect(provider.getOnchainData).not.toHaveBeenCalled();
  });
});
