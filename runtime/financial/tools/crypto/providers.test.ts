import { describe, expect, it } from "vitest";
import {
  BinanceCryptoProvider,
  BybitCryptoProvider,
  CoinalyzeCryptoProvider,
  DeribitCryptoProvider,
  type CryptoDerivativesDataQuery,
  type CryptoMarketDataQuery,
} from "./index.js";

type JsonValue = Record<string, unknown> | unknown[];

function jsonResponse(value: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function marketQuery(dataTypes: CryptoMarketDataQuery["dataTypes"]): CryptoMarketDataQuery {
  return {
    baseAsset: "BTC",
    quoteAsset: "USDT",
    symbol: "BTC/USDT",
    marketType: "spot",
    venue: "binance",
    dataTypes,
    interval: "1d",
    startTime: "2026-06-01T00:00:00.000Z",
    endTime: "2026-06-11T00:00:00.000Z",
    limit: 10,
  };
}

function derivativesQuery(
  dataTypes: CryptoDerivativesDataQuery["dataTypes"],
): CryptoDerivativesDataQuery {
  return {
    baseAsset: "BTC",
    quoteAsset: "USDT",
    symbol: "BTC/USDT",
    marketType: "perpetual",
    venue: "binance",
    dataTypes,
    interval: "1h",
    limit: 10,
  };
}

describe("BinanceCryptoProvider", () => {
  it("maps snapshot and OHLCV endpoints into one market result", async () => {
    const urls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === "/api/v3/ticker/24hr") {
        return jsonResponse({
          lastPrice: "100000",
          volume: "123.5",
          quoteVolume: "12350000",
          priceChangePercent: "2.5",
          closeTime: 1_781_174_400_000,
        });
      }
      if (url.pathname === "/api/v3/klines") {
        return jsonResponse([
          [
            1_780_329_600_000,
            "99000",
            "101000",
            "98000",
            "100000",
            "10",
            1_780_416_000_000,
            "1000000",
          ],
        ]);
      }
      return jsonResponse({ message: "unexpected" }, 404);
    };
    const provider = new BinanceCryptoProvider({ fetchImpl });
    const result = await provider.getMarketData(marketQuery(["snapshot", "ohlcv"]));

    expect(result.status).toBe("complete");
    expect(result.sections.map((section) => section.dataType)).toEqual(["snapshot", "ohlcv"]);
    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "snapshot",
      symbol: "BTC/USDT",
      venue: "binance",
      price: 100000,
      change24h: 0.025,
    });
    expect(result.sections[1].records[0]).toMatchObject({
      dataType: "ohlcv",
      interval: "1d",
      open: 99000,
      close: 100000,
    });
    expect(urls.map((url) => url.pathname)).toEqual(["/api/v3/ticker/24hr", "/api/v3/klines"]);
  });

  it("maps funding, open interest, and derived basis into separate sections", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/fapi/v1/fundingRate") {
        return jsonResponse([
          { fundingRate: "0.0001", fundingTime: 1_781_174_400_000, markPrice: "100100" },
        ]);
      }
      if (url.pathname === "/fapi/v1/openInterest") {
        return jsonResponse({ openInterest: "12345", time: 1_781_174_400_000 });
      }
      if (url.pathname === "/fapi/v1/premiumIndex") {
        return jsonResponse({
          markPrice: "100100",
          indexPrice: "100000",
          time: 1_781_174_400_000,
        });
      }
      return jsonResponse({ message: "unexpected" }, 404);
    };
    const provider = new BinanceCryptoProvider({ fetchImpl });
    const result = await provider.getDerivativesData(
      derivativesQuery(["funding", "open_interest", "basis"]),
    );

    expect(result.status).toBe("complete");
    expect(result.sections[0].records[0]).toMatchObject({
      metric: "funding_rate",
      value: 0.0001,
      unit: "decimal",
    });
    expect(result.sections[1].records[0]).toMatchObject({
      metric: "open_interest",
      value: 12345,
      unit: "contracts",
    });
    expect(result.sections[2].records[0]).toMatchObject({
      metric: "basis",
      value: 0.001,
      unit: "decimal",
      methodology: "derived",
    });
  });

  it("returns an explicit partial issue for data that requires the later collector", async () => {
    const provider = new BinanceCryptoProvider({
      fetchImpl: async () => jsonResponse({ message: "not called" }, 500),
    });
    const result = await provider.getDerivativesData(derivativesQuery(["liquidations"]));

    expect(result.status).toBe("partial");
    expect(result.sections[0]).toMatchObject({
      dataType: "liquidations",
      status: "partial",
      records: [],
    });
    expect(result.sections[0].issues?.[0].code).toBe("PARTIAL_DATA");
  });
});

describe("CoinalyzeCryptoProvider", () => {
  it("resolves the venue symbol and maps funding plus open interest", async () => {
    const urls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === "/v1/exchanges") {
        return jsonResponse([
          { name: "Binance", code: "A" },
          { name: "Bybit", code: "6" },
        ]);
      }
      if (url.pathname === "/v1/future-markets") {
        return jsonResponse([
          {
            symbol: "BTCUSDT_PERP.A",
            exchange: "A",
            base_asset: "BTC",
            quote_asset: "USDT",
            is_perpetual: true,
          },
        ]);
      }
      if (url.pathname === "/v1/funding-rate") {
        return jsonResponse([{ symbol: "BTCUSDT_PERP.A", value: 0.01, update: 1_781_174_400_000 }]);
      }
      if (url.pathname === "/v1/open-interest") {
        return jsonResponse([
          { symbol: "BTCUSDT_PERP.A", value: 5_000_000, update: 1_781_174_400_000 },
        ]);
      }
      return jsonResponse({ message: "unexpected" }, 404);
    };
    const provider = new CoinalyzeCryptoProvider({ apiKey: "secret-key", fetchImpl });
    const result = await provider.getDerivativesData(
      derivativesQuery(["funding", "open_interest"]),
    );

    expect(result.status).toBe("complete");
    expect(result.sections[0].records[0]).toMatchObject({
      provider: "coinalyze",
      venue: "binance",
      metric: "funding_rate",
      unit: "percent",
    });
    expect(result.sections[1].records[0]).toMatchObject({
      metric: "open_interest",
      unit: "USD",
    });
    expect(urls.every((url) => url.searchParams.get("api_key") === "secret-key")).toBe(true);
  });

  it("does not pretend to provide venue market data", async () => {
    const provider = new CoinalyzeCryptoProvider({
      apiKey: "secret-key",
      fetchImpl: async () => jsonResponse([]),
    });

    await expect(provider.getMarketData(marketQuery(["snapshot"]))).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });
});

describe("BybitCryptoProvider", () => {
  it("maps public ticker and kline responses into market sections", async () => {
    const urls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === "/v5/market/tickers") {
        return jsonResponse({
          retCode: 0,
          retMsg: "OK",
          time: 1_781_174_400_000,
          result: {
            list: [
              {
                symbol: "BTCUSDT",
                lastPrice: "100000",
                volume24h: "123.5",
                turnover24h: "12350000",
                price24hPcnt: "0.025",
              },
            ],
          },
        });
      }
      if (url.pathname === "/v5/market/kline") {
        return jsonResponse({
          retCode: 0,
          retMsg: "OK",
          result: {
            list: [["1780329600000", "99000", "101000", "98000", "100000", "10", "1000000"]],
          },
        });
      }
      return jsonResponse({ retCode: 10001, retMsg: "unexpected" });
    };
    const provider = new BybitCryptoProvider({ fetchImpl });
    const result = await provider.getMarketData({
      ...marketQuery(["snapshot", "ohlcv"]),
      venue: "bybit",
    });

    expect(result.status).toBe("complete");
    expect(result.sections[0].records[0]).toMatchObject({
      provider: "bybit",
      venue: "bybit",
      price: 100000,
      change24h: 0.025,
    });
    expect(result.sections[1].records[0]).toMatchObject({
      interval: "1d",
      open: 99000,
      close: 100000,
    });
    expect(urls.map((url) => url.searchParams.get("category"))).toEqual(["spot", "spot"]);
    expect(urls[1].searchParams.get("interval")).toBe("D");
  });

  it("maps funding, open interest, basis, and long-short ratio sections", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v5/market/funding/history") {
        return jsonResponse({
          retCode: 0,
          retMsg: "OK",
          result: {
            list: [{ fundingRate: "0.0001", fundingRateTimestamp: "1781174400000" }],
          },
        });
      }
      if (url.pathname === "/v5/market/open-interest") {
        return jsonResponse({
          retCode: 0,
          retMsg: "OK",
          result: { list: [{ openInterest: "12345", timestamp: "1781174400000" }] },
        });
      }
      if (url.pathname === "/v5/market/tickers") {
        return jsonResponse({
          retCode: 0,
          retMsg: "OK",
          time: 1_781_174_400_000,
          result: {
            list: [{ markPrice: "100100", indexPrice: "100000" }],
          },
        });
      }
      if (url.pathname === "/v5/market/account-ratio") {
        return jsonResponse({
          retCode: 0,
          retMsg: "OK",
          result: {
            list: [{ buyRatio: "0.55", sellRatio: "0.45", timestamp: "1781174400000" }],
          },
        });
      }
      return jsonResponse({ retCode: 10001, retMsg: "unexpected" });
    };
    const provider = new BybitCryptoProvider({ fetchImpl });
    const result = await provider.getDerivativesData({
      ...derivativesQuery(["funding", "open_interest", "basis", "long_short_ratio"]),
      venue: "bybit",
    });

    expect(result.status).toBe("complete");
    expect(result.sections[0].records[0]).toMatchObject({
      metric: "funding_rate",
      value: 0.0001,
      unit: "decimal",
    });
    expect(result.sections[1].records[0]).toMatchObject({
      metric: "open_interest",
      value: 12345,
      unit: "contracts",
    });
    expect(result.sections[2].records[0]).toMatchObject({
      metric: "basis",
      value: 0.001,
      methodology: "derived",
    });
    expect(result.sections[3].records[0]).toMatchObject({
      metric: "long_short_ratio",
      value: 0.55 / 0.45,
      unit: "ratio",
    });
  });

  it("returns explicit partial sections instead of fabricating unsupported history", async () => {
    const provider = new BybitCryptoProvider({
      fetchImpl: async () => jsonResponse({ retCode: 10001, retMsg: "not called" }),
    });
    const result = await provider.getDerivativesData({
      ...derivativesQuery(["taker_flow", "liquidations"]),
      venue: "bybit",
    });

    expect(result.status).toBe("partial");
    expect(result.sections.every((section) => section.status === "partial")).toBe(true);
    expect(result.sections.every((section) => section.issues?.[0].code === "PARTIAL_DATA")).toBe(
      true,
    );
  });
});

describe("DeribitCryptoProvider", () => {
  it("resolves a perpetual instrument and maps ticker plus chart data", async () => {
    const urls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === "/api/v2/public/get_instruments") {
        return jsonResponse({
          jsonrpc: "2.0",
          result: [
            {
              instrument_name: "BTC-PERPETUAL",
              kind: "future",
              base_currency: "BTC",
              quote_currency: "USD",
              settlement_period: "perpetual",
              expiration_timestamp: 3_250_368_000_000,
              is_active: true,
              tick_size: 0.5,
              min_trade_amount: 10,
            },
          ],
        });
      }
      if (url.pathname === "/api/v2/public/ticker") {
        return jsonResponse({
          jsonrpc: "2.0",
          result: {
            timestamp: 1_781_174_400_000,
            last_price: 100000,
            stats: { volume: 123.5, volume_usd: 12_350_000, price_change: 2.5 },
          },
        });
      }
      if (url.pathname === "/api/v2/public/get_tradingview_chart_data") {
        return jsonResponse({
          jsonrpc: "2.0",
          result: {
            status: "ok",
            ticks: [1_780_329_600_000],
            open: [99000],
            high: [101000],
            low: [98000],
            close: [100000],
            volume: [10],
          },
        });
      }
      return jsonResponse({ jsonrpc: "2.0", error: { code: 10000, message: "unexpected" } });
    };
    const provider = new DeribitCryptoProvider({
      fetchImpl,
      now: () => 1_781_174_400_000,
    });
    const result = await provider.getMarketData({
      ...marketQuery(["snapshot", "ohlcv"]),
      symbol: "BTC/USD",
      quoteAsset: "USD",
      marketType: "perpetual",
      venue: "deribit",
    });

    expect(result.status).toBe("complete");
    expect(result.sections[0].records[0]).toMatchObject({
      provider: "deribit",
      venue: "deribit",
      symbol: "BTC/USD",
      price: 100000,
      change24h: 0.025,
    });
    expect(result.sections[1].records[0]).toMatchObject({
      interval: "1d",
      open: 99000,
      close: 100000,
    });
    expect(
      urls.find((url) => url.pathname.endsWith("get_instruments"))?.searchParams.get("kind"),
    ).toBe("future");
    expect(
      urls.find((url) => url.pathname.endsWith("ticker"))?.searchParams.get("instrument_name"),
    ).toBe("BTC-PERPETUAL");
  });

  it("maps current funding, open interest, and derived basis from the public ticker", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v2/public/get_instruments") {
        return jsonResponse({
          jsonrpc: "2.0",
          result: [
            {
              instrument_name: "BTC-PERPETUAL",
              kind: "future",
              base_currency: "BTC",
              quote_currency: "USD",
              settlement_period: "perpetual",
              expiration_timestamp: 3_250_368_000_000,
              is_active: true,
            },
          ],
        });
      }
      if (url.pathname === "/api/v2/public/ticker") {
        return jsonResponse({
          jsonrpc: "2.0",
          result: {
            timestamp: 1_781_174_400_000,
            funding_8h: 0.0001,
            open_interest: 12345,
            mark_price: 100100,
            index_price: 100000,
          },
        });
      }
      return jsonResponse({ jsonrpc: "2.0", error: { code: 10000, message: "unexpected" } });
    };
    const provider = new DeribitCryptoProvider({ fetchImpl });
    const result = await provider.getDerivativesData({
      ...derivativesQuery(["funding", "open_interest", "basis"]),
      symbol: "BTC/USD",
      quoteAsset: "USD",
      venue: "deribit",
    });

    expect(result.status).toBe("complete");
    expect(result.sections[0].records[0]).toMatchObject({
      metric: "funding_rate",
      value: 0.0001,
      interval: "8h",
    });
    expect(result.sections[1].records[0]).toMatchObject({
      metric: "open_interest",
      value: 12345,
      unit: "USD",
    });
    expect(result.sections[2].records[0]).toMatchObject({
      metric: "basis",
      value: 0.001,
      methodology: "derived",
    });
  });

  it("uses funding history when a time range is requested", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v2/public/get_instruments") {
        return jsonResponse({
          jsonrpc: "2.0",
          result: [
            {
              instrument_name: "BTC-PERPETUAL",
              kind: "future",
              base_currency: "BTC",
              quote_currency: "USD",
              settlement_period: "perpetual",
              is_active: true,
            },
          ],
        });
      }
      if (url.pathname === "/api/v2/public/get_funding_rate_history") {
        return jsonResponse({
          jsonrpc: "2.0",
          result: [{ timestamp: 1_781_174_400_000, interest_8h: 0.0002 }],
        });
      }
      return jsonResponse({ jsonrpc: "2.0", error: { code: 10000, message: "unexpected" } });
    };
    const provider = new DeribitCryptoProvider({ fetchImpl });
    const result = await provider.getDerivativesData({
      ...derivativesQuery(["funding"]),
      symbol: "BTC/USD",
      quoteAsset: "USD",
      venue: "deribit",
      startTime: "2026-06-10T00:00:00.000Z",
      endTime: "2026-06-11T00:00:00.000Z",
    });

    expect(result.sections[0].records[0]).toMatchObject({
      value: 0.0002,
      methodology: "reported",
    });
  });

  it("returns partial data for unsupported derivatives history instead of ignoring the range", async () => {
    const provider = new DeribitCryptoProvider({
      fetchImpl: async () => jsonResponse({ jsonrpc: "2.0", result: [] }),
    });
    const result = await provider.getDerivativesData({
      ...derivativesQuery(["open_interest", "long_short_ratio"]),
      symbol: "BTC/USD",
      quoteAsset: "USD",
      venue: "deribit",
      startTime: "2026-06-10T00:00:00.000Z",
      endTime: "2026-06-11T00:00:00.000Z",
    });

    expect(result.status).toBe("partial");
    expect(result.sections.every((section) => section.status === "partial")).toBe(true);
  });

  it("clears a failed ticker request so the next call can retry", async () => {
    let tickerCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v2/public/get_instruments") {
        return jsonResponse({
          jsonrpc: "2.0",
          result: [
            {
              instrument_name: "BTC-PERPETUAL",
              kind: "future",
              base_currency: "BTC",
              quote_currency: "USD",
              settlement_period: "perpetual",
              is_active: true,
            },
          ],
        });
      }
      if (url.pathname === "/api/v2/public/ticker") {
        tickerCalls += 1;
        if (tickerCalls === 1) {
          return jsonResponse({
            jsonrpc: "2.0",
            error: { code: 10000, message: "temporary failure" },
          });
        }
        return jsonResponse({
          jsonrpc: "2.0",
          result: {
            timestamp: 1_781_174_400_000,
            last_price: 100000,
            stats: { volume: 1, volume_usd: 100000, price_change: 0 },
          },
        });
      }
      return jsonResponse({ jsonrpc: "2.0", error: { code: 10000, message: "unexpected" } });
    };
    const provider = new DeribitCryptoProvider({ fetchImpl });
    const query = {
      ...marketQuery(["snapshot"]),
      symbol: "BTC/USD",
      quoteAsset: "USD",
      marketType: "perpetual" as const,
      venue: "deribit",
    };

    await expect(provider.getMarketData(query)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    await expect(provider.getMarketData(query)).resolves.toMatchObject({ status: "complete" });
    expect(tickerCalls).toBe(2);
  });
});
