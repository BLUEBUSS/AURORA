import { describe, expect, it } from "vitest";
import { normalizeTradfiPerpetualInput } from "./normalize.js";
import { BinanceTradfiPerpetualProvider } from "./providers/binance.js";

const NOW = Date.parse("2026-08-19T00:00:00Z");

function instrument(baseAsset: string, underlyingType: string) {
  return {
    symbol: `${baseAsset}USDT`,
    pair: `${baseAsset}USDT`,
    contractType: "TRADIFI_PERPETUAL",
    onboardDate: NOW - 86_400_000,
    status: "TRADING",
    baseAsset,
    quoteAsset: "USDT",
    marginAsset: "USDT",
    underlyingType,
    underlyingSubType: ["TradFi"],
  };
}

function provider() {
  return new BinanceTradfiPerpetualProvider({
    fetchImpl: async () =>
      Response.json({
        symbols: [
          instrument("HK1810", "HK_EQUITY"),
          instrument("BABA", "EQUITY"),
          instrument("HK9988", "HK_EQUITY"),
          instrument("CXMT", "CN_EQUITY"),
        ],
      }),
    futuresBaseUrl: "https://binance.test",
    now: () => NOW,
  });
}

async function resolve(userQuery: string, symbol: string) {
  const result = await provider().getData(
    normalizeTradfiPerpetualInput({
      user_query: userQuery,
      action: "instruments",
      symbol,
    }),
  );
  return result.sections[0]!.records[0]!;
}

describe("Binance instrument identity resolution", () => {
  it.each(["小米集团", "XIAOMI", "1810", "01810", "1810.HK", "HK1810"])(
    "normalizes %s to the same catalog identity without trial calls",
    async (symbol) => {
      const record = await resolve("分析 Binance 小米集团股票永续", symbol);
      expect(record).toMatchObject({
        venueSymbol: "HK1810USDT",
        underlyingSymbol: "HK1810",
        underlyingMarket: "HK_EQUITY",
      });
    },
  );

  it("uses the original user market intent instead of a model-invented US ticker", async () => {
    const record = await resolve("分析 Binance 港股阿里巴巴股票永续", "BABA");
    expect(record).toMatchObject({
      venueSymbol: "HK9988USDT",
      underlyingMarket: "HK_EQUITY",
    });
  });

  it("uses the original user market intent instead of a model-invented HK ticker", async () => {
    const record = await resolve("分析 Binance 美股阿里巴巴股票永续", "9988.HK");
    expect(record).toMatchObject({
      venueSymbol: "BABAUSDT",
      underlyingMarket: "US_EQUITY",
    });
  });

  it("returns candidates instead of silently choosing when the user did not specify a listing", async () => {
    await expect(resolve("分析 Binance 阿里巴巴股票永续", "阿里巴巴")).rejects.toMatchObject({
      code: "AMBIGUOUS_INSTRUMENT",
      message: expect.stringContaining("BABAUSDT (US_EQUITY)"),
    });
  });

  it("rejects a resolved symbol that conflicts with an explicit market and has no safe correction", async () => {
    await expect(resolve("分析 Binance 港股长鑫存储股票永续", "CXMT")).rejects.toMatchObject({
      code: "MARKET_MISMATCH",
    });
  });
});
