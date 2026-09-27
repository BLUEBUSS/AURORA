import { describe, expect, it, vi } from "vitest";
import { UsDataProviderError } from "./errors.js";
import type { UsEquityMarketProvider } from "./provider.js";
import { EodhdEquityMarketProvider } from "./providers/eodhd.js";
import { FredMacroProvider } from "./providers/fred.js";
import { UsDataProviderRouter } from "./providers/router.js";
import { SecEdgarProvider } from "./providers/sec-edgar.js";

function jsonResponse(value: unknown): Response {
  return Response.json(value);
}

describe("US data providers", () => {
  it("maps FRED macro observations into provider-neutral records", async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/fred/series/observations");
      expect(url.searchParams.get("series_id")).toBe("CPIAUCSL");
      expect(url.searchParams.get("units")).toBe("lin");
      return jsonResponse({
        observations: [
          {
            realtime_start: "2026-06-01",
            realtime_end: "2026-06-01",
            date: "2026-05-01",
            value: "321.1",
          },
        ],
      });
    });
    const provider = new FredMacroProvider({
      apiKey: "fred-key",
      fetchImpl,
      baseUrl: "https://fred.test",
    });

    const result = await provider.getMacroIndicatorData({
      indicator: "cpi_headline",
      provider: "fred",
      units: "level",
      limit: 1,
    });

    expect(result.sections[0].records[0]).toMatchObject({
      dataType: "macro_observation",
      seriesId: "CPIAUCSL",
      value: 321.1,
      provider: "fred",
      source: "FRED",
    });
  });

  it("maps EODHD daily bars and normalizes dotted US tickers", async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/BRK-B.US");
      expect(url.searchParams.get("period")).toBe("d");
      return jsonResponse([
        {
          date: "2026-06-19",
          open: "100",
          high: "110",
          low: "99",
          close: "108",
          adjusted_close: "107",
          volume: "12345",
        },
      ]);
    });
    const provider = new EodhdEquityMarketProvider({
      apiToken: "eod-token",
      fetchImpl,
      baseUrl: "https://eod.test/",
    });

    const result = await provider.getEquityMarketData({
      symbol: "BRK.B",
      provider: "eodhd",
      frequency: "daily",
      adjustment: "adjusted",
      limit: 1,
    });

    expect(result.sections[0].records[0]).toMatchObject({
      symbol: "BRK.B",
      close: 108,
      adjustedClose: 107,
      volume: 12345,
      provider: "eodhd",
    });
  });

  it("maps SEC filings and companyfacts with required user-agent headers", async () => {
    const requests: Array<{ pathname: string; userAgent?: string }> = [];
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        pathname: url.pathname,
        userAgent: new Headers(init?.headers).get("user-agent") ?? undefined,
      });
      if (url.pathname === "/files/company_tickers.json") {
        return jsonResponse({
          "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
        });
      }
      if (url.pathname === "/submissions/CIK0000320193.json") {
        return jsonResponse({
          name: "Apple Inc.",
          filings: {
            recent: {
              accessionNumber: ["0000320193-26-000001"],
              filingDate: ["2026-01-31"],
              reportDate: ["2025-12-31"],
              form: ["10-K"],
              primaryDocument: ["aapl-20251231.htm"],
              primaryDocDescription: ["Annual report"],
            },
          },
        });
      }
      return jsonResponse({
        facts: {
          "us-gaap": {
            Revenues: {
              label: "Revenue",
              units: {
                USD: [
                  {
                    val: 100,
                    fy: 2025,
                    fp: "FY",
                    form: "10-K",
                    filed: "2026-01-31",
                    start: "2025-01-01",
                    end: "2025-12-31",
                  },
                ],
              },
            },
          },
        },
      });
    });
    const provider = new SecEdgarProvider({
      userAgent: "Antlyst/0.1 test@example.com",
      fetchImpl,
      filesBaseUrl: "https://sec-files.test",
      dataBaseUrl: "https://sec-data.test",
    });

    const filings = await provider.getEquityFilings({
      symbol: "AAPL",
      provider: "sec_edgar",
      forms: ["10-K"],
      limit: 5,
    });
    const fundamentals = await provider.getEquityFundamentals({
      symbol: "AAPL",
      provider: "sec_edgar",
      statement: "income",
      concepts: ["Revenues"],
      annualOnly: true,
      limit: 1,
    });

    expect(requests.every((request) => request.userAgent === "Antlyst/0.1 test@example.com")).toBe(
      true,
    );
    expect(filings.sections[0].records[0]).toMatchObject({
      form: "10-K",
      cik: "0000320193",
      url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-20251231.htm",
    });
    expect(fundamentals.sections[0].records[0]).toMatchObject({
      concept: "Revenues",
      value: 100,
      fiscalYear: 2025,
      provider: "sec_edgar",
    });
  });
});

describe("UsDataProviderRouter", () => {
  it("uses Alpha Vantage as an automatic market-data fallback when EODHD is unavailable", async () => {
    const eodhd = fakeMarketProvider("eodhd", async () => {
      throw new UsDataProviderError("UPSTREAM_UNAVAILABLE", "EODHD unavailable.");
    });
    const alphaVantage = fakeMarketProvider("alpha_vantage", async () => ({
      status: "complete",
      sections: [{ dataType: "ohlcv", status: "complete", records: [] }],
    }));
    const router = new UsDataProviderRouter({ eodhd, alphaVantage });

    const result = await router.getEquityMarketData({
      symbol: "AAPL",
      provider: "auto",
      frequency: "daily",
      adjustment: "adjusted",
    });

    expect(alphaVantage.getEquityMarketData).toHaveBeenCalled();
    expect(result.issues).toEqual([
      { code: "PROVIDER_FALLBACK", message: "EODHD failed; Alpha Vantage fallback was used." },
    ]);
  });

  it("uses Alpha Vantage when EODHD returns a successful but empty result", async () => {
    const eodhd = fakeMarketProvider("eodhd", async () => ({
      status: "complete",
      sections: [{ dataType: "ohlcv", status: "complete", records: [] }],
    }));
    const alphaVantage = fakeMarketProvider("alpha_vantage", async () => ({
      status: "complete",
      sections: [
        {
          dataType: "ohlcv",
          status: "complete",
          records: [
            {
              dataType: "ohlcv",
              symbol: "AAPL",
              date: "2026-07-16",
              open: 210,
              high: 214,
              low: 209,
              close: 213,
              volume: 50_000_000,
              frequency: "daily",
              currency: "USD",
              provider: "alpha_vantage",
              source: "Alpha Vantage",
            },
          ],
        },
      ],
    }));
    const router = new UsDataProviderRouter({ eodhd, alphaVantage });

    const result = await router.getEquityMarketData({
      symbol: "AAPL",
      provider: "auto",
      frequency: "daily",
      adjustment: "adjusted",
    });

    expect(alphaVantage.getEquityMarketData).toHaveBeenCalled();
    expect(result.sections[0]?.records).toHaveLength(1);
    expect(result.issues).toEqual([
      {
        code: "PROVIDER_FALLBACK",
        message: "EODHD returned no records; Alpha Vantage fallback was used.",
      },
    ]);
  });

  it("reports missing provider configuration at call time", async () => {
    const router = new UsDataProviderRouter({});

    expect(() =>
      router.getMacroIndicatorData({
        indicator: "cpi_headline",
        provider: "auto",
        units: "level",
      }),
    ).toThrowError(expect.objectContaining({ code: "CONFIGURATION_MISSING" }));
  });
});

function fakeMarketProvider(
  id: string,
  getEquityMarketData: UsEquityMarketProvider["getEquityMarketData"],
): UsEquityMarketProvider {
  return { id, getEquityMarketData: vi.fn(getEquityMarketData) };
}
