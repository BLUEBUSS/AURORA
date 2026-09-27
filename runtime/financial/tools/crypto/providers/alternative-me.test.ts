import { describe, expect, it } from "vitest";
import type { CryptoSentimentDataQuery } from "../types.js";
import { AlternativeMeSentimentProvider } from "./alternative-me.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AlternativeMeSentimentProvider", () => {
  it("maps Fear & Greed as a Bitcoin-market proxy with attribution", async () => {
    let requested: URL | undefined;
    const provider = new AlternativeMeSentimentProvider({
      fetchImpl: async (input) => {
        requested = new URL(String(input));
        return jsonResponse({
          name: "Fear and Greed Index",
          data: [
            {
              value: "72",
              value_classification: "Greed",
              timestamp: "1781395200",
              time_until_update: "3600",
            },
          ],
        });
      },
    });
    const query: CryptoSentimentDataQuery = {
      provider: "alternative_me",
      dataTypes: ["fear_greed"],
      limit: 1,
    };
    const result = await provider.getSentimentData(query);

    expect(requested?.pathname).toBe("/fng/");
    expect(requested?.searchParams.get("limit")).toBe("1");
    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "fear_greed",
      signalType: "bitcoin_market_sentiment_proxy",
      value: 72,
      unit: "index_points",
      classification: "Greed",
      marketScope: "bitcoin_market_proxy",
      attribution: "Alternative.me Fear and Greed Index",
    });
  });
});
