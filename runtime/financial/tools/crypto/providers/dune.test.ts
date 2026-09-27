import { describe, expect, it } from "vitest";
import type { CryptoOnchainDataQuery } from "../types.js";
import { DuneCryptoProvider } from "./dune.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function query(queryId: number): CryptoOnchainDataQuery {
  return {
    provider: "dune",
    chain: "ethereum",
    dataTypes: ["saved_query"],
    queryId,
    limit: 2,
  };
}

describe("DuneCryptoProvider", () => {
  it("rejects unapproved saved queries before making a request", async () => {
    let called = false;
    const provider = new DuneCryptoProvider({
      apiKey: "test-key",
      allowedQueryIds: [123],
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });

    await expect(provider.getOnchainData(query(999))).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(called).toBe(false);
  });

  it("reads only the latest saved-query result and maps rows", async () => {
    let requestUrl: URL | undefined;
    let requestInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      requestUrl = new URL(String(input));
      requestInit = init;
      return jsonResponse({
        execution_id: "exec-1",
        query_id: 123,
        result: {
          metadata: { column_names: ["day", "active_addresses"] },
          rows: [
            { day: "2026-06-11", active_addresses: 100 },
            { day: "2026-06-12", active_addresses: 120 },
          ],
        },
      });
    };
    const provider = new DuneCryptoProvider({
      apiKey: "test-key",
      allowedQueryIds: [123],
      fetchImpl,
      now: () => 1781260800000,
    });
    const result = await provider.getOnchainData(query(123));

    expect(requestUrl?.pathname).toBe("/api/v1/query/123/results");
    expect(requestUrl?.searchParams.get("limit")).toBe("2");
    expect(new Headers(requestInit?.headers).get("X-Dune-API-Key")).toBe("test-key");
    expect(requestInit?.method).toBeUndefined();
    expect(result.sections[0].records).toEqual([
      expect.objectContaining({
        queryId: 123,
        executionId: "exec-1",
        row: { day: "2026-06-11", active_addresses: 100 },
      }),
      expect.objectContaining({
        queryId: 123,
        executionId: "exec-1",
        row: { day: "2026-06-12", active_addresses: 120 },
      }),
    ]);
  });
});
