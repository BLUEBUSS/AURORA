import { describe, expect, it, vi } from "vitest";
import { CryptoProviderError } from "../errors.js";
import type {
  CryptoDefiProvider,
  CryptoAssetProvider,
  CryptoDexProvider,
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
  CryptoMarketDataQuery,
  CryptoMarketDataResult,
  CryptoOptionsDataQuery,
  CryptoOptionsDataResult,
  CryptoOnchainDataQuery,
  CryptoOnchainDataResult,
  CryptoSentimentDataQuery,
  CryptoSentimentDataResult,
} from "../types.js";
import { CryptoProviderRouter } from "./router.js";

const marketQuery: CryptoMarketDataQuery = {
  baseAsset: "BTC",
  quoteAsset: "USDT",
  symbol: "BTC/USDT",
  marketType: "spot",
  dataTypes: ["snapshot"],
};

const derivativesQuery: CryptoDerivativesDataQuery = {
  baseAsset: "BTC",
  quoteAsset: "USDT",
  symbol: "BTC/USDT",
  marketType: "perpetual",
  dataTypes: ["funding"],
};

function derivativeResult(
  provider: string,
  dataTypes: CryptoDerivativeSectionType[],
): CryptoDerivativesDataResult {
  return {
    status: "complete",
    sections: dataTypes.map((dataType) => ({
      dataType,
      status: "complete",
      records: [
        {
          baseAsset: "BTC",
          quoteAsset: "USDT",
          symbol: "BTC/USDT",
          marketType: "perpetual",
          venue: "binance",
          provider,
          timestamp: "2026-06-11T00:00:00.000Z",
          dataType,
          metric: dataType,
          value: 1,
          unit: "decimal",
        },
      ],
    })),
  };
}

function fakeProvider(id: string): CryptoProvider {
  return {
    id,
    getMarketData: vi.fn(
      async (): Promise<CryptoMarketDataResult> => ({ status: "complete", sections: [] }),
    ),
    getDerivativesData: vi.fn(async (query) => derivativeResult(id, query.dataTypes)),
  };
}

function fakeOptionsProvider(): CryptoOptionsProvider {
  return {
    id: "deribit",
    getOptionsData: vi.fn(
      async (query: CryptoOptionsDataQuery): Promise<CryptoOptionsDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [],
        })),
      }),
    ),
  };
}

function fakeDexProvider(id: string): CryptoDexProvider {
  return {
    id,
    getDexData: vi.fn(
      async (query: CryptoDexDataQuery): Promise<CryptoDexDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [],
        })),
      }),
    ),
  };
}

function fakeDefiProvider(): CryptoDefiProvider {
  return {
    id: "defillama",
    getDefiData: vi.fn(
      async (query: CryptoDefiDataQuery): Promise<CryptoDefiDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [],
        })),
      }),
    ),
  };
}

function fakeOnchainProvider(id: string): CryptoOnchainProvider {
  return {
    id,
    getOnchainData: vi.fn(
      async (query: CryptoOnchainDataQuery): Promise<CryptoOnchainDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [],
        })),
      }),
    ),
  };
}

function fakeAssetProvider(id: string): CryptoAssetProvider {
  return {
    id,
    getAssetData: vi.fn(
      async (query: CryptoAssetDataQuery): Promise<CryptoAssetDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [],
        })),
      }),
    ),
  };
}

function fakeSentimentProvider(id: string): CryptoSentimentProvider {
  return {
    id,
    getSentimentData: vi.fn(
      async (query: CryptoSentimentDataQuery): Promise<CryptoSentimentDataResult> => ({
        status: "complete",
        sections: query.dataTypes.map((dataType) => ({
          dataType,
          status: "complete",
          records: [],
        })),
      }),
    ),
  };
}

describe("CryptoProviderRouter", () => {
  it("routes exchange market data to Binance", async () => {
    const binance = fakeProvider("binance");
    const coinalyze = fakeProvider("coinalyze");
    const router = new CryptoProviderRouter({ binance, coinalyze });

    await router.getMarketData(marketQuery);

    expect(binance.getMarketData).toHaveBeenCalledWith(marketQuery);
    expect(coinalyze.getMarketData).not.toHaveBeenCalled();
  });

  it.each(["bybit", "deribit"])("routes %s market data to its direct provider", async (venue) => {
    const binance = fakeProvider("binance");
    const bybit = fakeProvider("bybit");
    const deribit = fakeProvider("deribit");
    const router = new CryptoProviderRouter({ binance, bybit, deribit });
    const query = { ...marketQuery, venue };

    await router.getMarketData(query);

    const selected = venue === "bybit" ? bybit : deribit;
    expect(selected.getMarketData).toHaveBeenCalledWith(query);
    expect(binance.getMarketData).not.toHaveBeenCalled();
  });

  it.each(["bybit", "deribit"])(
    "routes %s derivatives data to its direct provider",
    async (venue) => {
      const binance = fakeProvider("binance");
      const bybit = fakeProvider("bybit");
      const deribit = fakeProvider("deribit");
      const coinalyze = fakeProvider("coinalyze");
      const router = new CryptoProviderRouter({ binance, bybit, deribit, coinalyze });
      const query = { ...derivativesQuery, venue };

      await router.getDerivativesData(query);

      const selected = venue === "bybit" ? bybit : deribit;
      expect(selected.getDerivativesData).toHaveBeenCalledWith(query);
      expect(coinalyze.getDerivativesData).not.toHaveBeenCalled();
    },
  );

  it("routes aggregate derivatives queries to Coinalyze", async () => {
    const binance = fakeProvider("binance");
    const coinalyze = fakeProvider("coinalyze");
    const router = new CryptoProviderRouter({ binance, coinalyze });
    const query = { ...derivativesQuery, venue: "aggregate" };

    await router.getDerivativesData(query);

    expect(coinalyze.getDerivativesData).toHaveBeenCalledWith(query);
    expect(binance.getDerivativesData).not.toHaveBeenCalled();
  });

  it("falls back to Coinalyze when a Binance funding request fails", async () => {
    const binance = fakeProvider("binance");
    const coinalyze = fakeProvider("coinalyze");
    vi.mocked(binance.getDerivativesData).mockRejectedValueOnce(
      new CryptoProviderError("UPSTREAM_UNAVAILABLE", "Binance unavailable"),
    );
    const router = new CryptoProviderRouter({ binance, coinalyze });

    const result = await router.getDerivativesData(derivativesQuery);

    expect(result.status).toBe("complete");
    expect(result.sections[0].records[0].provider).toBe("coinalyze");
  });

  it("replaces only failed Binance sections with Coinalyze sections", async () => {
    const binance = fakeProvider("binance");
    const coinalyze = fakeProvider("coinalyze");
    vi.mocked(binance.getDerivativesData).mockResolvedValueOnce({
      status: "partial",
      sections: [
        {
          dataType: "funding",
          status: "partial",
          records: [],
          issues: [{ code: "PARTIAL_DATA", message: "funding unavailable" }],
        },
        derivativeResult("binance", ["basis"]).sections[0],
      ],
    });
    const router = new CryptoProviderRouter({ binance, coinalyze });

    const result = await router.getDerivativesData({
      ...derivativesQuery,
      dataTypes: ["funding", "basis"],
    });

    expect(result.status).toBe("complete");
    expect(result.sections.map((section) => section.records[0].provider)).toEqual([
      "coinalyze",
      "binance",
    ]);
    expect(coinalyze.getDerivativesData).toHaveBeenCalledWith(
      expect.objectContaining({ dataTypes: ["funding"] }),
    );
  });

  it("routes options data to the Deribit options provider", async () => {
    const binance = fakeProvider("binance");
    const options = fakeOptionsProvider();
    const router = new CryptoProviderRouter({ binance, options });
    const query: CryptoOptionsDataQuery = {
      baseAsset: "BTC",
      quoteAsset: "USD",
      symbol: "BTC/USD",
      venue: "deribit",
      dataTypes: ["chain"],
    };

    await router.getOptionsData(query);

    expect(options.getOptionsData).toHaveBeenCalledWith(query);
  });

  it("routes auto DEX snapshots to DEX Screener", async () => {
    const binance = fakeProvider("binance");
    const geckoTerminal = fakeDexProvider("geckoterminal");
    const dexScreener = fakeDexProvider("dexscreener");
    const router = new CryptoProviderRouter({ binance, geckoTerminal, dexScreener });
    const query: CryptoDexDataQuery = {
      provider: "auto",
      chain: "ethereum",
      poolAddress: "0xpool",
      dataTypes: ["pool_snapshot", "liquidity"],
    };

    await router.getDexData(query);

    expect(dexScreener.getDexData).toHaveBeenCalledWith(query);
    expect(geckoTerminal.getDexData).not.toHaveBeenCalled();
  });

  it("routes auto DEX OHLCV and trades to GeckoTerminal", async () => {
    const binance = fakeProvider("binance");
    const geckoTerminal = fakeDexProvider("geckoterminal");
    const dexScreener = fakeDexProvider("dexscreener");
    const router = new CryptoProviderRouter({ binance, geckoTerminal, dexScreener });
    const query: CryptoDexDataQuery = {
      provider: "auto",
      chain: "ethereum",
      poolAddress: "0xpool",
      dataTypes: ["ohlcv", "trades"],
    };

    await router.getDexData(query);

    expect(geckoTerminal.getDexData).toHaveBeenCalledWith(query);
    expect(dexScreener.getDexData).not.toHaveBeenCalled();
  });

  it("honors an explicit GeckoTerminal DEX provider", async () => {
    const binance = fakeProvider("binance");
    const geckoTerminal = fakeDexProvider("geckoterminal");
    const dexScreener = fakeDexProvider("dexscreener");
    const router = new CryptoProviderRouter({ binance, geckoTerminal, dexScreener });
    const query: CryptoDexDataQuery = {
      provider: "geckoterminal",
      query: "WETH USDC",
      dataTypes: ["token_search"],
    };

    await router.getDexData(query);

    expect(geckoTerminal.getDexData).toHaveBeenCalledWith(query);
  });

  it("routes DeFi fundamentals to DefiLlama", async () => {
    const binance = fakeProvider("binance");
    const defi = fakeDefiProvider();
    const router = new CryptoProviderRouter({ binance, defi });
    const query: CryptoDefiDataQuery = {
      protocol: "aave",
      dataTypes: ["protocol", "fees_revenue"],
    };

    await router.getDefiData(query);

    expect(defi.getDefiData).toHaveBeenCalledWith(query);
  });

  it("routes automatic Bitcoin on-chain data to mempool.space", async () => {
    const binance = fakeProvider("binance");
    const mempool = fakeOnchainProvider("mempool");
    const etherscan = fakeOnchainProvider("etherscan");
    const router = new CryptoProviderRouter({ binance, mempool, etherscan });
    const query: CryptoOnchainDataQuery = {
      provider: "auto",
      chain: "bitcoin",
      dataTypes: ["network_metrics", "gas_fees"],
    };

    await router.getOnchainData(query);

    expect(mempool.getOnchainData).toHaveBeenCalledWith(query);
    expect(etherscan.getOnchainData).not.toHaveBeenCalled();
  });

  it("routes automatic EVM data to Etherscan and saved queries to Dune", async () => {
    const binance = fakeProvider("binance");
    const etherscan = fakeOnchainProvider("etherscan");
    const dune = fakeOnchainProvider("dune");
    const router = new CryptoProviderRouter({ binance, etherscan, dune });
    const evmQuery: CryptoOnchainDataQuery = {
      provider: "auto",
      chain: "ethereum",
      dataTypes: ["gas_fees"],
    };
    const duneQuery: CryptoOnchainDataQuery = {
      provider: "auto",
      chain: "ethereum",
      dataTypes: ["saved_query"],
      queryId: 123,
    };

    await router.getOnchainData(evmQuery);
    await router.getOnchainData(duneQuery);

    expect(etherscan.getOnchainData).toHaveBeenCalledWith(evmQuery);
    expect(dune.getOnchainData).toHaveBeenCalledWith(duneQuery);
  });

  it("reports a missing explicitly requested on-chain provider", async () => {
    const binance = fakeProvider("binance");
    const router = new CryptoProviderRouter({ binance });
    const query: CryptoOnchainDataQuery = {
      provider: "etherscan",
      chain: "ethereum",
      dataTypes: ["gas_fees"],
    };

    await expect(router.getOnchainData(query)).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("routes discovery sections to CoinGecko", async () => {
    const binance = fakeProvider("binance");
    const coinGecko = fakeAssetProvider("coingecko");
    const coinPaprika = fakeAssetProvider("coinpaprika");
    const router = new CryptoProviderRouter({ binance, coinGecko, coinPaprika });
    const query: CryptoAssetDataQuery = {
      provider: "auto",
      quoteCurrency: "USD",
      dataTypes: ["categories", "trending"],
    };

    await router.getAssetData(query);

    expect(coinGecko.getAssetData).toHaveBeenCalledWith(query);
    expect(coinPaprika.getAssetData).not.toHaveBeenCalled();
  });

  it("falls back to CoinPaprika for supported aggregate asset sections", async () => {
    const binance = fakeProvider("binance");
    const coinGecko = fakeAssetProvider("coingecko");
    const coinPaprika = fakeAssetProvider("coinpaprika");
    vi.mocked(coinGecko.getAssetData).mockRejectedValueOnce(
      new CryptoProviderError("UPSTREAM_UNAVAILABLE", "CoinGecko unavailable"),
    );
    const router = new CryptoProviderRouter({ binance, coinGecko, coinPaprika });
    const query: CryptoAssetDataQuery = {
      provider: "auto",
      asset: "bitcoin",
      quoteCurrency: "USD",
      dataTypes: ["profile", "market_snapshot"],
    };

    await router.getAssetData(query);

    expect(coinPaprika.getAssetData).toHaveBeenCalledWith(query);
  });

  it("honors an explicit CoinPaprika asset provider", async () => {
    const binance = fakeProvider("binance");
    const coinGecko = fakeAssetProvider("coingecko");
    const coinPaprika = fakeAssetProvider("coinpaprika");
    const router = new CryptoProviderRouter({ binance, coinGecko, coinPaprika });
    const query: CryptoAssetDataQuery = {
      provider: "coinpaprika",
      asset: "bitcoin",
      quoteCurrency: "USD",
      dataTypes: ["profile"],
    };

    await router.getAssetData(query);

    expect(coinPaprika.getAssetData).toHaveBeenCalledWith(query);
    expect(coinGecko.getAssetData).not.toHaveBeenCalled();
  });

  it("splits automatic market sentiment across Alternative.me and CoinGecko", async () => {
    const binance = fakeProvider("binance");
    const alternativeMe = fakeSentimentProvider("alternative_me");
    const coinGeckoSentiment = fakeSentimentProvider("coingecko");
    const router = new CryptoProviderRouter({ binance, alternativeMe, coinGeckoSentiment });
    const query: CryptoSentimentDataQuery = {
      provider: "auto",
      dataTypes: ["fear_greed", "trending"],
      limit: 5,
    };

    const result = await router.getSentimentData(query);

    expect(alternativeMe.getSentimentData).toHaveBeenCalledWith({
      ...query,
      dataTypes: ["fear_greed"],
    });
    expect(coinGeckoSentiment.getSentimentData).toHaveBeenCalledWith({
      ...query,
      dataTypes: ["trending"],
    });
    expect(result.sections.map((section) => section.dataType)).toEqual(["fear_greed", "trending"]);
  });

  it("routes token discovery to DEX Screener sentiment provider", async () => {
    const binance = fakeProvider("binance");
    const dexScreenerSentiment = fakeSentimentProvider("dexscreener");
    const router = new CryptoProviderRouter({ binance, dexScreenerSentiment });
    const query: CryptoSentimentDataQuery = {
      provider: "auto",
      dataTypes: ["new_tokens", "promotion_activity"],
      chain: "solana",
    };

    await router.getSentimentData(query);

    expect(dexScreenerSentiment.getSentimentData).toHaveBeenCalledWith(query);
  });

  it("honors an explicit sentiment provider", async () => {
    const binance = fakeProvider("binance");
    const alternativeMe = fakeSentimentProvider("alternative_me");
    const router = new CryptoProviderRouter({ binance, alternativeMe });
    const query: CryptoSentimentDataQuery = {
      provider: "alternative_me",
      dataTypes: ["fear_greed"],
    };

    await router.getSentimentData(query);

    expect(alternativeMe.getSentimentData).toHaveBeenCalledWith(query);
  });
});
