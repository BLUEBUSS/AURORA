import Ajv from "ajv";
import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { describe, expect, it } from "vitest";
import { popRawRecords } from "../../raw-data-stash.js";
import {
  CryptoDerivativesDataInputSchema,
  CryptoMarketDataInputSchema,
  CryptoProviderError,
  createCryptoDerivativesDataTool,
  createCryptoMarketDataTool,
  normalizeTimestamp,
  parseMarketSymbol,
  type CryptoDerivativeMarketType,
  type CryptoDerivativeRecord,
  type CryptoDerivativesDataResult,
  type CryptoMarketDataRecord,
  type CryptoMarketDataResult,
  type CryptoMarketIdentity,
  type CryptoMarketType,
  type CryptoProvider,
} from "./index.js";

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const api = { logger } as unknown as AgentToolApi;
const ajv = new Ajv.default({ allErrors: true, strict: false });

function schemaAccepts(schema: object, value: unknown): boolean {
  return ajv.compile(schema)(value) as boolean;
}

function identity<TMarketType extends CryptoMarketType>(
  marketType: TMarketType,
): CryptoMarketIdentity & { marketType: TMarketType } {
  return {
    baseAsset: "BTC",
    quoteAsset: "USDT",
    symbol: "BTC/USDT",
    marketType,
    venue: "fake-exchange",
    provider: "fake",
    timestamp: "2026-06-11T00:00:00.000Z",
  };
}

function marketRecord(
  dataType: CryptoMarketDataRecord["dataType"],
  marketType: CryptoMarketType,
): CryptoMarketDataRecord {
  const common = identity(marketType);
  switch (dataType) {
    case "snapshot":
      return {
        ...common,
        dataType,
        price: 100_000,
        priceUnit: "USDT",
        volume24h: 1_000,
        volumeUnit: "BTC",
      };
    case "ohlcv":
      return {
        ...common,
        dataType,
        interval: "1d",
        openTime: "2026-06-10T00:00:00.000Z",
        closeTime: "2026-06-11T00:00:00.000Z",
        open: 99_000,
        high: 101_000,
        low: 98_000,
        close: 100_000,
        priceUnit: "USDT",
        volume: 10,
        volumeUnit: "BTC",
      };
    case "trades":
      return {
        ...common,
        dataType,
        price: 100_000,
        priceUnit: "USDT",
        quantity: 1,
        quantityUnit: "BTC",
      };
    case "orderbook":
      return {
        ...common,
        dataType,
        side: "bid",
        level: 1,
        price: 100_000,
        priceUnit: "USDT",
        quantity: 1,
        quantityUnit: "BTC",
      };
    case "instruments":
      return {
        ...common,
        dataType,
        venueSymbol: "BTCUSDT",
        status: "TRADING",
      };
  }
}

function derivativeRecord(
  dataType: CryptoDerivativeRecord["dataType"],
  marketType: CryptoDerivativeMarketType,
): CryptoDerivativeRecord {
  return {
    ...identity(marketType),
    dataType,
    metric: dataType,
    value: 0.0001,
    unit: dataType === "funding" ? "decimal" : "contracts",
    interval: "8h",
  };
}

function fakeProvider(overrides: Partial<CryptoProvider> = {}): CryptoProvider {
  return {
    id: "fake",
    async getMarketData(query): Promise<CryptoMarketDataResult> {
      return {
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [marketRecord(dataType, query.marketType)],
        })),
      };
    },
    async getDerivativesData(query): Promise<CryptoDerivativesDataResult> {
      return {
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [derivativeRecord(dataType, query.marketType)],
        })),
      };
    },
    ...overrides,
  };
}

describe("crypto domain input schemas", () => {
  it("accepts a market data_type or bundle without schema unions", () => {
    expect(
      schemaAccepts(CryptoMarketDataInputSchema, {
        symbol: "BTC/USDT",
        data_type: "ohlcv",
        interval: "1d",
        start_time: "2026-06-01T00:00:00Z",
        end_time: "2026-06-11T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      schemaAccepts(CryptoMarketDataInputSchema, {
        symbol: "BTC/USDT",
        bundle: "market_overview",
      }),
    ).toBe(true);
  });

  it("rejects malformed symbols, unsupported data types, and spot derivatives", () => {
    expect(
      schemaAccepts(CryptoMarketDataInputSchema, {
        symbol: "BTCUSDT",
        data_type: "snapshot",
      }),
    ).toBe(false);
    expect(
      schemaAccepts(CryptoMarketDataInputSchema, {
        symbol: "BTC/USDT",
        data_type: "funding",
      }),
    ).toBe(false);
    expect(
      schemaAccepts(CryptoDerivativesDataInputSchema, {
        symbol: "BTC/USDT",
        market_type: "spot",
        data_type: "funding",
      }),
    ).toBe(false);
  });
});

describe("crypto normalization", () => {
  it("parses canonical symbols and normalizes timestamps to UTC", () => {
    expect(parseMarketSymbol("btc/usdt")).toEqual({
      baseAsset: "BTC",
      quoteAsset: "USDT",
      symbol: "BTC/USDT",
    });
    expect(normalizeTimestamp("2024-06-01T08:00:00+08:00")).toBe("2024-06-01T00:00:00.000Z");
  });
});

describe("crypto domain tools with a fake provider", () => {
  it("exposes one market tool and routes a single data_type", async () => {
    const tool = createCryptoMarketDataTool(api, fakeProvider())({});
    const result = await tool.execute("market-snapshot-call", {
      symbol: "btc/usdt",
      data_type: "snapshot",
    });

    expect(tool.name).toBe("crypto_market_data");
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("snapshot");
    expect(result.content[0].text).toContain("quality: good");
    expect(popRawRecords("market-snapshot-call")?.records[0]).toMatchObject({
      symbol: "BTC/USDT",
      dataType: "snapshot",
      marketType: "spot",
      provider: "fake",
    });
  });

  it("expands market_overview into multiple API sections in one call", async () => {
    let requested: string[] = [];
    const provider = fakeProvider({
      async getMarketData(query) {
        requested = [...query.dataTypes];
        return fakeProvider().getMarketData(query);
      },
    });
    const tool = createCryptoMarketDataTool(api, provider)({});
    const result = await tool.execute("market-bundle-call", {
      symbol: "BTC/USDT",
      bundle: "market_overview",
    });

    expect(requested).toEqual(["snapshot", "ohlcv"]);
    expect(result.content[0].text).toContain("ohlcv");
    expect(popRawRecords("market-bundle-call")?.records).toHaveLength(2);
  });

  it("expands derivatives_overview into a complete research bundle", async () => {
    let requested: string[] = [];
    const provider = fakeProvider({
      async getDerivativesData(query) {
        requested = [...query.dataTypes];
        return fakeProvider().getDerivativesData(query);
      },
    });
    const tool = createCryptoDerivativesDataTool(api, provider)({});
    await tool.execute("derivatives-bundle-call", {
      symbol: "BTC/USDT",
      market_type: "perpetual",
      bundle: "derivatives_overview",
    });

    expect(requested).toEqual([
      "funding",
      "open_interest",
      "basis",
      "long_short_ratio",
      "taker_flow",
    ]);
  });

  it("keeps successful sections when another API returns partial data", async () => {
    const provider = fakeProvider({
      async getDerivativesData() {
        return {
          status: "partial",
          sections: [
            {
              dataType: "funding",
              status: "complete",
              records: [
                {
                  ...derivativeRecord("funding", "perpetual"),
                  metric: "funding_rate",
                },
              ],
            },
            {
              dataType: "open_interest",
              status: "partial",
              records: [],
              issues: [{ code: "PARTIAL_DATA", message: "OI history window is unavailable" }],
            },
          ],
        };
      },
    });
    const tool = createCryptoDerivativesDataTool(api, provider)({});
    const result = await tool.execute("partial-bundle-call", {
      symbol: "BTC/USDT",
      market_type: "perpetual",
      bundle: "derivatives_overview",
    });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("PARTIAL_DATA");
    expect(result.content[0].text).toContain("quality: degraded");
    expect(popRawRecords("partial-bundle-call")?.records).toHaveLength(1);
  });

  it("rejects calls that provide both data_type and bundle", async () => {
    const tool = createCryptoMarketDataTool(api, fakeProvider())({});
    const result = await tool.execute("ambiguous-call", {
      symbol: "BTC/USDT",
      data_type: "snapshot",
      bundle: "market_overview",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
  });

  it("rejects an inverted time range before calling the provider", async () => {
    const tool = createCryptoMarketDataTool(api, fakeProvider())({});
    const result = await tool.execute("bad-range-call", {
      symbol: "BTC/USDT",
      data_type: "ohlcv",
      interval: "1d",
      start_time: "2026-06-11T00:00:00Z",
      end_time: "2026-06-01T00:00:00Z",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
  });

  it("maps provider rate limits to a stable error code", async () => {
    const provider = fakeProvider({
      async getMarketData() {
        throw new CryptoProviderError("RATE_LIMITED", "quota exceeded", {
          retryAfterMs: 5000,
        });
      },
    });
    const tool = createCryptoMarketDataTool(api, provider)({});
    const result = await tool.execute("rate-limit-call", {
      symbol: "BTC/USDT",
      data_type: "snapshot",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"RATE_LIMITED"');
    expect(result.content[0].text).toContain('"retryAfterMs":5000');
  });

  it("rejects provider records from a different venue", async () => {
    const provider = fakeProvider({
      async getMarketData(query) {
        const result = await fakeProvider().getMarketData(query);
        result.sections[0].records[0].venue = "other-exchange";
        return result;
      },
    });
    const tool = createCryptoMarketDataTool(api, provider)({});
    const result = await tool.execute("wrong-venue-call", {
      symbol: "BTC/USDT",
      venue: "fake-exchange",
      data_type: "snapshot",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"UPSTREAM_ERROR"');
  });

  it.each(["aggregate", "coinalyze"])(
    "allows %s to select aggregate data while preserving the record venue",
    async (venue) => {
      const provider = fakeProvider({
        id: "crypto-router",
        async getDerivativesData(query) {
          const result = await fakeProvider().getDerivativesData(query);
          result.sections[0].records[0].provider = "coinalyze";
          result.sections[0].records[0].venue = "binance";
          return result;
        },
      });
      const tool = createCryptoDerivativesDataTool(api, provider)({});

      const result = await tool.execute(`aggregate-${venue}`, {
        symbol: "BTC/USDT",
        market_type: "perpetual",
        venue,
        data_type: "funding",
      });

      expect(result.isError).not.toBe(true);
      expect(result.content[0].text).toContain("binance");
    },
  );
});
