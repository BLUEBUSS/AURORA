import { describe, expect, it } from "vitest";
import type { CryptoDefiDataQuery } from "../types.js";
import { DefiLlamaCryptoProvider } from "./defillama.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function query(
  dataTypes: CryptoDefiDataQuery["dataTypes"],
  overrides: Partial<CryptoDefiDataQuery> = {},
): CryptoDefiDataQuery {
  return { dataTypes, limit: 10, ...overrides };
}

describe("DefiLlamaCryptoProvider", () => {
  it("maps protocol TVL and current chain TVL", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/protocol/aave") {
        return jsonResponse({
          id: "parent#aave",
          name: "Aave",
          symbol: "AAVE",
          category: "Lending",
          chains: ["Ethereum", "Arbitrum"],
          tvl: [
            { date: 1_781_174_400, totalLiquidityUSD: 10_000_000_000 },
            { date: 1_781_260_800, totalLiquidityUSD: 10_500_000_000 },
          ],
        });
      }
      if (url.pathname === "/v2/chains") {
        return jsonResponse([
          { name: "Ethereum", tvl: 70_000_000_000, tokenSymbol: "ETH", chainId: 1 },
          { name: "Arbitrum", tvl: 3_000_000_000, tokenSymbol: "ARB", chainId: 42161 },
        ]);
      }
      return jsonResponse({ error: "unexpected" }, 404);
    };
    const provider = new DefiLlamaCryptoProvider({
      fetchImpl,
      now: () => 1_781_260_800_000,
    });
    const result = await provider.getDefiData(
      query(["protocol", "chain_tvl"], { protocol: "aave", chain: "ethereum" }),
    );

    expect(result.status).toBe("complete");
    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "protocol",
      protocol: "aave",
      metric: "total_tvl",
      value: 10_500_000_000,
      unit: "USD",
    });
    expect(result.sections[1].records).toEqual([
      expect.objectContaining({ chain: "ethereum", value: 70_000_000_000 }),
    ]);
  });

  it("uses the dedicated stablecoin and yield free hosts", async () => {
    const hosts: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      hosts.push(url.host);
      if (url.host === "stablecoins.llama.fi") {
        return jsonResponse({
          peggedAssets: [
            {
              id: "1",
              name: "USD Coin",
              symbol: "USDC",
              pegType: "peggedUSD",
              price: 0.9999,
              circulating: { peggedUSD: 75_000_000_000 },
              chainCirculating: {
                Ethereum: { current: { peggedUSD: 35_000_000_000 } },
                Arbitrum: { current: { peggedUSD: 5_000_000_000 } },
              },
            },
          ],
        });
      }
      if (url.host === "yields.llama.fi") {
        return jsonResponse({
          data: [
            {
              pool: "pool-1",
              chain: "Arbitrum",
              project: "aave-v3",
              symbol: "USDC",
              tvlUsd: 100_000_000,
              apy: 4.2,
              apyBase: 3.8,
              apyReward: 0.4,
              stablecoin: true,
              exposure: "single",
              timestamp: "2026-06-12T00:00:00.000Z",
            },
          ],
        });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    };
    const provider = new DefiLlamaCryptoProvider({ fetchImpl });
    const result = await provider.getDefiData(
      query(["stablecoins", "yields"], { chain: "arbitrum" }),
    );

    expect(hosts).toEqual(["stablecoins.llama.fi", "yields.llama.fi"]);
    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "stablecoins",
      chain: "arbitrum",
      symbol: "USDC",
      value: 5_000_000_000,
    });
    expect(result.sections[1].records[0]).toMatchObject({
      dataType: "yields",
      poolId: "pool-1",
      protocol: "aave-v3",
      apy: 4.2,
      tvlUsd: 100_000_000,
    });
  });

  it("maps dimensions and combines fee plus revenue metrics", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(`${url.pathname}?${url.searchParams}`);
      const protocol = {
        name: "Uniswap",
        slug: "uniswap",
        chains: ["Ethereum", "Arbitrum"],
        total24h: 100,
        total7d: 700,
        total30d: 3000,
        change_1d: 2.5,
      };
      if (url.searchParams.get("dataType") === "dailyRevenue") {
        return jsonResponse({ protocols: [{ ...protocol, total24h: 20 }] });
      }
      return jsonResponse({ protocols: [protocol] });
    };
    const provider = new DefiLlamaCryptoProvider({ fetchImpl });
    const result = await provider.getDefiData(
      query(["dex_volume", "options_volume", "open_interest", "fees_revenue"], {
        protocol: "uniswap",
      }),
    );

    expect(result.sections.map((section) => section.records[0].metric)).toEqual([
      "dex_volume",
      "options_volume",
      "open_interest",
      "fees",
    ]);
    expect(result.sections[3].records[0]).toMatchObject({
      total24hUsd: 100,
      revenue24hUsd: 20,
    });
    expect(urls.some((url) => url.includes("dailyRevenue"))).toBe(true);
  });
});
