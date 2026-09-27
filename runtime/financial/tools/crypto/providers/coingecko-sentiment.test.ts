import { describe, expect, it } from "vitest";
import type { CryptoSentimentDataQuery } from "../types.js";
import { CoinGeckoSentimentProvider } from "./coingecko-sentiment.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CoinGeckoSentimentProvider", () => {
  it("maps trending search interest and sends the Demo key header", async () => {
    let initValue: RequestInit | undefined;
    const provider = new CoinGeckoSentimentProvider({
      apiKey: "test-key",
      now: () => 1_781_395_200_000,
      fetchImpl: async (_input, init) => {
        initValue = init;
        return jsonResponse({
          coins: [
            {
              item: {
                id: "bitcoin",
                name: "Bitcoin",
                symbol: "BTC",
                market_cap_rank: 1,
                score: 0,
              },
            },
          ],
        });
      },
    });
    const query: CryptoSentimentDataQuery = {
      provider: "coingecko",
      dataTypes: ["trending"],
      limit: 5,
    };
    const result = await provider.getSentimentData(query);

    expect(new Headers(initValue?.headers).get("x-cg-demo-api-key")).toBe("test-key");
    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "trending",
      signalType: "coingecko_search_interest",
      assetId: "bitcoin",
      symbol: "BTC",
      marketCapRank: 1,
      score: 0,
      attribution: "CoinGecko",
    });
  });
});
