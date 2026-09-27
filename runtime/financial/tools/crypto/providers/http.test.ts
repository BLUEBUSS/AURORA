import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const dispatchers: string[] = [];
  const requests: Array<{ input: string | URL; init?: Record<string, unknown> }> = [];
  class ProxyAgent {
    constructor(url: string) {
      dispatchers.push(url);
    }
  }
  const undiciFetch = vi.fn(async (input: string | URL, init?: Record<string, unknown>) => {
    requests.push({ input, init });
    return new Response("{}", { status: 200 });
  });
  return { ProxyAgent, dispatchers, requests, undiciFetch };
});

vi.mock("undici", () => ({
  ProxyAgent: mocks.ProxyAgent,
  fetch: mocks.undiciFetch,
}));

import { createCryptoFetch, requestJson } from "./http.js";

describe("createCryptoFetch", () => {
  it("uses the dedicated crypto proxy without exposing it to provider code", async () => {
    const fetcher = createCryptoFetch({
      env: { CRYPTO_PROXY: "http://127.0.0.1:7890" },
    });

    await fetcher("https://api.binance.com/api/v3/ping");

    expect(mocks.dispatchers).toEqual(["http://127.0.0.1:7890"]);
    expect(mocks.requests[0].init?.dispatcher).toBeInstanceOf(mocks.ProxyAgent);
  });

  it("falls back to HTTPS_PROXY when no crypto-specific proxy is configured", async () => {
    const fetcher = createCryptoFetch({
      env: { HTTPS_PROXY: "http://proxy.local:8080" },
    });

    await fetcher("https://api.binance.com/api/v3/ping");

    expect(mocks.dispatchers.at(-1)).toBe("http://proxy.local:8080");
  });
});

describe("requestJson", () => {
  it("retries a transient network failure before returning data", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const sleep = vi.fn(async () => undefined);

    await expect(
      requestJson(fetcher, new URL("https://api.binance.com/api/v3/ping"), undefined, {
        maxAttempts: 2,
        retryDelayMs: 0,
        sleep,
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a local network-route failure from a confirmed upstream outage", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      requestJson(fetcher, new URL("https://fapi.binance.com/fapi/v1/time"), undefined, {
        maxAttempts: 1,
      }),
    ).rejects.toMatchObject({
      code: "NETWORK_UNAVAILABLE",
      message: expect.stringContaining("does not confirm an upstream outage"),
    });
  });

  it.each([
    [
      "a refused loopback proxy",
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:7897"), {
        code: "ECONNREFUSED",
        address: "127.0.0.1",
      }),
      "proxy",
      "proxy listener refused",
    ],
    [
      "a DNS lookup failure",
      Object.assign(new Error("getaddrinfo ENOTFOUND fapi.binance.com"), {
        code: "ENOTFOUND",
      }),
      "dns",
      "DNS resolution failed",
    ],
    [
      "a connect timeout",
      Object.assign(new Error("Connect Timeout Error"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
      "connect",
      "connection timed out before the upstream replied",
    ],
  ] as const)(
    "classifies %s without claiming an upstream outage",
    async (_label, cause, stage, text) => {
      const fetcher = vi.fn(async () => {
        throw new TypeError("fetch failed", { cause });
      });

      await expect(
        requestJson(fetcher, new URL("https://fapi.binance.com/fapi/v1/time"), undefined, {
          maxAttempts: 1,
        }),
      ).rejects.toMatchObject({
        code: "NETWORK_UNAVAILABLE",
        message: expect.stringContaining(text),
        details: {
          networkStage: stage,
          causeCode: cause.code,
          upstreamResponded: false,
        },
      });
    },
  );

  it("marks a Binance HTTP 503 as a confirmed upstream response", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 503 }));

    await expect(
      requestJson(fetcher, new URL("https://fapi.binance.com/fapi/v1/time"), undefined, {
        maxAttempts: 1,
      }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      message: "fapi.binance.com returned HTTP 503.",
      details: { upstreamResponded: true, httpStatus: 503 },
    });
  });

  it("does not retry authentication failures", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));
    const sleep = vi.fn(async () => undefined);

    await expect(
      requestJson(fetcher, new URL("https://api.example.com/data"), undefined, {
        maxAttempts: 3,
        retryDelayMs: 0,
        sleep,
      }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("aborts a request that exceeds its timeout", async () => {
    const fetcher = vi.fn(
      async (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): Promise<Response> => {
        if (!init?.signal) throw new Error("missing timeout signal");
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      },
    );

    await expect(
      requestJson(fetcher, new URL("https://api.example.com/data"), undefined, {
        maxAttempts: 1,
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
