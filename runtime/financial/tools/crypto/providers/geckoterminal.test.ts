import { describe, expect, it } from "vitest";
import type { CryptoDexDataQuery } from "../types.js";
import { GeckoTerminalCryptoProvider } from "./geckoterminal.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function query(
  dataTypes: CryptoDexDataQuery["dataTypes"],
  overrides: Partial<CryptoDexDataQuery> = {},
): CryptoDexDataQuery {
  return {
    dataTypes,
    provider: "geckoterminal",
    chain: "ethereum",
    poolAddress: "0xpool",
    limit: 10,
    ...overrides,
  };
}

const pool = {
  id: "eth_0xpool",
  type: "pool",
  attributes: {
    address: "0xpool",
    name: "WETH / USDC 0.05%",
    base_token_price_usd: "1656",
    base_token_price_native_currency: "1",
    price_change_percentage: { h24: "2.5" },
    volume_usd: { h24: "50000000" },
    reserve_in_usd: "85000000",
    market_cap_usd: "4300000000",
    fdv_usd: "4400000000",
    transactions: {
      m5: { buys: 2, sells: 1, buyers: 2, sellers: 1 },
      h1: { buys: 20, sells: 10, buyers: 15, sellers: 8 },
      h6: { buys: 100, sells: 80, buyers: 60, sellers: 50 },
      h24: { buys: 400, sells: 350, buyers: 200, sellers: 180 },
    },
  },
  relationships: {
    base_token: { data: { id: "eth_0xbase", type: "token" } },
    quote_token: { data: { id: "eth_0xquote", type: "token" } },
    dex: { data: { id: "uniswap_v3", type: "dex" } },
  },
};

describe("GeckoTerminalCryptoProvider", () => {
  it("reuses one pool response for snapshot, liquidity, and activity", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v2/networks/eth/pools/0xpool");
      return jsonResponse({ data: pool });
    };
    const provider = new GeckoTerminalCryptoProvider({
      fetchImpl,
      now: () => 1_781_260_800_000,
    });
    const result = await provider.getDexData(
      query(["pool_snapshot", "liquidity", "transaction_activity"]),
    );

    expect(calls).toBe(1);
    expect(result.sections[0].records[0]).toMatchObject({
      venue: "uniswap_v3",
      priceUsd: 1656,
      liquidityUsd: 85_000_000,
    });
    expect(result.sections[1].records[0]).toMatchObject({ dataType: "liquidity" });
    expect(result.sections[2].records).toHaveLength(4);
    expect(result.sections[2].records[3]).toMatchObject({ window: "24h", buys: 400, sells: 350 });
  });

  it("maps OHLCV and trades using GeckoTerminal network ids", async () => {
    const paths: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith("/ohlcv/hour")) {
        expect(url.searchParams.get("aggregate")).toBe("1");
        return jsonResponse({
          data: {
            attributes: { ohlcv_list: [[1_781_174_400, 1600, 1700, 1500, 1650, 1_000_000]] },
          },
        });
      }
      return jsonResponse({
        data: [
          {
            id: "trade-1",
            attributes: {
              tx_hash: "0xtx",
              block_timestamp: "2026-06-11T00:00:00Z",
              kind: "buy",
              volume_in_usd: "1000",
              from_token_amount: "1000",
              to_token_amount: "0.6",
              price_to_in_usd: "1650",
            },
          },
        ],
      });
    };
    const provider = new GeckoTerminalCryptoProvider({ fetchImpl });
    const result = await provider.getDexData(query(["ohlcv", "trades"], { interval: "1h" }));

    expect(paths).toEqual([
      "/api/v2/networks/eth/pools/0xpool/ohlcv/hour",
      "/api/v2/networks/eth/pools/0xpool/trades",
    ]);
    expect(result.sections[0].records[0]).toMatchObject({
      interval: "1h",
      open: 1600,
      close: 1650,
      volumeUsd: 1_000_000,
    });
    expect(result.sections[1].records[0]).toMatchObject({
      tradeId: "trade-1",
      transactionHash: "0xtx",
      side: "buy",
      volumeUsd: 1000,
    });
  });

  it("maps token pools from a contract address", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v2/networks/eth/tokens/0xtoken/pools");
      return jsonResponse({ data: [pool] });
    };
    const provider = new GeckoTerminalCryptoProvider({ fetchImpl });
    const result = await provider.getDexData(
      query(["pools"], { poolAddress: undefined, contractAddress: "0xtoken" }),
    );

    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "pools",
      poolAddress: "0xpool",
      tokenAddress: "0xtoken",
    });
  });
});
