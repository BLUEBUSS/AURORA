import Ajv from "ajv";
import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { describe, expect, it, vi } from "vitest";
import { popRawRecords } from "../../raw-data-stash.js";
import {
  CryptoOptionsDataInputSchema,
  createCryptoOptionsDataTool,
  type CryptoOptionRecord,
  type CryptoOptionsDataQuery,
  type CryptoOptionsDataResult,
  type CryptoOptionsProvider,
} from "./index.js";

const ajv = new Ajv.default({ allErrors: true, strict: false });
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const api = { logger } as unknown as AgentToolApi;

function schemaAccepts(value: unknown): boolean {
  return ajv.compile(CryptoOptionsDataInputSchema)(value) as boolean;
}

function optionRecord(
  dataType: CryptoOptionRecord["dataType"],
  overrides: Partial<CryptoOptionRecord> = {},
): CryptoOptionRecord {
  return {
    baseAsset: "BTC",
    quoteAsset: "USD",
    symbol: "BTC/USD",
    venue: "deribit",
    provider: "fake-options",
    timestamp: "2026-06-12T00:00:00.000Z",
    dataType,
    instrumentName: "BTC-26JUN26-100000-C",
    expiry: "2026-06-26T08:00:00.000Z",
    strike: 100000,
    optionType: "call",
    value: 1,
    unit: "decimal",
    ...overrides,
  } as CryptoOptionRecord;
}

function fakeOptionsProvider(): CryptoOptionsProvider {
  return {
    id: "fake-options",
    getOptionsData: vi.fn(
      async (query: CryptoOptionsDataQuery): Promise<CryptoOptionsDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [optionRecord(dataType)],
        })),
      }),
    ),
  };
}

describe("crypto options input schema", () => {
  it("accepts asset-level and exact-contract option queries without schema unions", () => {
    expect(schemaAccepts({ symbol: "BTC/USD", data_type: "chain" })).toBe(true);
    expect(
      schemaAccepts({
        symbol: "BTC/USD",
        bundle: "options_surface",
        expiry: "2026-06-26",
        strike: 100000,
        option_type: "call",
      }),
    ).toBe(true);
  });

  it("rejects venue-native symbols and unsupported option data types", () => {
    expect(schemaAccepts({ symbol: "BTC-26JUN26-100000-C", data_type: "chain" })).toBe(false);
    expect(schemaAccepts({ symbol: "BTC/USD", data_type: "funding" })).toBe(false);
  });
});

describe("crypto options tool with a fake provider", () => {
  it("expands options_surface into chain, greeks, and implied volatility", async () => {
    const provider = fakeOptionsProvider();
    const tool = createCryptoOptionsDataTool(api, provider)({});
    const result = await tool.execute("options-surface", {
      symbol: "btc/usd",
      bundle: "options_surface",
      expiry: "2026-06-26",
      strike: 100000,
      option_type: "call",
    });

    expect(tool.name).toBe("crypto_options_data");
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("quality: good");
    expect(provider.getOptionsData).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTC/USD",
        venue: "deribit",
        expiry: "2026-06-26T00:00:00.000Z",
        strike: 100000,
        optionType: "call",
        dataTypes: ["chain", "greeks", "implied_volatility"],
      }),
    );
    expect(popRawRecords("options-surface")?.records).toHaveLength(3);
  });

  it("expands volatility_overview without requiring an exact contract", async () => {
    const provider = fakeOptionsProvider();
    const tool = createCryptoOptionsDataTool(api, provider)({});
    const result = await tool.execute("volatility-overview", {
      symbol: "BTC/USD",
      bundle: "volatility_overview",
      interval: "1d",
      limit: 10,
    });

    expect(result.isError).not.toBe(true);
    expect(provider.getOptionsData).toHaveBeenCalledWith(
      expect.objectContaining({
        dataTypes: ["volatility_index", "implied_volatility", "expiry_structure"],
      }),
    );
  });

  it.each(["ticker", "orderbook", "trades", "greeks"] as const)(
    "requires expiry, strike, and option_type for %s",
    async (dataType) => {
      const provider = fakeOptionsProvider();
      const tool = createCryptoOptionsDataTool(api, provider)({});
      const result = await tool.execute(`missing-${dataType}`, {
        symbol: "BTC/USD",
        data_type: dataType,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
      expect(provider.getOptionsData).not.toHaveBeenCalled();
    },
  );

  it("rejects unsupported options venues before calling the provider", async () => {
    const provider = fakeOptionsProvider();
    const tool = createCryptoOptionsDataTool(api, provider)({});
    const result = await tool.execute("wrong-options-venue", {
      symbol: "BTC/USD",
      venue: "binance",
      data_type: "chain",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
    expect(provider.getOptionsData).not.toHaveBeenCalled();
  });
});
