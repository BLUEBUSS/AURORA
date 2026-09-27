import { CryptoProviderError } from "../errors.js";
import type {
  CryptoDefiProvider,
  CryptoDexProvider,
  CryptoAssetProvider,
  CryptoOptionsProvider,
  CryptoOnchainProvider,
  CryptoProvider,
  CryptoSentimentProvider,
} from "../provider.js";
import type {
  CryptoDefiDataQuery,
  CryptoDefiDataResult,
  CryptoAssetDataQuery,
  CryptoAssetDataResult,
  CryptoDerivativeSectionType,
  CryptoDerivativesDataQuery,
  CryptoDerivativesDataResult,
  CryptoDexDataQuery,
  CryptoDexDataResult,
  CryptoDexDataType,
  CryptoMarketDataQuery,
  CryptoMarketDataResult,
  CryptoOptionsDataQuery,
  CryptoOptionsDataResult,
  CryptoOnchainDataQuery,
  CryptoOnchainDataResult,
  CryptoSentimentDataQuery,
  CryptoSentimentDataResult,
  CryptoSentimentDataType,
} from "../types.js";
import { AlternativeMeSentimentProvider } from "./alternative-me.js";
import { BinanceCryptoProvider } from "./binance.js";
import { BybitCryptoProvider } from "./bybit.js";
import { CoinalyzeCryptoProvider } from "./coinalyze.js";
import { CoinGeckoSentimentProvider } from "./coingecko-sentiment.js";
import { CoinGeckoCryptoProvider } from "./coingecko.js";
import { CoinPaprikaCryptoProvider } from "./coinpaprika.js";
import { DefiLlamaCryptoProvider } from "./defillama.js";
import { DeribitCryptoOptionsProvider } from "./deribit-options.js";
import { DeribitCryptoProvider } from "./deribit.js";
import { DexScreenerSentimentProvider } from "./dexscreener-sentiment.js";
import { DexScreenerCryptoProvider } from "./dexscreener.js";
import { DuneCryptoProvider } from "./dune.js";
import { EtherscanCryptoProvider } from "./etherscan.js";
import { GeckoTerminalCryptoProvider } from "./geckoterminal.js";
import { MempoolCryptoProvider } from "./mempool.js";

const COINALYZE_FALLBACK_SECTIONS = new Set<CryptoDerivativeSectionType>([
  "funding",
  "open_interest",
  "contract_metadata",
]);

const GECKO_DEX_SECTIONS = new Set<CryptoDexDataType>(["ohlcv", "trades"]);

interface CryptoProviderRouterOptions {
  binance: CryptoProvider;
  bybit?: CryptoProvider;
  deribit?: CryptoProvider;
  options?: CryptoOptionsProvider;
  coinalyze?: CryptoProvider;
  geckoTerminal?: CryptoDexProvider;
  dexScreener?: CryptoDexProvider;
  defi?: CryptoDefiProvider;
  etherscan?: CryptoOnchainProvider;
  mempool?: CryptoOnchainProvider;
  dune?: CryptoOnchainProvider;
  coinGecko?: CryptoAssetProvider;
  coinPaprika?: CryptoAssetProvider;
  alternativeMe?: CryptoSentimentProvider;
  coinGeckoSentiment?: CryptoSentimentProvider;
  dexScreenerSentiment?: CryptoSentimentProvider;
}

export class CryptoProviderRouter
  implements
    CryptoProvider,
    CryptoOptionsProvider,
    CryptoDexProvider,
    CryptoDefiProvider,
    CryptoOnchainProvider,
    CryptoAssetProvider,
    CryptoSentimentProvider
{
  readonly id = "crypto-router";
  private readonly binance: CryptoProvider;
  private readonly bybit?: CryptoProvider;
  private readonly deribit?: CryptoProvider;
  private readonly options?: CryptoOptionsProvider;
  private readonly coinalyze?: CryptoProvider;
  private readonly geckoTerminal?: CryptoDexProvider;
  private readonly dexScreener?: CryptoDexProvider;
  private readonly defi?: CryptoDefiProvider;
  private readonly etherscan?: CryptoOnchainProvider;
  private readonly mempool?: CryptoOnchainProvider;
  private readonly dune?: CryptoOnchainProvider;
  private readonly coinGecko?: CryptoAssetProvider;
  private readonly coinPaprika?: CryptoAssetProvider;
  private readonly alternativeMe?: CryptoSentimentProvider;
  private readonly coinGeckoSentiment?: CryptoSentimentProvider;
  private readonly dexScreenerSentiment?: CryptoSentimentProvider;

  constructor(options: CryptoProviderRouterOptions) {
    this.binance = options.binance;
    this.bybit = options.bybit;
    this.deribit = options.deribit;
    this.options = options.options;
    this.coinalyze = options.coinalyze;
    this.geckoTerminal = options.geckoTerminal;
    this.dexScreener = options.dexScreener;
    this.defi = options.defi;
    this.etherscan = options.etherscan;
    this.mempool = options.mempool;
    this.dune = options.dune;
    this.coinGecko = options.coinGecko;
    this.coinPaprika = options.coinPaprika;
    this.alternativeMe = options.alternativeMe;
    this.coinGeckoSentiment = options.coinGeckoSentiment;
    this.dexScreenerSentiment = options.dexScreenerSentiment;
  }

  getMarketData(query: CryptoMarketDataQuery): Promise<CryptoMarketDataResult> {
    const venue = query.venue?.toLowerCase();
    const provider = this.directProvider(venue);
    if (!provider) {
      throw new CryptoProviderError(
        "INVALID_ARGUMENT",
        `Market-data venue "${query.venue}" is not enabled. Use binance, bybit, or deribit.`,
      );
    }
    return provider.getMarketData(query);
  }

  async getDerivativesData(
    query: CryptoDerivativesDataQuery,
  ): Promise<CryptoDerivativesDataResult> {
    const venue = query.venue?.toLowerCase();
    if (venue === "bybit" || venue === "deribit") {
      const provider = this.directProvider(venue);
      if (!provider) {
        throw new CryptoProviderError(
          "UPSTREAM_UNAVAILABLE",
          `Derivatives venue "${query.venue}" is not configured.`,
        );
      }
      return provider.getDerivativesData(query);
    }
    if (venue && venue !== "binance") {
      if (!this.coinalyze) {
        throw new CryptoProviderError(
          "UPSTREAM_UNAVAILABLE",
          `Derivatives venue "${query.venue}" requires a configured Coinalyze provider.`,
        );
      }
      return this.coinalyze.getDerivativesData(query);
    }

    try {
      const primary = await this.binance.getDerivativesData(query);
      return await this.replacePartialSections(query, primary);
    } catch (primaryError) {
      if (
        !this.coinalyze ||
        !query.dataTypes.every((item) => COINALYZE_FALLBACK_SECTIONS.has(item))
      ) {
        throw primaryError;
      }
      try {
        return await this.coinalyze.getDerivativesData(query);
      } catch {
        throw primaryError;
      }
    }
  }

  getOptionsData(query: CryptoOptionsDataQuery): Promise<CryptoOptionsDataResult> {
    if (!this.options) {
      throw new CryptoProviderError(
        "UPSTREAM_UNAVAILABLE",
        "Deribit options provider is not configured.",
      );
    }
    return this.options.getOptionsData(query);
  }

  async getDexData(query: CryptoDexDataQuery): Promise<CryptoDexDataResult> {
    if (query.provider === "geckoterminal") {
      return this.requireDexProvider(this.geckoTerminal, "GeckoTerminal").getDexData(query);
    }
    if (query.provider === "dexscreener") {
      return this.requireDexProvider(this.dexScreener, "DEX Screener").getDexData(query);
    }

    const geckoTypes = query.dataTypes.filter((dataType) => GECKO_DEX_SECTIONS.has(dataType));
    const screenerTypes = query.dataTypes.filter((dataType) => !GECKO_DEX_SECTIONS.has(dataType));
    if (geckoTypes.length === 0) {
      return this.requireDexProvider(this.dexScreener, "DEX Screener").getDexData(query);
    }
    if (screenerTypes.length === 0) {
      return this.requireDexProvider(this.geckoTerminal, "GeckoTerminal").getDexData(query);
    }

    const [gecko, screener] = await Promise.all([
      this.requireDexProvider(this.geckoTerminal, "GeckoTerminal").getDexData({
        ...query,
        dataTypes: geckoTypes,
      }),
      this.requireDexProvider(this.dexScreener, "DEX Screener").getDexData({
        ...query,
        dataTypes: screenerTypes,
      }),
    ]);
    const sections = query.dataTypes.map((dataType) => {
      const section = [...gecko.sections, ...screener.sections].find(
        (candidate) => candidate.dataType === dataType,
      );
      if (!section) {
        throw new CryptoProviderError(
          "UPSTREAM_ERROR",
          `DEX router did not return the requested ${dataType} section.`,
        );
      }
      return section;
    });
    const issues = [...(gecko.issues ?? []), ...(screener.issues ?? [])];
    return {
      status: gecko.status === "partial" || screener.status === "partial" ? "partial" : "complete",
      sections,
      issues: issues.length > 0 ? issues : undefined,
    };
  }

  getDefiData(query: CryptoDefiDataQuery): Promise<CryptoDefiDataResult> {
    if (!this.defi) {
      throw new CryptoProviderError(
        "UPSTREAM_UNAVAILABLE",
        "DefiLlama provider is not configured.",
      );
    }
    return this.defi.getDefiData(query);
  }

  async getOnchainData(query: CryptoOnchainDataQuery): Promise<CryptoOnchainDataResult> {
    if (query.provider === "etherscan") {
      return this.requireOnchainProvider(this.etherscan, "Etherscan").getOnchainData(query);
    }
    if (query.provider === "mempool") {
      return this.requireOnchainProvider(this.mempool, "mempool.space").getOnchainData(query);
    }
    if (query.provider === "dune") {
      return this.requireOnchainProvider(this.dune, "Dune").getOnchainData(query);
    }
    if (query.dataTypes.includes("saved_query")) {
      return this.requireOnchainProvider(this.dune, "Dune").getOnchainData(query);
    }
    if (query.chain === "bitcoin") {
      return this.requireOnchainProvider(this.mempool, "mempool.space").getOnchainData(query);
    }
    return this.requireOnchainProvider(this.etherscan, "Etherscan").getOnchainData(query);
  }

  async getAssetData(query: CryptoAssetDataQuery): Promise<CryptoAssetDataResult> {
    if (query.provider === "coingecko") {
      return this.requireAssetProvider(this.coinGecko, "CoinGecko").getAssetData(query);
    }
    if (query.provider === "coinpaprika") {
      return this.requireAssetProvider(this.coinPaprika, "CoinPaprika").getAssetData(query);
    }
    if (query.dataTypes.some((item) => item === "categories" || item === "trending")) {
      return this.requireAssetProvider(this.coinGecko, "CoinGecko").getAssetData(query);
    }
    if (this.coinGecko) {
      try {
        return await this.coinGecko.getAssetData(query);
      } catch (primaryError) {
        if (!this.coinPaprika) throw primaryError;
        try {
          return await this.coinPaprika.getAssetData(query);
        } catch {
          throw primaryError;
        }
      }
    }
    return this.requireAssetProvider(this.coinPaprika, "CoinPaprika").getAssetData(query);
  }

  async getSentimentData(query: CryptoSentimentDataQuery): Promise<CryptoSentimentDataResult> {
    if (query.provider === "alternative_me") {
      return this.requireSentimentProvider(this.alternativeMe, "Alternative.me").getSentimentData(
        query,
      );
    }
    if (query.provider === "coingecko") {
      return this.requireSentimentProvider(this.coinGeckoSentiment, "CoinGecko").getSentimentData(
        query,
      );
    }
    if (query.provider === "dexscreener") {
      return this.requireSentimentProvider(
        this.dexScreenerSentiment,
        "DEX Screener",
      ).getSentimentData(query);
    }

    const groups = new Map<CryptoSentimentProvider, CryptoSentimentDataType[]>();
    for (const dataType of query.dataTypes) {
      const provider = this.sentimentProviderFor(dataType);
      groups.set(provider, [...(groups.get(provider) ?? []), dataType]);
    }
    const results = await Promise.all(
      [...groups].map(([provider, dataTypes]) =>
        provider.getSentimentData({ ...query, dataTypes }),
      ),
    );
    const allSections = results.flatMap((result) => result.sections);
    const sections = query.dataTypes.map((dataType) => {
      const section = allSections.find((candidate) => candidate.dataType === dataType);
      if (!section) {
        throw new CryptoProviderError(
          "UPSTREAM_ERROR",
          `Sentiment router did not return the requested ${dataType} section.`,
        );
      }
      return section;
    });
    const issues = results.flatMap((result) => result.issues ?? []);
    return {
      status: results.some((result) => result.status === "partial") ? "partial" : "complete",
      sections,
      issues: issues.length > 0 ? issues : undefined,
    };
  }

  private requireDexProvider(
    provider: CryptoDexProvider | undefined,
    name: string,
  ): CryptoDexProvider {
    if (!provider) {
      throw new CryptoProviderError("UPSTREAM_UNAVAILABLE", `${name} provider is not configured.`);
    }
    return provider;
  }

  private requireOnchainProvider(
    provider: CryptoOnchainProvider | undefined,
    name: string,
  ): CryptoOnchainProvider {
    if (!provider) {
      throw new CryptoProviderError("UPSTREAM_UNAVAILABLE", `${name} provider is not configured.`);
    }
    return provider;
  }

  private requireAssetProvider(
    provider: CryptoAssetProvider | undefined,
    name: string,
  ): CryptoAssetProvider {
    if (!provider) {
      throw new CryptoProviderError("UPSTREAM_UNAVAILABLE", `${name} provider is not configured.`);
    }
    return provider;
  }

  private requireSentimentProvider(
    provider: CryptoSentimentProvider | undefined,
    name: string,
  ): CryptoSentimentProvider {
    if (!provider) {
      throw new CryptoProviderError("UPSTREAM_UNAVAILABLE", `${name} provider is not configured.`);
    }
    return provider;
  }

  private sentimentProviderFor(dataType: CryptoSentimentDataType): CryptoSentimentProvider {
    switch (dataType) {
      case "fear_greed":
        return this.requireSentimentProvider(this.alternativeMe, "Alternative.me");
      case "trending":
        return this.requireSentimentProvider(this.coinGeckoSentiment, "CoinGecko");
      case "new_tokens":
      case "promotion_activity":
        return this.requireSentimentProvider(this.dexScreenerSentiment, "DEX Screener");
    }
  }

  private directProvider(venue: string | undefined): CryptoProvider | undefined {
    switch (venue) {
      case undefined:
      case "binance":
        return this.binance;
      case "bybit":
        return this.bybit;
      case "deribit":
        return this.deribit;
      default:
        return undefined;
    }
  }

  private async replacePartialSections(
    query: CryptoDerivativesDataQuery,
    primary: CryptoDerivativesDataResult,
  ): Promise<CryptoDerivativesDataResult> {
    if (!this.coinalyze) return primary;

    const fallbackTypes = primary.sections
      .filter(
        (section) =>
          section.status === "partial" && COINALYZE_FALLBACK_SECTIONS.has(section.dataType),
      )
      .map((section) => section.dataType);
    if (fallbackTypes.length === 0) return primary;

    let fallback: CryptoDerivativesDataResult;
    try {
      fallback = await this.coinalyze.getDerivativesData({ ...query, dataTypes: fallbackTypes });
    } catch {
      return primary;
    }

    const fallbackByType = new Map(fallback.sections.map((section) => [section.dataType, section]));
    const sections = primary.sections.map((section) => {
      const replacement = fallbackByType.get(section.dataType);
      return replacement?.status === "complete" && replacement.records.length > 0
        ? replacement
        : section;
    });
    return {
      status: sections.some((section) => section.status === "partial") ? "partial" : "complete",
      sections,
    };
  }
}

export function createDefaultCryptoProvider(
  env: Record<string, string | undefined> = process.env,
): CryptoProviderRouter {
  const proxyUrl = env.CRYPTO_PROXY ?? env.HTTPS_PROXY ?? env.HTTP_PROXY ?? env.ALL_PROXY;
  const binance = new BinanceCryptoProvider({ proxyUrl });
  const bybit = new BybitCryptoProvider({ proxyUrl });
  const deribit = new DeribitCryptoProvider({ proxyUrl });
  const options = new DeribitCryptoOptionsProvider({ proxyUrl });
  const geckoTerminal = new GeckoTerminalCryptoProvider({ proxyUrl });
  const dexScreener = new DexScreenerCryptoProvider({ proxyUrl });
  const defi = new DefiLlamaCryptoProvider({ proxyUrl });
  const mempool = new MempoolCryptoProvider({ proxyUrl });
  const coinalyzeKey = env.COINALYZE_API_KEY?.trim();
  const coinalyze = coinalyzeKey
    ? new CoinalyzeCryptoProvider({ apiKey: coinalyzeKey, proxyUrl })
    : undefined;
  const etherscanKey = env.ETHERSCAN_API_KEY?.trim();
  const etherscan = etherscanKey
    ? new EtherscanCryptoProvider({ apiKey: etherscanKey, proxyUrl })
    : undefined;
  const duneKey = env.DUNE_API_KEY?.trim();
  const duneQueryIds = parseDuneQueryIds(env.DUNE_SAVED_QUERY_IDS);
  const dune =
    duneKey && duneQueryIds.length > 0
      ? new DuneCryptoProvider({ apiKey: duneKey, allowedQueryIds: duneQueryIds, proxyUrl })
      : undefined;
  const coinGeckoKey = env.COINGECKO_API_KEY?.trim();
  const coinGecko = coinGeckoKey
    ? new CoinGeckoCryptoProvider({ apiKey: coinGeckoKey, proxyUrl })
    : undefined;
  const coinPaprika = new CoinPaprikaCryptoProvider({ proxyUrl });
  const alternativeMe = new AlternativeMeSentimentProvider({ proxyUrl });
  const coinGeckoSentiment = coinGeckoKey
    ? new CoinGeckoSentimentProvider({ apiKey: coinGeckoKey, proxyUrl })
    : undefined;
  const dexScreenerSentiment = new DexScreenerSentimentProvider({ proxyUrl });
  return new CryptoProviderRouter({
    binance,
    bybit,
    deribit,
    options,
    coinalyze,
    geckoTerminal,
    dexScreener,
    defi,
    etherscan,
    mempool,
    dune,
    coinGecko,
    coinPaprika,
    alternativeMe,
    coinGeckoSentiment,
    dexScreenerSentiment,
  });
}

function parseDuneQueryIds(value: string | undefined): number[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => Number.parseInt(item.trim(), 10))
        .filter((item) => Number.isSafeInteger(item) && item > 0),
    ),
  ];
}
