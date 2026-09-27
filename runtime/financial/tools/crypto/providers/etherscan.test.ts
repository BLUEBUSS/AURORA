import { describe, expect, it } from "vitest";
import type { CryptoOnchainDataQuery } from "../types.js";
import { EtherscanCryptoProvider } from "./etherscan.js";

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
  return { provider: "etherscan", chain: "ethereum", dataTypes, limit: 10, ...overrides };
}

describe("EtherscanCryptoProvider", () => {
  it("maps native transactions and token transfers with provider-neutral units", async () => {
    const urls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.searchParams.get("action") === "txlist") {
        return jsonResponse({
          status: "1",
          message: "OK",
          result: [
            {
              blockNumber: "100",
              timeStamp: "1781260800",
              hash: "0xtx",
              from: "0x0000000000000000000000000000000000000001",
              to: "0x000000000000000000000000000000000000dead",
              value: "1000000000000000000",
              gasPrice: "20000000000",
              gasUsed: "21000",
              isError: "0",
            },
          ],
        });
      }
      return jsonResponse({
        status: "1",
        message: "OK",
        result: [
          {
            blockNumber: "101",
            timeStamp: "1781260860",
            hash: "0xtoken",
            from: "0x000000000000000000000000000000000000dead",
            to: "0x0000000000000000000000000000000000000002",
            contractAddress: "0x0000000000000000000000000000000000000010",
            value: "2500000",
            tokenName: "USD Coin",
            tokenSymbol: "USDC",
            tokenDecimal: "6",
          },
        ],
      });
    };
    const provider = new EtherscanCryptoProvider({ apiKey: "test-key", fetchImpl });
    const result = await provider.getOnchainData(
      query(["address_activity", "token_transfers"], {
        address: "0x000000000000000000000000000000000000dead",
      }),
    );

    expect(urls.map((url) => url.searchParams.get("action"))).toEqual(["txlist", "tokentx"]);
    expect(urls[0].searchParams.get("chainid")).toBe("1");
    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "address_activity",
      direction: "in",
      value: 1,
      unit: "ETH",
      fee: 0.00042,
      feeUnit: "ETH",
      success: true,
    });
    expect(result.sections[1].records[0]).toMatchObject({
      dataType: "token_transfers",
      direction: "out",
      value: 2.5,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
    });
  });

  it("maps logs and gas oracle metrics and caps free-tier pages at 1000 rows", async () => {
    const urls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.searchParams.get("action") === "getLogs") {
        return jsonResponse({
          status: "1",
          message: "OK",
          result: [
            {
              address: "0x0000000000000000000000000000000000000010",
              topics: [`0x${"a".repeat(64)}`],
              data: "0x01",
              blockNumber: "0x64",
              timeStamp: "0x6a2a8d80",
              transactionHash: "0xlog",
            },
          ],
        });
      }
      return jsonResponse({
        status: "1",
        message: "OK",
        result: {
          SafeGasPrice: "3",
          ProposeGasPrice: "4",
          FastGasPrice: "5",
          suggestBaseFee: "2.5",
        },
      });
    };
    const provider = new EtherscanCryptoProvider({ apiKey: "test-key", fetchImpl });
    const result = await provider.getOnchainData(
      query(["logs", "gas_fees"], {
        contractAddress: "0x0000000000000000000000000000000000000010",
        fromBlock: 1,
        toBlock: 200,
        topic0: `0x${"a".repeat(64)}`,
        limit: 5000,
      }),
    );

    expect(urls[0].searchParams.get("offset")).toBe("1000");
    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "logs",
      blockNumber: 100,
      transactionHash: "0xlog",
      logData: "0x01",
    });
    expect(result.sections[1].records.map((item) => [item.metric, item.metricValue])).toEqual([
      ["safe_gas_price", 3],
      ["propose_gas_price", 4],
      ["fast_gas_price", 5],
      ["base_fee", 2.5],
    ]);
  });

  it("rejects chains outside the approved Etherscan free tier before fetching", async () => {
    let called = false;
    const provider = new EtherscanCryptoProvider({
      apiKey: "test-key",
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });

    await expect(
      provider.getOnchainData(query(["gas_fees"], { chain: "base" })),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(called).toBe(false);
  });
});
