import Ajv from "ajv";
import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { describe, expect, it, vi } from "vitest";
import { popRawRecords } from "../../raw-data-stash.js";
import {
  CryptoAssetDataInputSchema,
  createCryptoAssetDataTool,
  type CryptoAssetDataQuery,
  type CryptoAssetDataResult,
  type CryptoAssetProvider,
  type CryptoAssetRecord,
} from "./index.js";

const ajv = new Ajv.default({ allErrors: true, strict: false });
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const api = { logger } as unknown as AgentToolApi;

function schemaAccepts(value: unknown): boolean {
  return ajv.compile(CryptoAssetDataInputSchema)(value) as boolean;
}

function fakeAssetProvider(): CryptoAssetProvider {
  return {
    id: "fake-asset",
    getAssetData: vi.fn(
      async (query: CryptoAssetDataQuery): Promise<CryptoAssetDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [
            {
              dataType,
              assetId: query.asset,
              symbol: "BTC",
              name: "Bitcoin",
              provider: "fake-asset",
              venue: "aggregate",
              timestamp: "2026-06-12T00:00:00.000Z",
              quoteCurrency: query.quoteCurrency,
              methodology: "reported",
            } as CryptoAssetRecord,
          ],
        })),
      }),
    ),
  };
}

describe("crypto asset input schema", () => {
  it("accepts asset overview and discovery queries", () => {
    expect(schemaAccepts({ asset: "bitcoin", bundle: "asset_overview" })).toBe(true);
    expect(schemaAccepts({ bundle: "market_discovery", limit: 20 })).toBe(true);
    expect(schemaAccepts({ data_type: "rankings", quote_currency: "usd" })).toBe(true);
  });

  it("rejects market microstructure and arbitrary provider parameters", () => {
    expect(schemaAccepts({ asset: "bitcoin", data_type: "orderbook" })).toBe(false);
    expect(schemaAccepts({ asset: "bitcoin", data_type: "profile", endpoint: "/coins" })).toBe(
      false,
    );
  });
});

describe("crypto asset tool with a fake provider", () => {
  it("expands asset_overview and normalizes asset plus quote currency", async () => {
    const provider = fakeAssetProvider();
    const tool = createCryptoAssetDataTool(api, provider)({});
    const result = await tool.execute("asset-overview", {
      asset: " Bitcoin ",
      bundle: "asset_overview",
      quote_currency: "usd",
    });

    expect(tool.name).toBe("crypto_asset_data");
    expect(result.isError).not.toBe(true);
    expect(provider.getAssetData).toHaveBeenCalledWith({
      asset: "bitcoin",
      provider: "auto",
      quoteCurrency: "USD",
      dataTypes: ["profile", "market_snapshot", "supply", "rankings", "exchanges"],
      category: undefined,
      limit: undefined,
    });
    expect(popRawRecords("asset-overview")?.records).toHaveLength(5);
  });

  it("expands market discovery without requiring an asset", async () => {
    const provider = fakeAssetProvider();
    const tool = createCryptoAssetDataTool(api, provider)({});
    const result = await tool.execute("asset-discovery", {
      bundle: "market_discovery",
      limit: 10,
    });

    expect(result.isError).not.toBe(true);
    expect(provider.getAssetData).toHaveBeenCalledWith(
      expect.objectContaining({ dataTypes: ["categories", "trending"], quoteCurrency: "USD" }),
    );
  });

  it.each(["profile", "supply", "exchanges"] as const)(
    "requires asset for %s",
    async (dataType) => {
      const provider = fakeAssetProvider();
      const tool = createCryptoAssetDataTool(api, provider)({});
      const result = await tool.execute(`asset-missing-${dataType}`, { data_type: dataType });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
      expect(provider.getAssetData).not.toHaveBeenCalled();
    },
  );

  it("rejects CoinPaprika for unsupported discovery sections", async () => {
    const provider = fakeAssetProvider();
    const tool = createCryptoAssetDataTool(api, provider)({});
    const result = await tool.execute("asset-paprika-trending", {
      provider: "coinpaprika",
      data_type: "trending",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"code":"INVALID_ARGUMENT"');
    expect(provider.getAssetData).not.toHaveBeenCalled();
  });
});
