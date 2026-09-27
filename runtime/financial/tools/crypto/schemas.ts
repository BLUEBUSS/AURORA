import { Type, type Static } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum } from "../../runtime/plugin-api.js";
import {
  CRYPTO_DERIVATIVE_BUNDLES,
  CRYPTO_DERIVATIVE_DATA_TYPES,
  CRYPTO_DERIVATIVE_MARKET_TYPES,
  CRYPTO_INTERVALS,
  CRYPTO_MARKET_BUNDLES,
  CRYPTO_MARKET_DATA_TYPES,
  CRYPTO_MARKET_TYPES,
  CRYPTO_OPTION_BUNDLES,
  CRYPTO_OPTION_DATA_TYPES,
  CRYPTO_OPTION_TYPES,
  CRYPTO_DEFI_BUNDLES,
  CRYPTO_DEFI_DATA_TYPES,
  CRYPTO_DEX_BUNDLES,
  CRYPTO_DEX_DATA_TYPES,
  CRYPTO_DEX_PROVIDERS,
  CRYPTO_ONCHAIN_BUNDLES,
  CRYPTO_ONCHAIN_DATA_TYPES,
  CRYPTO_ONCHAIN_PROVIDERS,
  CRYPTO_ASSET_BUNDLES,
  CRYPTO_ASSET_DATA_TYPES,
  CRYPTO_ASSET_PROVIDERS,
  CRYPTO_SENTIMENT_BUNDLES,
  CRYPTO_SENTIMENT_DATA_TYPES,
  CRYPTO_SENTIMENT_PROVIDERS,
} from "./types.js";

const SYMBOL_PATTERN = "^[A-Za-z0-9][A-Za-z0-9.-]{0,19}/[A-Za-z0-9][A-Za-z0-9.-]{0,19}$";
const TIMESTAMP_DESCRIPTION = "ISO 8601 timestamp with timezone, for example 2026-06-01T00:00:00Z";

const SymbolField = Type.String({
  pattern: SYMBOL_PATTERN,
  description: "Canonical BASE/QUOTE pair, for example BTC/USDT. Do not use venue-native ids.",
});

const VenueField = Type.Optional(
  Type.String({
    minLength: 1,
    maxLength: 80,
    description: "Optional exchange or aggregate venue.",
  }),
);

const LimitField = Type.Optional(
  Type.Integer({ minimum: 1, maximum: 5_000, description: "Maximum records per section." }),
);

const QueryFields = {
  symbol: SymbolField,
  venue: VenueField,
  interval: optionalStringEnum(CRYPTO_INTERVALS, { description: "Requested time interval." }),
  start_time: Type.Optional(Type.String({ minLength: 20, description: TIMESTAMP_DESCRIPTION })),
  end_time: Type.Optional(Type.String({ minLength: 20, description: TIMESTAMP_DESCRIPTION })),
  limit: LimitField,
};

export const CryptoMarketDataInputSchema = Type.Object({
  ...QueryFields,
  market_type: optionalStringEnum(CRYPTO_MARKET_TYPES, {
    description: "Market type. Defaults to spot.",
  }),
  data_type: optionalStringEnum(CRYPTO_MARKET_DATA_TYPES, {
    description: "One market data section. Use either data_type or bundle, not both.",
  }),
  bundle: optionalStringEnum(CRYPTO_MARKET_BUNDLES, {
    description: "A predefined group of related market API sections.",
  }),
  depth: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 5_000, description: "Orderbook depth." }),
  ),
});

export const CryptoDerivativesDataInputSchema = Type.Object({
  ...QueryFields,
  market_type: stringEnum(CRYPTO_DERIVATIVE_MARKET_TYPES, {
    description: "Derivative market type. Spot is intentionally not accepted.",
  }),
  data_type: optionalStringEnum(CRYPTO_DERIVATIVE_DATA_TYPES, {
    description: "One derivatives section. Use either data_type or bundle, not both.",
  }),
  bundle: optionalStringEnum(CRYPTO_DERIVATIVE_BUNDLES, {
    description: "A predefined group of related derivatives API sections.",
  }),
});

export const CryptoOptionsDataInputSchema = Type.Object({
  ...QueryFields,
  data_type: optionalStringEnum(CRYPTO_OPTION_DATA_TYPES, {
    description: "One options section. Use either data_type or bundle, not both.",
  }),
  bundle: optionalStringEnum(CRYPTO_OPTION_BUNDLES, {
    description: "A predefined options research bundle.",
  }),
  expiry: Type.Optional(
    Type.String({
      minLength: 10,
      description: "Option expiry as YYYY-MM-DD or an ISO 8601 timestamp.",
    }),
  ),
  strike: Type.Optional(Type.Number({ exclusiveMinimum: 0, description: "Option strike price." })),
  option_type: optionalStringEnum(CRYPTO_OPTION_TYPES, {
    description: "Call or put. Required with expiry and strike for exact-contract sections.",
  }),
  depth: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 10_000, description: "Orderbook depth." }),
  ),
});

const AddressField = Type.Optional(
  Type.String({
    minLength: 2,
    maxLength: 200,
    description: "Chain-native contract or pool address.",
  }),
);

export const CryptoDexDataInputSchema = Type.Object(
  {
    data_type: optionalStringEnum(CRYPTO_DEX_DATA_TYPES, {
      description: "One DEX data section. Use either data_type or bundle, not both.",
    }),
    bundle: optionalStringEnum(CRYPTO_DEX_BUNDLES, {
      description: "A predefined DEX pool research bundle.",
    }),
    provider: optionalStringEnum(CRYPTO_DEX_PROVIDERS, {
      description:
        "Optional provider override. Auto selects the approved free provider by section.",
    }),
    chain: Type.Optional(Type.String({ minLength: 2, maxLength: 80 })),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    contract_address: AddressField,
    pool_address: AddressField,
    interval: optionalStringEnum(CRYPTO_INTERVALS, { description: "OHLCV interval." }),
    start_time: Type.Optional(Type.String({ minLength: 20, description: TIMESTAMP_DESCRIPTION })),
    end_time: Type.Optional(Type.String({ minLength: 20, description: TIMESTAMP_DESCRIPTION })),
    limit: LimitField,
  },
  { additionalProperties: false },
);

export const CryptoDefiDataInputSchema = Type.Object(
  {
    data_type: optionalStringEnum(CRYPTO_DEFI_DATA_TYPES, {
      description: "One DeFi fundamental section. Use either data_type or bundle, not both.",
    }),
    bundle: optionalStringEnum(CRYPTO_DEFI_BUNDLES, {
      description: "A predefined DeFi research bundle.",
    }),
    protocol: Type.Optional(
      Type.String({ minLength: 1, maxLength: 120, description: "Provider-neutral protocol slug." }),
    ),
    chain: Type.Optional(Type.String({ minLength: 2, maxLength: 80 })),
    stablecoin_id: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    pool_id: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    start_time: Type.Optional(Type.String({ minLength: 20, description: TIMESTAMP_DESCRIPTION })),
    end_time: Type.Optional(Type.String({ minLength: 20, description: TIMESTAMP_DESCRIPTION })),
    limit: LimitField,
  },
  { additionalProperties: false },
);

export const CryptoOnchainDataInputSchema = Type.Object(
  {
    data_type: optionalStringEnum(CRYPTO_ONCHAIN_DATA_TYPES, {
      description: "One reviewed on-chain data section. Use either data_type or bundle.",
    }),
    bundle: optionalStringEnum(CRYPTO_ONCHAIN_BUNDLES, {
      description: "A predefined EVM-address or Bitcoin-network research bundle.",
    }),
    provider: optionalStringEnum(CRYPTO_ONCHAIN_PROVIDERS, {
      description: "Optional provider override. Auto selects an approved free provider.",
    }),
    chain: Type.String({ minLength: 2, maxLength: 80 }),
    address: Type.Optional(Type.String({ minLength: 10, maxLength: 200 })),
    contract_address: Type.Optional(Type.String({ minLength: 10, maxLength: 200 })),
    from_block: Type.Optional(Type.Integer({ minimum: 0 })),
    to_block: Type.Optional(Type.Integer({ minimum: 0 })),
    topic0: Type.Optional(
      Type.String({ pattern: "^0x[0-9a-fA-F]{64}$", description: "Optional EVM topic0 hash." }),
    ),
    query_id: Type.Optional(
      Type.Integer({ minimum: 1, description: "Approved Dune saved-query id." }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
  },
  { additionalProperties: false },
);

export const CryptoAssetDataInputSchema = Type.Object(
  {
    data_type: optionalStringEnum(CRYPTO_ASSET_DATA_TYPES, {
      description: "One aggregate asset-data section. Use either data_type or bundle.",
    }),
    bundle: optionalStringEnum(CRYPTO_ASSET_BUNDLES, {
      description: "A predefined asset overview or market discovery bundle.",
    }),
    provider: optionalStringEnum(CRYPTO_ASSET_PROVIDERS, {
      description: "Optional aggregate provider override.",
    }),
    asset: Type.Optional(
      Type.String({ minLength: 1, maxLength: 120, description: "Asset slug, symbol, or name." }),
    ),
    quote_currency: Type.Optional(
      Type.String({ pattern: "^[A-Za-z0-9]{2,10}$", description: "Quote currency, default USD." }),
    ),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 250 })),
  },
  { additionalProperties: false },
);

export const CryptoSentimentDataInputSchema = Type.Object(
  {
    data_type: optionalStringEnum(CRYPTO_SENTIMENT_DATA_TYPES, {
      description: "One explicitly labeled sentiment or discovery signal section.",
    }),
    bundle: optionalStringEnum(CRYPTO_SENTIMENT_BUNDLES, {
      description: "Market sentiment or token discovery signal bundle.",
    }),
    provider: optionalStringEnum(CRYPTO_SENTIMENT_PROVIDERS, {
      description: "Optional provider override. Explicit providers are strict.",
    }),
    chain: Type.Optional(Type.String({ minLength: 2, maxLength: 80 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export type CryptoMarketDataInput = Static<typeof CryptoMarketDataInputSchema>;
export type CryptoDerivativesDataInput = Static<typeof CryptoDerivativesDataInputSchema>;
export type CryptoOptionsDataInput = Static<typeof CryptoOptionsDataInputSchema>;
export type CryptoDexDataInput = Static<typeof CryptoDexDataInputSchema>;
export type CryptoDefiDataInput = Static<typeof CryptoDefiDataInputSchema>;
export type CryptoOnchainDataInput = Static<typeof CryptoOnchainDataInputSchema>;
export type CryptoAssetDataInput = Static<typeof CryptoAssetDataInputSchema>;
export type CryptoSentimentDataInput = Static<typeof CryptoSentimentDataInputSchema>;
