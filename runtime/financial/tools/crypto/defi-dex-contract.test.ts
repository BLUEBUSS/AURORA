import Ajv from "ajv";
import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { describe, expect, it, vi } from "vitest";
import { popRawRecords } from "../../raw-data-stash.js";
import {
  CryptoDefiDataInputSchema,
  CryptoDexDataInputSchema,
  createCryptoDefiDataTool,
  createCryptoDexDataTool,
  type CryptoDefiDataQuery,
  type CryptoDefiDataResult,
  type CryptoDefiProvider,
  type CryptoDefiRecord,
  type CryptoDexDataQuery,
  type CryptoDexDataResult,
  type CryptoDexProvider,
  type CryptoDexRecord,
} from "./index.js";

const ajv = new Ajv.default({ allErrors: true, strict: false });
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const api = { logger } as unknown as AgentToolApi;

function schemaAccepts(schema: object, value: unknown): boolean {
  return ajv.compile(schema)(value) as boolean;
}

function dexRecord(
  dataType: CryptoDexRecord["dataType"],
  overrides: Partial<CryptoDexRecord> = {},
): CryptoDexRecord {
  return {
    dataType,
    chain: "ethereum",
    poolAddress: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",
    venue: "uniswap-v3",
    provider: "fake-dex",
    timestamp: "2026-06-12T00:00:00.000Z",
    baseToken: {
      address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      symbol: "WETH",
    },
    quoteToken: {
      address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: "USDC",
    },
    priceUsd: 1656,
    liquidityUsd: 85_000_000,
    volume24hUsd: 50_000_000,
    ...overrides,
  } as CryptoDexRecord;
}

function defiRecord(
  dataType: CryptoDefiRecord["dataType"],
  overrides: Partial<CryptoDefiRecord> = {},
): CryptoDefiRecord {
  return {
    dataType,
    provider: "fake-defi",
    venue: "aggregate",
    timestamp: "2026-06-12T00:00:00.000Z",
    protocol: "aave",
    chain: "ethereum",
    metric: dataType,
    value: 1_000_000,
    unit: "USD",
    ...overrides,
  } as CryptoDefiRecord;
}

function fakeDexProvider(): CryptoDexProvider {
  return {
    id: "fake-dex",
    getDexData: vi.fn(
      async (query: CryptoDexDataQuery): Promise<CryptoDexDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [
            dexRecord(dataType, {
              chain: query.chain ?? "ethereum",
              poolAddress: query.poolAddress,
            }),
          ],
        })),
      }),
    ),
  };
}

function fakeDefiProvider(): CryptoDefiProvider {
  return {
    id: "fake-defi",
    getDefiData: vi.fn(
      async (query: CryptoDefiDataQuery): Promise<CryptoDefiDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [
            defiRecord(dataType, {
              protocol: query.protocol,
              chain: query.chain,
            }),
          ],
        })),
      }),
    ),
  };
}

describe("crypto DeFi and DEX schemas", () => {
  it("accepts address-first DEX queries and rejects CEX-style symbols", () => {
    expect(
      schemaAccepts(CryptoDexDataInputSchema, {
        chain: "ethereum",
        pool_address: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",
        bundle: "pool_overview",
      }),
    ).toBe(true);
    expect(
      schemaAccepts(CryptoDexDataInputSchema, {
        symbol: "WETH/USDC",
        data_type: "pool_snapshot",
      }),
    ).toBe(false);
  });

  it("accepts protocol, stablecoin, and yield research inputs", () => {
    expect(
      schemaAccepts(CryptoDefiDataInputSchema, {
        protocol: "aave",
        bundle: "protocol_fundamentals",
      }),
    ).toBe(true);
    expect(
      schemaAccepts(CryptoDefiDataInputSchema, {
        chain: "ethereum",
        bundle: "yield_screen",
        limit: 20,
      }),
    ).toBe(true);
  });
});

describe("crypto DEX tool with a fake provider", () => {
  it("expands pool_overview and canonicalizes the chain", async () => {
    const provider = fakeDexProvider();
    const tool = createCryptoDexDataTool(api, provider)({});
    const result = await tool.execute("dex-pool-overview", {
      chain: "ETH",
      pool_address: "0x88E6A0C2DDD26FEB64F039A2C41296FCB3F5640",
      bundle: "pool_overview",
    });

    expect(tool.name).toBe("crypto_dex_data");
    expect(result.isError).not.toBe(true);
    expect(provider.getDexData).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: "ethereum",
        poolAddress: "0x88E6A0C2DDD26FEB64F039A2C41296FCB3F5640",
        dataTypes: ["pool_snapshot", "liquidity", "transaction_activity"],
      }),
    );
    expect(popRawRecords("dex-pool-overview")?.records).toHaveLength(3);
  });

  it("requires search text for token_search", async () => {
    const provider = fakeDexProvider();
    const tool = createCryptoDexDataTool(api, provider)({});
    const result = await tool.execute("dex-search-missing-query", {
      data_type: "token_search",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
    expect(provider.getDexData).not.toHaveBeenCalled();
  });

  it("requires chain and pool_address for pool history", async () => {
    const provider = fakeDexProvider();
    const tool = createCryptoDexDataTool(api, provider)({});
    const result = await tool.execute("dex-ohlcv-missing-pool", {
      chain: "ethereum",
      data_type: "ohlcv",
      interval: "1h",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
    expect(provider.getDexData).not.toHaveBeenCalled();
  });
});

describe("crypto DeFi tool with a fake provider", () => {
  it("expands protocol_fundamentals into protocol, DEX volume, and fees", async () => {
    const provider = fakeDefiProvider();
    const tool = createCryptoDefiDataTool(api, provider)({});
    const result = await tool.execute("defi-protocol", {
      protocol: "Aave",
      bundle: "protocol_fundamentals",
    });

    expect(tool.name).toBe("crypto_defi_data");
    expect(result.isError).not.toBe(true);
    expect(provider.getDefiData).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "aave",
        dataTypes: ["protocol", "dex_volume", "fees_revenue"],
      }),
    );
    expect(popRawRecords("defi-protocol")?.records).toHaveLength(3);
  });

  it("rejects protocol_fundamentals without a protocol slug", async () => {
    const provider = fakeDefiProvider();
    const tool = createCryptoDefiDataTool(api, provider)({});
    const result = await tool.execute("defi-missing-protocol", {
      bundle: "protocol_fundamentals",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
    expect(provider.getDefiData).not.toHaveBeenCalled();
  });

  it.each([
    ["stablecoin_overview", ["stablecoins"]],
    ["yield_screen", ["yields"]],
  ] as const)("expands %s into the expected sections", async (bundle, dataTypes) => {
    const provider = fakeDefiProvider();
    const tool = createCryptoDefiDataTool(api, provider)({});
    const result = await tool.execute(`defi-${bundle}`, {
      bundle,
      chain: "Arbitrum One",
      limit: 10,
    });

    expect(result.isError).not.toBe(true);
    expect(provider.getDefiData).toHaveBeenCalledWith(
      expect.objectContaining({ chain: "arbitrum", dataTypes: [...dataTypes] }),
    );
  });
});
