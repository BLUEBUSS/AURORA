import { describe, expect, it } from "vitest";
import type { CryptoAssetDataQuery } from "../types.js";
import { CoinGeckoCryptoProvider } from "./coingecko.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function query(
  dataTypes: CryptoAssetDataQuery["dataTypes"],
  overrides: Partial<CryptoAssetDataQuery> = {},
): CryptoAssetDataQuery {
  return {
    provider: "coingecko",
    asset: "bitcoin",
    quoteCurrency: "USD",
    dataTypes,
    limit: 10,
    ...overrides,
  };
}

describe("CoinGeckoCryptoProvider", () => {
  it("maps an asset overview while resolving the aggregate asset once", async () => {
    const paths: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname === "/api/v3/search")
        return jsonResponse({
          coins: [{ id: "bitcoin", name: "Bitcoin", symbol: "BTC", market_cap_rank: 1 }],
        });
      if (url.pathname === "/api/v3/coins/bitcoin/tickers")
        return jsonResponse({
          tickers: [
            {
              market: { identifier: "binance", name: "Binance" },
              trust_score: "green",
              converted_volume: { usd: 1000 },
            },
          ],
        });
      if (url.pathname === "/api/v3/coins/bitcoin")
        return jsonResponse({
          id: "bitcoin",
          symbol: "btc",
          name: "Bitcoin",
          description: { en: "Peer-to-peer money" },
          links: { homepage: ["https://bitcoin.org"] },
          image: { large: "https://image" },
          genesis_date: "2009-01-03",
          hashing_algorithm: "SHA-256",
          categories: ["Layer 1"],
          platforms: { "": "" },
          last_updated: "2026-06-12T00:00:00Z",
        });
      return jsonResponse([
        {
          id: "bitcoin",
          symbol: "btc",
          name: "Bitcoin",
          current_price: 100000,
          market_cap: 2000000000000,
          fully_diluted_valuation: 2100000000000,
          total_volume: 50000000000,
          high_24h: 101000,
          low_24h: 98000,
          price_change_percentage_24h: 2.5,
          circulating_supply: 20000000,
          total_supply: 21000000,
          max_supply: 21000000,
          market_cap_rank: 1,
          last_updated: "2026-06-12T00:00:00Z",
        },
      ]);
    };
    const provider = new CoinGeckoCryptoProvider({ apiKey: "test-key", fetchImpl });
    const result = await provider.getAssetData(
      query(["profile", "market_snapshot", "supply", "rankings", "exchanges"]),
    );

    expect(paths.filter((path) => path === "/api/v3/search")).toHaveLength(1);
    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "profile",
      assetId: "bitcoin",
      homepage: "https://bitcoin.org",
    });
    expect(result.sections[1].records[0]).toMatchObject({
      price: 100000,
      marketCap: 2000000000000,
      quoteCurrency: "USD",
    });
    expect(result.sections[2].records[0]).toMatchObject({
      circulatingSupply: 20000000,
      maxSupply: 21000000,
    });
    expect(result.sections[3].records[0]).toMatchObject({ marketCapRank: 1 });
    expect(result.sections[4].records[0]).toMatchObject({
      exchangeId: "binance",
      exchangeName: "Binance",
      volume24h: 1000,
    });
  });

  it("maps categories and trending discovery", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/coins/categories/list"))
        return jsonResponse([{ category_id: "layer-1", name: "Layer 1" }]);
      return jsonResponse({
        coins: [
          { item: { id: "bitcoin", name: "Bitcoin", symbol: "BTC", market_cap_rank: 1, score: 0 } },
        ],
      });
    };
    const provider = new CoinGeckoCryptoProvider({
      apiKey: "test-key",
      fetchImpl,
      now: () => 1781260800000,
    });
    const result = await provider.getAssetData(
      query(["categories", "trending"], { asset: undefined }),
    );

    expect(result.sections[0].records[0]).toMatchObject({
      categoryId: "layer-1",
      categoryName: "Layer 1",
    });
    expect(result.sections[1].records[0]).toMatchObject({
      assetId: "bitcoin",
      symbol: "BTC",
      score: 0,
    });
  });
});
