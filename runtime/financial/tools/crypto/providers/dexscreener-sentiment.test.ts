import { describe, expect, it } from "vitest";
import type { CryptoSentimentDataQuery } from "../types.js";
import { DexScreenerSentimentProvider } from "./dexscreener-sentiment.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DexScreenerSentimentProvider", () => {
  it("maps latest profiles and boosts as labeled discovery signals", async () => {
    const paths: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname === "/token-profiles/latest/v1") {
        return jsonResponse([
          {
            url: "https://dexscreener.com/solana/token",
            chainId: "solana",
            tokenAddress: "token",
            description: "New profile",
            links: [],
          },
        ]);
      }
      return jsonResponse([
        {
          url: "https://dexscreener.com/solana/boosted",
          chainId: "solana",
          tokenAddress: "boosted",
          amount: 50,
          totalAmount: 200,
          description: "Paid boost",
          links: [],
        },
      ]);
    };
    const provider = new DexScreenerSentimentProvider({
      fetchImpl,
      now: () => 1_781_395_200_000,
    });
    const query: CryptoSentimentDataQuery = {
      provider: "dexscreener",
      dataTypes: ["new_tokens", "promotion_activity"],
      chain: "solana",
      limit: 5,
    };
    const result = await provider.getSentimentData(query);

    expect(paths).toEqual(["/token-profiles/latest/v1", "/token-boosts/latest/v1"]);
    expect(result.sections[0].records[0]).toMatchObject({
      signalType: "dex_profile_recency",
      chain: "solana",
      tokenAddress: "token",
      attribution: "DEX Screener",
    });
    expect(result.sections[1].records[0]).toMatchObject({
      signalType: "paid_promotion_activity",
      promotionType: "boost",
      amount: 50,
      totalAmount: 200,
      attribution: "DEX Screener",
    });
  });
});
