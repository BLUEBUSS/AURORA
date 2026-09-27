import { describe, expect, it } from "vitest";
import type { CryptoOptionsDataQuery } from "../types.js";
import { DeribitCryptoOptionsProvider } from "./deribit-options.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function query(
  dataTypes: CryptoOptionsDataQuery["dataTypes"],
  overrides: Partial<CryptoOptionsDataQuery> = {},
): CryptoOptionsDataQuery {
  return {
    baseAsset: "BTC",
    quoteAsset: "USD",
    symbol: "BTC/USD",
    venue: "deribit",
    dataTypes,
    limit: 20,
    ...overrides,
  };
}

const instruments = [
  {
    instrument_name: "BTC-26JUN26-100000-C",
    kind: "option",
    base_currency: "BTC",
    quote_currency: "BTC",
    counter_currency: "USD",
    settlement_currency: "BTC",
    expiration_timestamp: 1_782_458_000_000,
    strike: 100000,
    option_type: "call",
    is_active: true,
    contract_size: 1,
    tick_size: 0.0001,
    min_trade_amount: 0.1,
  },
  {
    instrument_name: "BTC-26JUN26-100000-P",
    kind: "option",
    base_currency: "BTC",
    quote_currency: "BTC",
    counter_currency: "USD",
    settlement_currency: "BTC",
    expiration_timestamp: 1_782_458_000_000,
    strike: 100000,
    option_type: "put",
    is_active: true,
  },
  {
    instrument_name: "BTC-31JUL26-110000-C",
    kind: "option",
    base_currency: "BTC",
    quote_currency: "BTC",
    counter_currency: "USD",
    settlement_currency: "BTC",
    expiration_timestamp: 1_785_482_000_000,
    strike: 110000,
    option_type: "call",
    is_active: true,
  },
  {
    instrument_name: "BTC-26JUN26-130000-C",
    kind: "option",
    base_currency: "BTC",
    quote_currency: "BTC",
    counter_currency: "USD",
    settlement_currency: "BTC",
    expiration_timestamp: 1_782_458_000_000,
    strike: 130000,
    option_type: "call",
    is_active: true,
  },
];

describe("DeribitCryptoOptionsProvider", () => {
  it("maps and filters the public option instrument chain", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v2/public/get_instruments");
      expect(url.searchParams.get("kind")).toBe("option");
      return jsonResponse({ jsonrpc: "2.0", result: instruments });
    };
    const provider = new DeribitCryptoOptionsProvider({
      fetchImpl,
      now: () => 1_781_174_400_000,
    });
    const result = await provider.getOptionsData(
      query(["chain"], {
        expiry: "2026-06-26T00:00:00.000Z",
        optionType: "call",
      }),
    );

    expect(result.status).toBe("complete");
    expect(result.sections[0].records).toHaveLength(2);
    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "chain",
      instrumentName: "BTC-26JUN26-100000-C",
      strike: 100000,
      optionType: "call",
      provider: "deribit",
      venue: "deribit",
    });
  });

  it("maps exact-contract greeks and implied volatility with one ticker request", async () => {
    let tickerCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("get_instruments")) {
        return jsonResponse({ jsonrpc: "2.0", result: instruments });
      }
      if (url.pathname.endsWith("ticker")) {
        tickerCalls += 1;
        expect(url.searchParams.get("instrument_name")).toBe("BTC-26JUN26-100000-C");
        return jsonResponse({
          jsonrpc: "2.0",
          result: {
            timestamp: 1_781_174_400_000,
            greeks: { delta: 0.55, gamma: 0.0001, vega: 40, theta: -20, rho: 5 },
            mark_iv: 55,
            bid_iv: 54,
            ask_iv: 56,
          },
        });
      }
      return jsonResponse({ jsonrpc: "2.0", error: { code: 10000, message: "unexpected" } });
    };
    const provider = new DeribitCryptoOptionsProvider({ fetchImpl });
    const result = await provider.getOptionsData(
      query(["chain", "greeks", "implied_volatility"], {
        expiry: "2026-06-26T00:00:00.000Z",
        strike: 100000,
        optionType: "call",
      }),
    );

    expect(result.status).toBe("complete");
    expect(result.sections[1].records[0]).toMatchObject({
      dataType: "greeks",
      delta: 0.55,
      vega: 40,
      methodology: "reported",
    });
    expect(result.sections[2].records[0]).toMatchObject({
      dataType: "implied_volatility",
      markIv: 0.55,
      bidIv: 0.54,
      askIv: 0.56,
      unit: "decimal",
    });
    expect(tickerCalls).toBe(1);
  });

  it("maps exact-contract orderbook and recent trades", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("get_instruments")) {
        return jsonResponse({ jsonrpc: "2.0", result: instruments });
      }
      if (url.pathname.endsWith("get_order_book")) {
        return jsonResponse({
          jsonrpc: "2.0",
          result: {
            timestamp: 1_781_174_400_000,
            bids: [[0.05, 2]],
            asks: [[0.06, 3]],
          },
        });
      }
      if (url.pathname.endsWith("get_last_trades_by_instrument")) {
        return jsonResponse({
          jsonrpc: "2.0",
          result: {
            trades: [
              {
                timestamp: 1_781_174_400_000,
                trade_id: "trade-1",
                direction: "buy",
                price: 0.055,
                amount: 1,
                iv: 55.5,
              },
            ],
          },
        });
      }
      return jsonResponse({ jsonrpc: "2.0", error: { code: 10000, message: "unexpected" } });
    };
    const provider = new DeribitCryptoOptionsProvider({ fetchImpl });
    const exact = {
      expiry: "2026-06-26T00:00:00.000Z",
      strike: 100000,
      optionType: "call" as const,
    };
    const result = await provider.getOptionsData(query(["orderbook", "trades"], exact));

    expect(result.sections[0].records).toHaveLength(2);
    expect(result.sections[0].records[0]).toMatchObject({ side: "bid", price: 0.05 });
    expect(result.sections[1].records[0]).toMatchObject({
      tradeId: "trade-1",
      side: "buy",
      impliedVolatility: 0.555,
    });
  });

  it("builds DVOL, ATM IV, and expiry structure sections from public summaries", async () => {
    let summaryCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("get_instruments")) {
        return jsonResponse({ jsonrpc: "2.0", result: instruments });
      }
      if (url.pathname.endsWith("get_book_summary_by_currency")) {
        summaryCalls += 1;
        return jsonResponse({
          jsonrpc: "2.0",
          result: [
            {
              instrument_name: "BTC-26JUN26-100000-C",
              mark_iv: 55,
              underlying_price: 101000,
              open_interest: 100,
              volume: 10,
            },
            {
              instrument_name: "BTC-26JUN26-100000-P",
              mark_iv: 57,
              underlying_price: 101000,
              open_interest: 80,
              volume: 8,
            },
            {
              instrument_name: "BTC-31JUL26-110000-C",
              mark_iv: 60,
              underlying_price: 101000,
              open_interest: 50,
              volume: 5,
            },
            {
              instrument_name: "BTC-26JUN26-130000-C",
              mark_iv: 75,
              underlying_price: 101000,
              open_interest: 10,
              volume: 1,
            },
          ],
        });
      }
      if (url.pathname.endsWith("get_volatility_index_data")) {
        return jsonResponse({
          jsonrpc: "2.0",
          result: { data: [[1_781_174_400_000, 54, 56, 53, 55]], continuation: null },
        });
      }
      return jsonResponse({ jsonrpc: "2.0", error: { code: 10000, message: "unexpected" } });
    };
    const provider = new DeribitCryptoOptionsProvider({
      fetchImpl,
      now: () => 1_781_174_400_000,
    });
    const result = await provider.getOptionsData(
      query(["volatility_index", "implied_volatility", "expiry_structure"], {
        interval: "1d",
      }),
    );

    expect(result.status).toBe("complete");
    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "volatility_index",
      indexName: "BTC-DVOL",
      close: 55,
    });
    expect(result.sections[1].records).toHaveLength(3);
    expect(result.sections[1].records[0]).toMatchObject({ markIv: 0.55 });
    expect(result.sections[2].records[0]).toMatchObject({
      callOpenInterest: 110,
      putOpenInterest: 80,
      totalOpenInterest: 190,
    });
    expect(summaryCalls).toBe(1);
  });

  it("keeps instrument caches isolated by currency", async () => {
    const requestedCurrencies: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const currency = url.searchParams.get("currency") ?? "";
      requestedCurrencies.push(currency);
      return jsonResponse({
        jsonrpc: "2.0",
        result: [
          {
            instrument_name: `${currency}-26JUN26-1000-C`,
            kind: "option",
            base_currency: currency,
            quote_currency: currency,
            counter_currency: "USD",
            settlement_currency: currency,
            expiration_timestamp: 1_782_458_000_000,
            strike: 1000,
            option_type: "call",
            is_active: true,
          },
        ],
      });
    };
    const provider = new DeribitCryptoOptionsProvider({ fetchImpl });

    const btc = await provider.getOptionsData(query(["chain"]));
    const eth = await provider.getOptionsData({
      ...query(["chain"]),
      baseAsset: "ETH",
      symbol: "ETH/USD",
    });

    expect(btc.sections[0].records[0]).toMatchObject({ baseAsset: "BTC" });
    expect(eth.sections[0].records[0]).toMatchObject({ baseAsset: "ETH" });
    expect(requestedCurrencies).toEqual(["BTC", "ETH"]);
  });
});
