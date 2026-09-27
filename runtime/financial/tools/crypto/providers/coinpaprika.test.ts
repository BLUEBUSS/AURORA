import { describe, expect, it } from "vitest";
import type { CryptoAssetDataQuery } from "../types.js";
import { CoinPaprikaCryptoProvider } from "./coinpaprika.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function query(dataTypes: CryptoAssetDataQuery["dataTypes"]): CryptoAssetDataQuery {
  return { provider: "coinpaprika", asset: "bitcoin", quoteCurrency: "USD", dataTypes, limit: 10 };
}

describe("CoinPaprikaCryptoProvider", () => {
  it("maps no-key profile, ticker, supply, ranking, and exchanges", async () => {
    const paths: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname === "/v1/search")
        return jsonResponse({
          currencies: [
            { id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, is_active: true },
          ],
        });
      if (url.pathname === "/v1/coins/btc-bitcoin/exchanges")
        return jsonResponse([
          {
            id: "binance",
            name: "Binance",
            adjusted_volume_24h_share: 20,
            quotes: { USD: { adjusted_volume_24h: 1000 } },
          },
        ]);
      if (url.pathname === "/v1/coins/btc-bitcoin")
        return jsonResponse({
          id: "btc-bitcoin",
          name: "Bitcoin",
          symbol: "BTC",
          rank: 1,
          description: "Peer-to-peer money",
          started_at: "2009-01-03",
          type: "coin",
          open_source: true,
          hardware_wallet: true,
          proof_type: "Proof of Work",
          org_structure: "Decentralized",
          links: { website: ["https://bitcoin.org"] },
          tags: [{ id: "layer-1", name: "Layer 1" }],
        });
      return jsonResponse({
        id: "btc-bitcoin",
        name: "Bitcoin",
        symbol: "BTC",
        rank: 1,
        circulating_supply: 20000000,
        total_supply: 21000000,
        max_supply: 21000000,
        last_updated: "2026-06-12T00:00:00Z",
        quotes: {
          USD: {
            price: 100000,
            volume_24h: 50000000000,
            market_cap: 2000000000000,
            percent_change_24h: 2.5,
            ath_price: 110000,
          },
        },
      });
    };
    const provider = new CoinPaprikaCryptoProvider({ fetchImpl });
    const result = await provider.getAssetData(
      query(["profile", "market_snapshot", "supply", "rankings", "exchanges"]),
    );

    expect(paths.filter((path) => path === "/v1/search")).toHaveLength(1);
    expect(result.sections[0].records[0]).toMatchObject({
      assetId: "btc-bitcoin",
      homepage: "https://bitcoin.org",
    });
    expect(result.sections[1].records[0]).toMatchObject({
      price: 100000,
      marketCap: 2000000000000,
    });
    expect(result.sections[2].records[0]).toMatchObject({
      circulatingSupply: 20000000,
      totalSupply: 21000000,
    });
    expect(result.sections[3].records[0]).toMatchObject({ marketCapRank: 1 });
    expect(result.sections[4].records[0]).toMatchObject({ exchangeId: "binance", volume24h: 1000 });
  });

  it("rejects unsupported discovery sections", async () => {
    const provider = new CoinPaprikaCryptoProvider({ fetchImpl: async () => jsonResponse({}) });
    await expect(provider.getAssetData(query(["trending"]))).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
});
