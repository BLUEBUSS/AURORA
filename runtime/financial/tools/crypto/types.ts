export const CRYPTO_MARKET_TYPES = ["spot", "perpetual", "future"] as const;
export const CRYPTO_DERIVATIVE_MARKET_TYPES = ["perpetual", "future"] as const;
export const CRYPTO_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"] as const;

export const CRYPTO_MARKET_DATA_TYPES = [
  "snapshot",
  "ohlcv",
  "trades",
  "orderbook",
  "instruments",
] as const;
export const CRYPTO_MARKET_BUNDLES = ["market_overview", "microstructure"] as const;

export const CRYPTO_DERIVATIVE_DATA_TYPES = [
  "overview",
  "funding",
  "open_interest",
  "basis",
  "long_short_ratio",
  "taker_flow",
  "liquidations",
  "insurance_risk",
  "contract_metadata",
] as const;
export const CRYPTO_DERIVATIVE_BUNDLES = ["derivatives_overview", "liquidation_overview"] as const;

export const CRYPTO_OPTION_DATA_TYPES = [
  "chain",
  "ticker",
  "orderbook",
  "trades",
  "greeks",
  "implied_volatility",
  "volatility_index",
  "expiry_structure",
] as const;
export const CRYPTO_OPTION_BUNDLES = ["options_surface", "volatility_overview"] as const;
export const CRYPTO_OPTION_TYPES = ["call", "put"] as const;

export const CRYPTO_DEX_DATA_TYPES = [
  "token_search",
  "pools",
  "pool_snapshot",
  "ohlcv",
  "trades",
  "liquidity",
  "transaction_activity",
] as const;
export const CRYPTO_DEX_BUNDLES = ["pool_overview", "pool_market_history"] as const;
export const CRYPTO_DEX_PROVIDERS = ["auto", "geckoterminal", "dexscreener"] as const;

export const CRYPTO_DEFI_DATA_TYPES = [
  "protocol",
  "chain_tvl",
  "stablecoins",
  "yields",
  "dex_volume",
  "options_volume",
  "open_interest",
  "fees_revenue",
] as const;
export const CRYPTO_DEFI_BUNDLES = [
  "protocol_fundamentals",
  "stablecoin_overview",
  "yield_screen",
] as const;

export const CRYPTO_ONCHAIN_DATA_TYPES = [
  "network_metrics",
  "address_activity",
  "token_transfers",
  "logs",
  "gas_fees",
  "blocks",
  "mempool",
  "saved_query",
] as const;
export const CRYPTO_ONCHAIN_BUNDLES = ["evm_address_overview", "bitcoin_network_overview"] as const;
export const CRYPTO_ONCHAIN_PROVIDERS = ["auto", "etherscan", "mempool", "dune"] as const;

export const CRYPTO_ASSET_DATA_TYPES = [
  "profile",
  "market_snapshot",
  "supply",
  "rankings",
  "categories",
  "exchanges",
  "trending",
] as const;
export const CRYPTO_ASSET_BUNDLES = ["asset_overview", "market_discovery"] as const;
export const CRYPTO_ASSET_PROVIDERS = ["auto", "coingecko", "coinpaprika"] as const;

export const CRYPTO_SENTIMENT_DATA_TYPES = [
  "fear_greed",
  "trending",
  "new_tokens",
  "promotion_activity",
] as const;
export const CRYPTO_SENTIMENT_BUNDLES = ["market_sentiment", "token_discovery"] as const;
export const CRYPTO_SENTIMENT_PROVIDERS = [
  "auto",
  "alternative_me",
  "coingecko",
  "dexscreener",
] as const;

export type CryptoMarketType = (typeof CRYPTO_MARKET_TYPES)[number];
export type CryptoDerivativeMarketType = (typeof CRYPTO_DERIVATIVE_MARKET_TYPES)[number];
export type CryptoInterval = (typeof CRYPTO_INTERVALS)[number];
export type CryptoMarketDataType = (typeof CRYPTO_MARKET_DATA_TYPES)[number];
export type CryptoMarketBundle = (typeof CRYPTO_MARKET_BUNDLES)[number];
export type CryptoDerivativeDataType = (typeof CRYPTO_DERIVATIVE_DATA_TYPES)[number];
export type CryptoDerivativeSectionType = Exclude<CryptoDerivativeDataType, "overview">;
export type CryptoDerivativeBundle = (typeof CRYPTO_DERIVATIVE_BUNDLES)[number];
export type CryptoOptionDataType = (typeof CRYPTO_OPTION_DATA_TYPES)[number];
export type CryptoOptionBundle = (typeof CRYPTO_OPTION_BUNDLES)[number];
export type CryptoOptionType = (typeof CRYPTO_OPTION_TYPES)[number];
export type CryptoDexDataType = (typeof CRYPTO_DEX_DATA_TYPES)[number];
export type CryptoDexBundle = (typeof CRYPTO_DEX_BUNDLES)[number];
export type CryptoDexProviderId = (typeof CRYPTO_DEX_PROVIDERS)[number];
export type CryptoDefiDataType = (typeof CRYPTO_DEFI_DATA_TYPES)[number];
export type CryptoDefiBundle = (typeof CRYPTO_DEFI_BUNDLES)[number];
export type CryptoOnchainDataType = (typeof CRYPTO_ONCHAIN_DATA_TYPES)[number];
export type CryptoOnchainBundle = (typeof CRYPTO_ONCHAIN_BUNDLES)[number];
export type CryptoOnchainProviderId = (typeof CRYPTO_ONCHAIN_PROVIDERS)[number];
export type CryptoAssetDataType = (typeof CRYPTO_ASSET_DATA_TYPES)[number];
export type CryptoAssetBundle = (typeof CRYPTO_ASSET_BUNDLES)[number];
export type CryptoAssetProviderId = (typeof CRYPTO_ASSET_PROVIDERS)[number];
export type CryptoSentimentDataType = (typeof CRYPTO_SENTIMENT_DATA_TYPES)[number];
export type CryptoSentimentBundle = (typeof CRYPTO_SENTIMENT_BUNDLES)[number];
export type CryptoSentimentProviderId = (typeof CRYPTO_SENTIMENT_PROVIDERS)[number];

export interface CryptoMarketIdentity extends Record<string, unknown> {
  baseAsset: string;
  quoteAsset: string;
  symbol: string;
  marketType: CryptoMarketType;
  venue: string;
  provider: string;
  timestamp: string;
}

export interface CryptoMarketSnapshotRecord extends CryptoMarketIdentity {
  dataType: "snapshot";
  price: number;
  priceUnit: string;
  volume24h?: number;
  volumeUnit?: string;
  quoteVolume24h?: number;
  quoteVolumeUnit?: string;
  change24h?: number;
  change24hUnit?: "decimal";
  marketCap?: number;
  marketCapUnit?: string;
}

export interface CryptoOhlcvRecord extends CryptoMarketIdentity {
  dataType: "ohlcv";
  interval: CryptoInterval;
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  priceUnit: string;
  volume: number;
  volumeUnit: string;
  quoteVolume?: number;
  quoteVolumeUnit?: string;
}

export interface CryptoTradeRecord extends CryptoMarketIdentity {
  dataType: "trades";
  tradeId?: string;
  price: number;
  priceUnit: string;
  quantity: number;
  quantityUnit: string;
  side?: "buy" | "sell";
}

export interface CryptoOrderbookRecord extends CryptoMarketIdentity {
  dataType: "orderbook";
  side: "bid" | "ask";
  level: number;
  price: number;
  priceUnit: string;
  quantity: number;
  quantityUnit: string;
}

export interface CryptoInstrumentRecord extends CryptoMarketIdentity {
  dataType: "instruments";
  venueSymbol: string;
  status: string;
  contractExpiry?: string;
  tickSize?: number;
  lotSize?: number;
}

export interface CryptoDerivativeRecord extends CryptoMarketIdentity {
  dataType: CryptoDerivativeSectionType;
  marketType: CryptoDerivativeMarketType;
  metric: string;
  value: number;
  unit: string;
  interval?: CryptoInterval | "8h";
  side?: "long" | "short" | "all";
  contractExpiry?: string;
  methodology?: "observed" | "reported" | "derived";
}

export interface CryptoOptionIdentity extends Record<string, unknown> {
  baseAsset: string;
  quoteAsset: string;
  symbol: string;
  venue: string;
  provider: string;
  timestamp: string;
}

export interface CryptoOptionContractIdentity extends CryptoOptionIdentity {
  instrumentName: string;
  expiry: string;
  strike: number;
  optionType: CryptoOptionType;
}

export interface CryptoOptionChainRecord extends CryptoOptionContractIdentity {
  dataType: "chain";
  status: string;
  settlementCurrency?: string;
  contractSize?: number;
  tickSize?: number;
  minimumTradeAmount?: number;
}

export interface CryptoOptionTickerRecord extends CryptoOptionContractIdentity {
  dataType: "ticker";
  lastPrice?: number;
  markPrice?: number;
  bidPrice?: number;
  askPrice?: number;
  underlyingPrice?: number;
  openInterest?: number;
  volume24h?: number;
  priceUnit: string;
  quantityUnit: string;
}

export interface CryptoOptionOrderbookRecord extends CryptoOptionContractIdentity {
  dataType: "orderbook";
  side: "bid" | "ask";
  level: number;
  price: number;
  priceUnit: string;
  quantity: number;
  quantityUnit: string;
}

export interface CryptoOptionTradeRecord extends CryptoOptionContractIdentity {
  dataType: "trades";
  tradeId?: string;
  side?: "buy" | "sell";
  price: number;
  priceUnit: string;
  quantity: number;
  quantityUnit: string;
  impliedVolatility?: number;
  impliedVolatilityUnit?: "decimal";
}

export interface CryptoOptionGreeksRecord extends CryptoOptionContractIdentity {
  dataType: "greeks";
  delta?: number;
  gamma?: number;
  vega?: number;
  theta?: number;
  rho?: number;
  methodology: "reported";
}

export interface CryptoOptionImpliedVolatilityRecord extends CryptoOptionContractIdentity {
  dataType: "implied_volatility";
  markIv?: number;
  bidIv?: number;
  askIv?: number;
  unit: "decimal";
  methodology: "reported" | "derived";
}

export interface CryptoVolatilityIndexRecord extends CryptoOptionIdentity {
  dataType: "volatility_index";
  indexName: string;
  interval: CryptoInterval;
  open: number;
  high: number;
  low: number;
  close: number;
  unit: "index_points";
}

export interface CryptoOptionExpiryStructureRecord extends CryptoOptionIdentity {
  dataType: "expiry_structure";
  expiry: string;
  daysToExpiry: number;
  callOpenInterest: number;
  putOpenInterest: number;
  callVolume24h: number;
  putVolume24h: number;
  totalOpenInterest: number;
  openInterestUnit: string;
  volumeUnit: string;
}

export type CryptoOptionRecord =
  | CryptoOptionChainRecord
  | CryptoOptionTickerRecord
  | CryptoOptionOrderbookRecord
  | CryptoOptionTradeRecord
  | CryptoOptionGreeksRecord
  | CryptoOptionImpliedVolatilityRecord
  | CryptoVolatilityIndexRecord
  | CryptoOptionExpiryStructureRecord;

export interface CryptoDexTokenIdentity {
  address: string;
  symbol: string;
  name?: string;
}

export interface CryptoDexRecord extends Record<string, unknown> {
  dataType: CryptoDexDataType;
  chain: string;
  provider: string;
  venue: string;
  timestamp: string;
  poolAddress?: string;
  tokenAddress?: string;
  baseToken?: CryptoDexTokenIdentity;
  quoteToken?: CryptoDexTokenIdentity;
  interval?: CryptoInterval;
  openTime?: string;
  closeTime?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  priceUsd?: number;
  priceNative?: number;
  priceChange24h?: number;
  liquidityUsd?: number;
  volumeUsd?: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  fdvUsd?: number;
  tradeId?: string;
  transactionHash?: string;
  side?: "buy" | "sell";
  baseAmount?: number;
  quoteAmount?: number;
  window?: "5m" | "1h" | "6h" | "24h";
  buys?: number;
  sells?: number;
  buyers?: number;
  sellers?: number;
  methodology?: "reported" | "derived";
}

export interface CryptoDefiRecord extends Record<string, unknown> {
  dataType: CryptoDefiDataType;
  provider: string;
  venue: "aggregate";
  timestamp: string;
  protocol?: string;
  chain?: string;
  stablecoinId?: string;
  poolId?: string;
  name?: string;
  symbol?: string;
  category?: string;
  chains?: string[];
  metric: string;
  value: number;
  unit: string;
  tvlUsd?: number;
  apy?: number;
  apyBase?: number;
  apyReward?: number;
  stablecoin?: boolean;
  exposure?: string;
  total24hUsd?: number;
  total7dUsd?: number;
  total30dUsd?: number;
  revenue24hUsd?: number;
  change1d?: number;
  methodology?: "reported" | "derived";
}

export interface CryptoOnchainRecord extends Record<string, unknown> {
  dataType: CryptoOnchainDataType;
  chain: string;
  network: string;
  provider: string;
  timestamp: string;
  address?: string;
  contractAddress?: string;
  transactionHash?: string;
  blockNumber?: number;
  blockHash?: string;
  fromAddress?: string;
  toAddress?: string;
  direction?: "in" | "out" | "self" | "unknown";
  value?: number;
  unit?: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimals?: number;
  fee?: number;
  feeUnit?: string;
  success?: boolean;
  metric?: string;
  metricValue?: number;
  topics?: string[];
  logData?: string;
  queryId?: number;
  executionId?: string;
  row?: Record<string, unknown>;
  methodology: "reported" | "derived";
}

export interface CryptoAssetRecord extends Record<string, unknown> {
  dataType: CryptoAssetDataType;
  assetId?: string;
  symbol?: string;
  name?: string;
  provider: string;
  venue: "aggregate";
  timestamp: string;
  quoteCurrency?: string;
  description?: string;
  homepage?: string;
  imageUrl?: string;
  genesisDate?: string;
  hashingAlgorithm?: string;
  categories?: string[];
  platforms?: Record<string, string>;
  price?: number;
  marketCap?: number;
  fullyDilutedValuation?: number;
  volume24h?: number;
  change24h?: number;
  high24h?: number;
  low24h?: number;
  circulatingSupply?: number;
  totalSupply?: number;
  maxSupply?: number;
  marketCapRank?: number;
  categoryId?: string;
  categoryName?: string;
  exchangeId?: string;
  exchangeName?: string;
  trustScoreRank?: number;
  score?: number;
  methodology: "reported" | "derived";
}

export interface CryptoSentimentRecord extends Record<string, unknown> {
  dataType: CryptoSentimentDataType;
  provider: string;
  venue: "aggregate";
  timestamp: string;
  signalType: string;
  attribution: string;
  value?: number;
  unit?: string;
  classification?: string;
  marketScope?: string;
  assetId?: string;
  symbol?: string;
  name?: string;
  marketCapRank?: number;
  score?: number;
  chain?: string;
  tokenAddress?: string;
  url?: string;
  description?: string;
  promotionType?: string;
  amount?: number;
  totalAmount?: number;
  methodology: "reported" | "derived";
}

export type CryptoMarketDataRecord =
  | CryptoMarketSnapshotRecord
  | CryptoOhlcvRecord
  | CryptoTradeRecord
  | CryptoOrderbookRecord
  | CryptoInstrumentRecord;

export type CryptoDataRecord =
  | CryptoMarketDataRecord
  | CryptoDerivativeRecord
  | CryptoOptionRecord
  | CryptoDexRecord
  | CryptoDefiRecord
  | CryptoOnchainRecord
  | CryptoAssetRecord
  | CryptoSentimentRecord;

export interface CryptoMarketQuery {
  baseAsset: string;
  quoteAsset: string;
  symbol: string;
  marketType: CryptoMarketType;
  venue?: string;
}

export interface CryptoMarketDataQuery extends CryptoMarketQuery {
  dataTypes: CryptoMarketDataType[];
  interval?: CryptoInterval;
  startTime?: string;
  endTime?: string;
  depth?: number;
  limit?: number;
}

export interface CryptoDerivativesDataQuery extends CryptoMarketQuery {
  marketType: CryptoDerivativeMarketType;
  dataTypes: CryptoDerivativeSectionType[];
  interval?: CryptoInterval;
  startTime?: string;
  endTime?: string;
  limit?: number;
}

export interface CryptoOptionsDataQuery {
  baseAsset: string;
  quoteAsset: string;
  symbol: string;
  venue: "deribit";
  dataTypes: CryptoOptionDataType[];
  expiry?: string;
  strike?: number;
  optionType?: CryptoOptionType;
  interval?: CryptoInterval;
  startTime?: string;
  endTime?: string;
  depth?: number;
  limit?: number;
}

export interface CryptoDexDataQuery {
  dataTypes: CryptoDexDataType[];
  provider: CryptoDexProviderId;
  chain?: string;
  query?: string;
  contractAddress?: string;
  poolAddress?: string;
  interval?: CryptoInterval;
  startTime?: string;
  endTime?: string;
  limit?: number;
}

export interface CryptoDefiDataQuery {
  dataTypes: CryptoDefiDataType[];
  protocol?: string;
  chain?: string;
  stablecoinId?: string;
  poolId?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
}

export interface CryptoOnchainDataQuery {
  dataTypes: CryptoOnchainDataType[];
  provider: CryptoOnchainProviderId;
  chain: string;
  address?: string;
  contractAddress?: string;
  fromBlock?: number;
  toBlock?: number;
  topic0?: string;
  queryId?: number;
  limit?: number;
}

export interface CryptoAssetDataQuery {
  dataTypes: CryptoAssetDataType[];
  provider: CryptoAssetProviderId;
  asset?: string;
  quoteCurrency: string;
  category?: string;
  limit?: number;
}

export interface CryptoSentimentDataQuery {
  dataTypes: CryptoSentimentDataType[];
  provider: CryptoSentimentProviderId;
  chain?: string;
  limit?: number;
}

export type CryptoIssueCode = "PARTIAL_DATA";

export interface CryptoProviderIssue {
  code: CryptoIssueCode;
  message: string;
}

export interface CryptoProviderSection<TDataType extends string, TRecord extends CryptoDataRecord> {
  dataType: TDataType;
  status: "complete" | "partial";
  records: TRecord[];
  issues?: CryptoProviderIssue[];
}

export interface CryptoProviderResult<TDataType extends string, TRecord extends CryptoDataRecord> {
  status: "complete" | "partial";
  sections: CryptoProviderSection<TDataType, TRecord>[];
  issues?: CryptoProviderIssue[];
}

export type CryptoMarketDataResult = CryptoProviderResult<
  CryptoMarketDataType,
  CryptoMarketDataRecord
>;
export type CryptoDerivativesDataResult = CryptoProviderResult<
  CryptoDerivativeSectionType,
  CryptoDerivativeRecord
>;
export type CryptoOptionsDataResult = CryptoProviderResult<
  CryptoOptionDataType,
  CryptoOptionRecord
>;
export type CryptoDexDataResult = CryptoProviderResult<CryptoDexDataType, CryptoDexRecord>;
export type CryptoDefiDataResult = CryptoProviderResult<CryptoDefiDataType, CryptoDefiRecord>;
export type CryptoOnchainDataResult = CryptoProviderResult<
  CryptoOnchainDataType,
  CryptoOnchainRecord
>;
export type CryptoAssetDataResult = CryptoProviderResult<CryptoAssetDataType, CryptoAssetRecord>;
export type CryptoSentimentDataResult = CryptoProviderResult<
  CryptoSentimentDataType,
  CryptoSentimentRecord
>;
