import Ajv from "ajv";
import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { describe, expect, it, vi } from "vitest";
import { popRawRecords } from "../../raw-data-stash.js";
import {
  CryptoSentimentDataInputSchema,
  createCryptoSentimentDataTool,
  type CryptoSentimentDataQuery,
  type CryptoSentimentDataResult,
  type CryptoSentimentProvider,
  type CryptoSentimentRecord,
} from "./index.js";

const ajv = new Ajv.default({ allErrors: true, strict: false });
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const api = { logger } as unknown as AgentToolApi;

function schemaAccepts(value: unknown): boolean {
  return ajv.compile(CryptoSentimentDataInputSchema)(value) as boolean;
}

function fakeSentimentProvider(): CryptoSentimentProvider {
  return {
    id: "fake-sentiment",
    getSentimentData: vi.fn(
      async (query: CryptoSentimentDataQuery): Promise<CryptoSentimentDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [
            {
              dataType,
              provider: "fake-sentiment",
              venue: "aggregate",
              timestamp: "2026-06-14T00:00:00.000Z",
              signalType: dataType,
              attribution: "fake",
              methodology: "reported",
            } as CryptoSentimentRecord,
          ],
        })),
      }),
    ),
  };
}

describe("crypto sentiment input schema", () => {
  it("accepts market sentiment and token discovery bundles", () => {
    expect(schemaAccepts({ bundle: "market_sentiment", limit: 7 })).toBe(true);
    expect(schemaAccepts({ bundle: "token_discovery", chain: "solana" })).toBe(true);
  });

  it("rejects arbitrary social-score inputs", () => {
    expect(schemaAccepts({ data_type: "fear_greed", social_score: true })).toBe(false);
    expect(schemaAccepts({ data_type: "twitter_sentiment" })).toBe(false);
  });
});

describe("crypto sentiment tool with a fake provider", () => {
  it("expands market_sentiment into Bitcoin proxy and search-interest sections", async () => {
    const provider = fakeSentimentProvider();
    const tool = createCryptoSentimentDataTool(api, provider)({});
    const result = await tool.execute("sentiment-market", {
      bundle: "market_sentiment",
      limit: 5,
    });

    expect(tool.name).toBe("crypto_sentiment_data");
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("quality: good");
    expect(provider.getSentimentData).toHaveBeenCalledWith({
      dataTypes: ["fear_greed", "trending"],
      provider: "auto",
      chain: undefined,
      limit: 5,
    });
    expect(popRawRecords("sentiment-market")?.records).toHaveLength(2);
  });

  it("expands token_discovery and canonicalizes chain", async () => {
    const provider = fakeSentimentProvider();
    const tool = createCryptoSentimentDataTool(api, provider)({});
    const result = await tool.execute("sentiment-discovery", {
      bundle: "token_discovery",
      chain: "SOL",
    });

    expect(result.isError).not.toBe(true);
    expect(provider.getSentimentData).toHaveBeenCalledWith(
      expect.objectContaining({
        dataTypes: ["new_tokens", "promotion_activity"],
        chain: "solana",
      }),
    );
  });

  it.each([
    ["alternative_me", "trending"],
    ["coingecko", "fear_greed"],
    ["dexscreener", "fear_greed"],
  ] as const)("rejects provider %s for %s", async (providerId, dataType) => {
    const provider = fakeSentimentProvider();
    const tool = createCryptoSentimentDataTool(api, provider)({});
    const result = await tool.execute(`sentiment-${providerId}-${dataType}`, {
      provider: providerId,
      data_type: dataType,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
    expect(provider.getSentimentData).not.toHaveBeenCalled();
  });
});
