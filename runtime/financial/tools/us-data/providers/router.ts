import { UsDataProviderError } from "../errors.js";
import type {
  UsDataProvider,
  UsEquityFilingsProvider,
  UsEquityFundamentalsProvider,
  UsEquityMarketProvider,
  UsMacroProvider,
} from "../provider.js";
import type {
  UsDataProviderIssue,
  UsEquityFilingsQuery,
  UsEquityFilingsResult,
  UsEquityFundamentalsQuery,
  UsEquityFundamentalsResult,
  UsEquityMarketDataQuery,
  UsEquityMarketDataResult,
  UsMacroDataQuery,
  UsMacroIndicatorResult,
} from "../types.js";
import { AlphaVantageEquityMarketProvider } from "./alpha-vantage.js";
import { EodhdEquityMarketProvider } from "./eodhd.js";
import { FredMacroProvider } from "./fred.js";
import { SecEdgarProvider } from "./sec-edgar.js";

interface UsDataProviderRouterOptions {
  macro?: UsMacroProvider;
  eodhd?: UsEquityMarketProvider;
  alphaVantage?: UsEquityMarketProvider;
  filings?: UsEquityFilingsProvider;
  fundamentals?: UsEquityFundamentalsProvider;
}

export class UsDataProviderRouter implements UsDataProvider {
  readonly id = "us-data-router";
  private readonly macro?: UsMacroProvider;
  private readonly eodhd?: UsEquityMarketProvider;
  private readonly alphaVantage?: UsEquityMarketProvider;
  private readonly filings?: UsEquityFilingsProvider;
  private readonly fundamentals?: UsEquityFundamentalsProvider;

  constructor(options: UsDataProviderRouterOptions) {
    this.macro = options.macro;
    this.eodhd = options.eodhd;
    this.alphaVantage = options.alphaVantage;
    this.filings = options.filings;
    this.fundamentals = options.fundamentals;
  }

  getMacroIndicatorData(query: UsMacroDataQuery): Promise<UsMacroIndicatorResult> {
    if (query.provider !== "auto" && query.provider !== "fred") {
      throw new UsDataProviderError(
        "INVALID_ARGUMENT",
        `Macro provider "${query.provider}" is not supported.`,
      );
    }
    return this.requireMacroProvider().getMacroIndicatorData(query);
  }

  async getEquityMarketData(query: UsEquityMarketDataQuery): Promise<UsEquityMarketDataResult> {
    if (query.provider === "eodhd") {
      return this.requireEquityMarketProvider(
        this.eodhd,
        "EODHD",
        "EODHD_API_TOKEN",
      ).getEquityMarketData(query);
    }
    if (query.provider === "alpha_vantage") {
      return this.requireEquityMarketProvider(
        this.alphaVantage,
        "Alpha Vantage",
        "ALPHA_VANTAGE_API_KEY",
      ).getEquityMarketData(query);
    }

    if (this.eodhd) {
      try {
        const primary = await this.eodhd.getEquityMarketData(query);
        const hasRecords = primary.sections.some((section) => section.records.length > 0);
        if (hasRecords || !this.alphaVantage) return primary;
        const fallback = await this.alphaVantage.getEquityMarketData(query);
        return withFallbackIssue(
          fallback,
          "EODHD returned no records; Alpha Vantage fallback was used.",
        );
      } catch (primaryError) {
        if (!this.alphaVantage || isFatalFallbackError(primaryError)) throw primaryError;
        const fallback = await this.alphaVantage.getEquityMarketData(query);
        return withFallbackIssue(fallback, "EODHD failed; Alpha Vantage fallback was used.");
      }
    }
    if (this.alphaVantage) {
      return withFallbackIssue(
        await this.alphaVantage.getEquityMarketData(query),
        "EODHD is not configured; Alpha Vantage fallback was used.",
      );
    }
    throw new UsDataProviderError(
      "CONFIGURATION_MISSING",
      "Configure EODHD_API_TOKEN for the primary US equity market provider, or ALPHA_VANTAGE_API_KEY for fallback.",
    );
  }

  getEquityFilings(query: UsEquityFilingsQuery): Promise<UsEquityFilingsResult> {
    if (query.provider !== "auto" && query.provider !== "sec_edgar") {
      throw new UsDataProviderError(
        "INVALID_ARGUMENT",
        `Filings provider "${query.provider}" is not supported.`,
      );
    }
    return this.requireFilingsProvider().getEquityFilings(query);
  }

  getEquityFundamentals(query: UsEquityFundamentalsQuery): Promise<UsEquityFundamentalsResult> {
    if (query.provider !== "auto" && query.provider !== "sec_edgar") {
      throw new UsDataProviderError(
        "INVALID_ARGUMENT",
        `Fundamentals provider "${query.provider}" is not supported.`,
      );
    }
    return this.requireFundamentalsProvider().getEquityFundamentals(query);
  }

  private requireMacroProvider(): UsMacroProvider {
    if (!this.macro) {
      throw new UsDataProviderError("CONFIGURATION_MISSING", "FRED_API_KEY is required.");
    }
    return this.macro;
  }

  private requireFilingsProvider(): UsEquityFilingsProvider {
    if (!this.filings) {
      throw new UsDataProviderError(
        "CONFIGURATION_MISSING",
        "SEC_EDGAR_USER_AGENT or FINCLAW_SEC_USER_AGENT is required.",
      );
    }
    return this.filings;
  }

  private requireFundamentalsProvider(): UsEquityFundamentalsProvider {
    if (!this.fundamentals) {
      throw new UsDataProviderError(
        "CONFIGURATION_MISSING",
        "SEC_EDGAR_USER_AGENT or FINCLAW_SEC_USER_AGENT is required.",
      );
    }
    return this.fundamentals;
  }

  private requireEquityMarketProvider(
    provider: UsEquityMarketProvider | undefined,
    name: string,
    envName: string,
  ): UsEquityMarketProvider {
    if (!provider) {
      throw new UsDataProviderError("CONFIGURATION_MISSING", `${envName} is required for ${name}.`);
    }
    return provider;
  }
}

export function createDefaultUsDataProvider(
  env: Record<string, string | undefined> = process.env,
): UsDataProviderRouter {
  const proxyUrl = env.US_DATA_PROXY ?? env.HTTPS_PROXY ?? env.HTTP_PROXY ?? env.ALL_PROXY;
  const fredKey = env.FRED_API_KEY?.trim();
  const eodhdToken = (env.EODHD_API_TOKEN ?? env.EODHD_API_KEY)?.trim();
  const alphaVantageKey = env.ALPHA_VANTAGE_API_KEY?.trim();
  const secUserAgent = (env.SEC_EDGAR_USER_AGENT ?? env.FINCLAW_SEC_USER_AGENT)?.trim();

  const macro = fredKey ? new FredMacroProvider({ apiKey: fredKey, proxyUrl }) : undefined;
  const eodhd = eodhdToken
    ? new EodhdEquityMarketProvider({ apiToken: eodhdToken, proxyUrl })
    : undefined;
  const alphaVantage = alphaVantageKey
    ? new AlphaVantageEquityMarketProvider({ apiKey: alphaVantageKey, proxyUrl })
    : undefined;
  const sec = secUserAgent
    ? new SecEdgarProvider({ userAgent: secUserAgent, proxyUrl })
    : undefined;

  return new UsDataProviderRouter({
    macro,
    eodhd,
    alphaVantage,
    filings: sec,
    fundamentals: sec,
  });
}

function isFatalFallbackError(error: unknown): boolean {
  return (
    error instanceof UsDataProviderError &&
    (error.code === "INVALID_ARGUMENT" || error.code === "AUTHENTICATION_FAILED")
  );
}

function withFallbackIssue<
  T extends { status: "complete" | "partial"; issues?: UsDataProviderIssue[] },
>(result: T, message: string): T {
  return {
    ...result,
    issues: [...(result.issues ?? []), { code: "PROVIDER_FALLBACK", message }],
  };
}
