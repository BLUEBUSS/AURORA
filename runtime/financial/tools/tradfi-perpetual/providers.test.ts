import { describe, expect, it } from "vitest";
import { normalizeTradfiPerpetualInput } from "./normalize.js";
import { BinanceTradfiPerpetualProvider } from "./providers/binance.js";

const NOW = Date.parse("2026-07-14T12:00:00.000Z");
const SKHYNIX_ONBOARD = Date.parse("2026-06-02T00:00:00.000Z");
const ZHIPU_ONBOARD = Date.parse("2026-07-17T03:05:00.000Z");
const CXMT_ONBOARD = Date.parse("2026-08-18T05:00:00.000Z");

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function exchangeInfo() {
  return {
    symbols: [
      {
        symbol: "SKHYNIXUSDT",
        pair: "SKHYNIXUSDT",
        contractType: "TRADIFI_PERPETUAL",
        onboardDate: SKHYNIX_ONBOARD,
        status: "TRADING",
        baseAsset: "SKHYNIX",
        quoteAsset: "USDT",
        marginAsset: "USDT",
        pricePrecision: 2,
        quantityPrecision: 2,
        underlyingType: "KR_EQUITY",
        underlyingSubType: ["TradFi"],
        orderTypes: ["LIMIT", "MARKET"],
        timeInForce: ["GTC"],
      },
      {
        symbol: "NVDAUSDT",
        pair: "NVDAUSDT",
        contractType: "TRADIFI_PERPETUAL",
        onboardDate: Date.parse("2026-02-01T00:00:00.000Z"),
        status: "TRADING",
        baseAsset: "NVDA",
        quoteAsset: "USDT",
        marginAsset: "USDT",
        underlyingType: "EQUITY",
        underlyingSubType: ["TradFi"],
      },
      {
        symbol: "ZHIPUUSDT",
        pair: "ZHIPUUSDT",
        contractType: "TRADIFI_PERPETUAL",
        onboardDate: ZHIPU_ONBOARD,
        status: "TRADING",
        baseAsset: "ZHIPU",
        quoteAsset: "USDT",
        marginAsset: "USDT",
        underlyingType: "HK_EQUITY",
        underlyingSubType: ["TradFi"],
      },
      {
        symbol: "CXMTUSDT",
        pair: "CXMTUSDT",
        contractType: "TRADIFI_PERPETUAL",
        onboardDate: CXMT_ONBOARD,
        status: "TRADING",
        baseAsset: "CXMT",
        quoteAsset: "USDT",
        marginAsset: "USDT",
        underlyingType: "CN_EQUITY",
        underlyingSubType: ["TradFi"],
      },
      {
        symbol: "XAUUSDT",
        contractType: "TRADIFI_PERPETUAL",
        onboardDate: Date.parse("2026-01-01T00:00:00.000Z"),
        status: "TRADING",
        baseAsset: "XAU",
        quoteAsset: "USDT",
        marginAsset: "USDT",
        underlyingType: "COMMODITY",
        underlyingSubType: ["TradFi"],
      },
      {
        symbol: "OPENAIUSDT",
        contractType: "TRADIFI_PERPETUAL",
        onboardDate: Date.parse("2026-01-01T00:00:00.000Z"),
        status: "TRADING",
        baseAsset: "OPENAI",
        quoteAsset: "USDT",
        marginAsset: "USDT",
        underlyingType: "PREMARKET",
        underlyingSubType: ["Pre-IPO", "TradFi"],
      },
      {
        symbol: "BTCUSDT",
        contractType: "PERPETUAL",
        onboardDate: Date.parse("2019-01-01T00:00:00.000Z"),
        status: "TRADING",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        marginAsset: "USDT",
        underlyingType: "COIN",
        underlyingSubType: [],
      },
    ],
  };
}

function providerWith(fetchImpl: typeof fetch) {
  return new BinanceTradfiPerpetualProvider({
    fetchImpl,
    futuresBaseUrl: "https://binance.test",
    now: () => NOW,
  });
}

describe("BinanceTradfiPerpetualProvider instrument boundaries", () => {
  it("lists US, Korean, Hong Kong, and China equity-linked TradFi perpetuals", async () => {
    const provider = providerWith(async (input) => {
      expect(new URL(String(input)).pathname).toBe("/fapi/v1/exchangeInfo");
      return jsonResponse(exchangeInfo());
    });
    const result = await provider.getData(
      normalizeTradfiPerpetualInput({
        user_query: "币安有哪些股票永续",
        action: "instruments",
      }),
    );

    expect(result.status).toBe("complete");
    expect(result.sections[0].records.map((record) => record.venueSymbol)).toEqual([
      "CXMTUSDT",
      "NVDAUSDT",
      "ZHIPUUSDT",
      "SKHYNIXUSDT",
    ]);
    expect(result.sections[0].records.every((record) => record.isCashEquity === false)).toBe(true);
    expect(result.sections[0].records.map((record) => record.underlyingMarket)).toEqual([
      "CN_EQUITY",
      "US_EQUITY",
      "HK_EQUITY",
      "KR_EQUITY",
    ]);
  });

  it("rejects an explicit Binance BTC request before provider execution", () => {
    expect(() =>
      normalizeTradfiPerpetualInput({
        user_query: "看看 Binance 的 BTC 合约",
        action: "snapshot",
        symbol: "BTC",
      }),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_INSTRUMENT_CLASS" }));
  });

  it.each([
    ["XAU", "commodity"],
    ["OPENAI", "PREMARKET"],
  ])("rejects excluded %s instruments at the provider boundary", async (symbol) => {
    const provider = providerWith(async () => jsonResponse(exchangeInfo()));

    await expect(
      provider.getData(
        normalizeTradfiPerpetualInput({
          user_query: `看看 Binance 的 ${symbol} 合约`,
          action: "snapshot",
          symbol,
        }),
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_INSTRUMENT_CLASS" });
  });
});

describe("BinanceTradfiPerpetualProvider market data", () => {
  it.each([
    ["智谱", "ZHIPUUSDT", "HK_EQUITY", "hk_equity_perpetual"],
    ["长鑫存储", "CXMTUSDT", "CN_EQUITY", "cn_equity_perpetual"],
  ] as const)(
    "resolves the %s alias and preserves its Binance market identity and schedule",
    async (alias, venueSymbol, underlyingMarket, instrumentClass) => {
      const provider = providerWith(async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse(exchangeInfo());
        if (url.pathname === "/fapi/v1/ticker/24hr") {
          return jsonResponse({
            lastPrice: "100",
            weightedAvgPrice: "99",
            priceChange: "1",
            priceChangePercent: "1.01",
            volume: "1000",
            quoteVolume: "100000",
            closeTime: NOW,
          });
        }
        if (url.pathname === "/fapi/v1/premiumIndex") {
          return jsonResponse({
            markPrice: "100",
            indexPrice: "100",
            lastFundingRate: "0.0001",
            nextFundingTime: NOW + 3_600_000,
            time: NOW,
          });
        }
        if (url.pathname === "/fapi/v1/ticker/bookTicker") {
          return jsonResponse({ bidPrice: "99.9", bidQty: "10", askPrice: "100.1", askQty: "8" });
        }
        if (url.pathname === "/fapi/v1/tradingSchedule") {
          return jsonResponse({
            updateTime: NOW,
            marketSchedules: {
              [underlyingMarket]: {
                sessions: [
                  { startTime: NOW - 3_600_000, endTime: NOW + 3_600_000, type: "REGULAR" },
                ],
              },
            },
          });
        }
        return jsonResponse({ message: "unexpected" }, 404);
      });

      const result = await provider.getData(
        normalizeTradfiPerpetualInput({
          user_query: `查看 Binance ${alias} 股票永续快照`,
          action: "snapshot",
          symbol: alias,
        }),
      );

      expect(result.status).toBe("complete");
      expect(result.sections[0].records[0]).toMatchObject({
        venueSymbol,
        underlyingMarket,
        underlyingType: underlyingMarket,
        instrumentClass,
        quoteAsset: "USDT",
        settlementAsset: "USDT",
        isCashEquity: false,
      });
      expect(result.sections[1].records[0]).toMatchObject({
        venueSymbol,
        underlyingMarket,
        dataType: "trading_schedule",
      });
    },
  );

  it("resolves the SK 海力士 alias and reports listing-limited OHLCV coverage", async () => {
    const urls: URL[] = [];
    const provider = providerWith(async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse(exchangeInfo());
      if (url.pathname === "/fapi/v1/klines") {
        return jsonResponse([
          [
            SKHYNIX_ONBOARD,
            "150",
            "155",
            "149",
            "154",
            "1000",
            SKHYNIX_ONBOARD + 86_399_999,
            "152000",
          ],
        ]);
      }
      return jsonResponse({ message: "unexpected" }, 404);
    });
    const result = await provider.getData(
      normalizeTradfiPerpetualInput({
        user_query: "帮我看看 bn 上的 SK 海力士近三个月 K 线",
        action: "ohlcv",
        symbol: "SK 海力士",
        interval: "1d",
        start_time: "2026-04-14T00:00:00Z",
        end_time: "2026-07-14T00:00:00Z",
      }),
    );

    const klineUrl = urls.find((url) => url.pathname === "/fapi/v1/klines");
    expect(klineUrl?.searchParams.get("symbol")).toBe("SKHYNIXUSDT");
    expect(Number(klineUrl?.searchParams.get("startTime"))).toBe(SKHYNIX_ONBOARD);
    expect(result.status).toBe("partial");
    expect(result.sections[0].coverage).toMatchObject({
      requestedStartTime: "2026-04-14T00:00:00.000Z",
      availableStartTime: "2026-06-02T00:00:00.000Z",
      isComplete: false,
    });
    expect(result.sections[0].records[0]).toMatchObject({
      venueSymbol: "SKHYNIXUSDT",
      dataType: "trade_ohlcv",
      close: 154,
      isCashEquity: false,
    });
  });

  it.each([
    ["mark", "/fapi/v1/markPriceKlines", "symbol"],
    ["index", "/fapi/v1/indexPriceKlines", "pair"],
    ["premium", "/fapi/v1/premiumIndexKlines", "symbol"],
  ] as const)("maps the %s OHLCV endpoint", async (priceSeries, pathname, symbolParam) => {
    const urls: URL[] = [];
    const provider = providerWith(async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse(exchangeInfo());
      return jsonResponse([[NOW - 86_400_000, "1", "2", "0.5", "1.5", "0", NOW - 1, "0"]]);
    });
    const result = await provider.getData(
      normalizeTradfiPerpetualInput({
        user_query: `看看币安 SK 海力士的 ${priceSeries} K 线`,
        action: "ohlcv",
        symbol: "SKHYNIX",
        price_series: priceSeries,
      }),
    );

    const dataUrl = urls.find((url) => url.pathname === pathname);
    expect(dataUrl?.searchParams.get(symbolParam)).toBe("SKHYNIXUSDT");
    expect(result.sections[0].dataType).toBe(`${priceSeries}_ohlcv`);
  });

  it("maps snapshot prices and the current underlying-market schedule", async () => {
    const provider = providerWith(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse(exchangeInfo());
      if (url.pathname === "/fapi/v1/ticker/24hr") {
        return jsonResponse({
          lastPrice: "154",
          weightedAvgPrice: "153",
          priceChange: "4",
          priceChangePercent: "2.6667",
          volume: "1000",
          quoteVolume: "152000",
          closeTime: NOW,
        });
      }
      if (url.pathname === "/fapi/v1/premiumIndex") {
        return jsonResponse({
          markPrice: "153.9",
          indexPrice: "153.8",
          lastFundingRate: "0.0001",
          nextFundingTime: NOW + 3_600_000,
          time: NOW,
        });
      }
      if (url.pathname === "/fapi/v1/ticker/bookTicker") {
        return jsonResponse({ bidPrice: "153.8", bidQty: "10", askPrice: "154.1", askQty: "8" });
      }
      if (url.pathname === "/fapi/v1/tradingSchedule") {
        return jsonResponse({
          updateTime: NOW,
          marketSchedules: {
            KR_EQUITY: {
              sessions: [
                { startTime: NOW - 3_600_000, endTime: NOW + 3_600_000, type: "REGULAR" },
                { startTime: NOW + 3_600_000, endTime: NOW + 7_200_000, type: "NO_TRADING" },
              ],
            },
          },
        });
      }
      return jsonResponse({ message: "unexpected" }, 404);
    });
    const result = await provider.getData(
      normalizeTradfiPerpetualInput({
        user_query: "看看币安 SK 海力士永续快照",
        action: "snapshot",
        symbol: "SKHYNIX",
      }),
    );

    expect(result.status).toBe("complete");
    expect(result.sections[0].records[0]).toMatchObject({
      lastPrice: 154,
      markPrice: 153.9,
      indexPrice: 153.8,
      bestBidPrice: 153.8,
      priceChangePercent24h: expect.closeTo(0.026667),
    });
    expect(result.sections[1].records[0]).toMatchObject({
      dataType: "trading_schedule",
      sessionType: "REGULAR",
      isCurrent: true,
    });
  });

  it("keeps successful sections when one endpoint fails", async () => {
    const provider = providerWith(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse(exchangeInfo());
      if (url.pathname === "/fapi/v1/tradingSchedule") {
        return jsonResponse({
          updateTime: NOW,
          marketSchedules: {
            KR_EQUITY: {
              sessions: [{ startTime: NOW - 3_600_000, endTime: NOW + 3_600_000, type: "REGULAR" }],
            },
          },
        });
      }
      return jsonResponse({ code: -1003, msg: "Too many requests" }, 429);
    });
    const result = await provider.getData(
      normalizeTradfiPerpetualInput({
        user_query: "看看 Binance SK 海力士永续快照",
        action: "snapshot",
        symbol: "SKHYNIX",
      }),
    );

    expect(result.status).toBe("partial");
    expect(result.sections[0]).toMatchObject({
      dataType: "snapshot",
      status: "partial",
      records: [],
      issues: [{ code: "PARTIAL_DATA" }],
    });
    expect(result.sections[1]).toMatchObject({
      dataType: "trading_schedule",
      status: "complete",
    });
    expect(result.sections[1].records).toHaveLength(1);
  });

  it("maps orderbook and recent trades without routing through crypto tools", async () => {
    const provider = providerWith(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse(exchangeInfo());
      if (url.pathname === "/fapi/v1/depth") {
        return jsonResponse({ bids: [["153.8", "10"]], asks: [["154.1", "8"]] });
      }
      if (url.pathname === "/fapi/v1/trades") {
        return jsonResponse([
          { id: 1, price: "154", qty: "2", quoteQty: "308", time: NOW, isBuyerMaker: false },
        ]);
      }
      return jsonResponse({ message: "unexpected" }, 404);
    });
    const result = await provider.getData(
      normalizeTradfiPerpetualInput({
        user_query: "看看 Binance NVDA 永续盘口和成交",
        action: "microstructure",
        symbol: "NVDA",
        depth: 5,
      }),
    );

    expect(result.sections[0].records).toHaveLength(2);
    expect(result.sections[1].records[0]).toMatchObject({
      dataType: "trades",
      side: "buy",
      price: 154,
    });
  });
});

describe("BinanceTradfiPerpetualProvider derivatives coverage", () => {
  it("clamps Binance statistics endpoints to 30 days and preserves requested coverage", async () => {
    const urls: URL[] = [];
    const provider = providerWith(async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === "/fapi/v1/exchangeInfo") return jsonResponse(exchangeInfo());
      if (url.pathname === "/fapi/v1/fundingRate") {
        return jsonResponse([
          { fundingTime: SKHYNIX_ONBOARD, fundingRate: "0.0001", markPrice: "150" },
        ]);
      }
      if (url.pathname === "/futures/data/openInterestHist") {
        return jsonResponse([
          {
            timestamp: NOW - 86_400_000,
            sumOpenInterest: "1000",
            sumOpenInterestValue: "150000",
          },
        ]);
      }
      if (url.pathname.startsWith("/futures/data/")) {
        return jsonResponse([
          {
            timestamp: NOW - 86_400_000,
            longShortRatio: "1.2",
            buySellRatio: "1.1",
            longAccount: "0.55",
            shortAccount: "0.45",
            buyVol: "110",
            sellVol: "100",
          },
        ]);
      }
      return jsonResponse({ message: "unexpected" }, 404);
    });
    const result = await provider.getData(
      normalizeTradfiPerpetualInput({
        user_query: "分析 bn 上 SK 海力士近三个月的资金费率、持仓量和多空结构",
        action: "derivatives",
        symbol: "SK 海力士",
        interval: "1d",
        start_time: "2026-04-14T00:00:00Z",
        end_time: "2026-07-14T00:00:00Z",
      }),
    );

    const oiUrl = urls.find((url) => url.pathname === "/futures/data/openInterestHist");
    expect(Number(oiUrl?.searchParams.get("startTime"))).toBe(NOW - 30 * 86_400_000);
    expect(result.sections).toHaveLength(6);
    expect(result.status).toBe("partial");
    expect(result.sections[1].coverage).toMatchObject({
      requestedStartTime: "2026-04-14T00:00:00.000Z",
      isComplete: false,
    });
    expect(result.sections[1].issues?.[0].message).toContain("latest 30 days");
  });
});
