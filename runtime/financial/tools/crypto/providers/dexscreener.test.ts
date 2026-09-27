import { describe, expect, it } from "vitest";
import type { CryptoDexDataQuery } from "../types.js";
import { DexScreenerCryptoProvider } from "./dexscreener.js";

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
    provider: "dexscreener",
    chain: "ethereum",
    poolAddress: "0xpool",
    limit: 10,
    ...overrides,
  };
}

const pair = {
  chainId: "ethereum",
  dexId: "uniswap",
  pairAddress: "0xpool",
  baseToken: { address: "0xbase", name: "Wrapped Ether", symbol: "WETH" },
  quoteToken: { address: "0xquote", name: "USD Coin", symbol: "USDC" },
  priceNative: "1656",
  priceUsd: "1656",
  txns: {
    m5: { buys: 2, sells: 1 },
    h1: { buys: 20, sells: 10 },
    h6: { buys: 100, sells: 80 },
    h24: { buys: 400, sells: 350 },
  },
  volume: { h24: 50_000_000 },
  priceChange: { h24: 2.5 },
  liquidity: { usd: 85_000_000 },
  fdv: 4_400_000_000,
  marketCap: 4_300_000_000,
};

describe("DexScreenerCryptoProvider", () => {
  it("maps text search results without treating ticker as identity", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/latest/dex/search");
      expect(url.searchParams.get("q")).toBe("WETH USDC");
      return jsonResponse({ schemaVersion: "1.0.0", pairs: [pair] });
    };
    const provider = new DexScreenerCryptoProvider({ fetchImpl });
    const result = await provider.getDexData(
      query(["token_search"], { chain: undefined, poolAddress: undefined, query: "WETH USDC" }),
    );

    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "token_search",
      chain: "ethereum",
      poolAddress: "0xpool",
      venue: "uniswap",
    });
  });

  it("uses token-pairs v1 for address-first pool discovery", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/token-pairs/v1/ethereum/0xtoken");
      return jsonResponse([pair]);
    };
    const provider = new DexScreenerCryptoProvider({ fetchImpl });
    const result = await provider.getDexData(
      query(["pools"], { poolAddress: undefined, contractAddress: "0xtoken" }),
    );

    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "pools",
      tokenAddress: "0xtoken",
      liquidityUsd: 85_000_000,
    });
  });

  it("reuses one pair response for pool overview sections", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      const url = new URL(String(input));
      expect(url.pathname).toBe("/latest/dex/pairs/ethereum/0xpool");
      return jsonResponse({ schemaVersion: "1.0.0", pairs: [pair] });
    };
    const provider = new DexScreenerCryptoProvider({ fetchImpl });
    const result = await provider.getDexData(
      query(["pool_snapshot", "liquidity", "transaction_activity"]),
    );

    expect(calls).toBe(1);
    expect(result.sections[0].records[0]).toMatchObject({
      priceUsd: 1656,
      volume24hUsd: 50_000_000,
    });
    expect(result.sections[1].records[0]).toMatchObject({ liquidityUsd: 85_000_000 });
    expect(result.sections[2].records).toHaveLength(4);
  });
});
