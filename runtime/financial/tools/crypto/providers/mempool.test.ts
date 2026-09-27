import { describe, expect, it } from "vitest";
import type { CryptoOnchainDataQuery } from "../types.js";
import { MempoolCryptoProvider } from "./mempool.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function query(
  dataTypes: CryptoOnchainDataQuery["dataTypes"],
  overrides: Partial<CryptoOnchainDataQuery> = {},
): CryptoOnchainDataQuery {
  return { provider: "mempool", chain: "bitcoin", dataTypes, limit: 5, ...overrides };
}

describe("MempoolCryptoProvider", () => {
  it("maps network, fees, blocks, and recent mempool data", async () => {
    const paths: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname === "/api/mempool") {
        return jsonResponse({ count: 12, vsize: 3456, total_fee: 7890 });
      }
      if (url.pathname === "/api/v1/fees/recommended") {
        return jsonResponse({
          fastestFee: 10,
          halfHourFee: 8,
          hourFee: 6,
          economyFee: 3,
          minimumFee: 1,
        });
      }
      if (url.pathname === "/api/v1/blocks") {
        return jsonResponse([
          {
            id: "block-hash",
            height: 900000,
            timestamp: 1781260800,
            tx_count: 2500,
            size: 1200000,
            weight: 3999000,
          },
        ]);
      }
      return jsonResponse([{ txid: "txid", fee: 1200, vsize: 200, value: 500000 }]);
    };
    const provider = new MempoolCryptoProvider({ fetchImpl, now: () => 1781260800000 });
    const result = await provider.getOnchainData(
      query(["network_metrics", "gas_fees", "blocks", "mempool"]),
    );

    expect(paths).toEqual([
      "/api/mempool",
      "/api/v1/fees/recommended",
      "/api/v1/blocks",
      "/api/mempool/recent",
    ]);
    expect(result.sections[0].records.map((item) => item.metric)).toEqual([
      "transaction_count",
      "virtual_size",
      "total_fee",
    ]);
    expect(result.sections[1].records[0]).toMatchObject({
      metric: "fastest_fee",
      metricValue: 10,
      unit: "sat/vB",
    });
    expect(result.sections[2].records[0]).toMatchObject({
      blockHash: "block-hash",
      blockNumber: 900000,
      metric: "transaction_count",
      metricValue: 2500,
    });
    expect(result.sections[3].records[0]).toMatchObject({
      transactionHash: "txid",
      fee: 1200,
      feeUnit: "sats",
      value: 500000,
      unit: "sats",
    });
  });

  it("maps address chain and mempool summaries", async () => {
    const address = "bc1qexample000000000000000000000000000000000";
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        address,
        chain_stats: {
          funded_txo_count: 3,
          funded_txo_sum: 5000,
          spent_txo_count: 1,
          spent_txo_sum: 1000,
          tx_count: 4,
        },
        mempool_stats: {
          funded_txo_count: 1,
          funded_txo_sum: 700,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 1,
        },
      });
    const provider = new MempoolCryptoProvider({ fetchImpl, now: () => 1781260800000 });
    const result = await provider.getOnchainData(query(["address_activity"], { address }));

    expect(result.sections[0].records).toEqual([
      expect.objectContaining({
        address,
        metric: "confirmed_balance",
        metricValue: 4000,
        unit: "sats",
      }),
      expect.objectContaining({
        address,
        metric: "confirmed_transaction_count",
        metricValue: 4,
        unit: "count",
      }),
      expect.objectContaining({
        address,
        metric: "mempool_balance",
        metricValue: 700,
        unit: "sats",
      }),
      expect.objectContaining({
        address,
        metric: "mempool_transaction_count",
        metricValue: 1,
        unit: "count",
      }),
    ]);
  });
});
