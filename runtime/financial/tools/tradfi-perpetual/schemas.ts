import { Type, type Static } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum } from "../../runtime/plugin-api.js";
import {
  TRADFI_PERPETUAL_ACTIONS,
  TRADFI_PERPETUAL_INTERVALS,
  TRADFI_PERPETUAL_PRICE_SERIES,
} from "./types.js";

const TIMESTAMP_DESCRIPTION = "ISO 8601 timestamp with timezone, for example 2026-06-01T00:00:00Z";

export const TradfiPerpetualDataInputSchema = Type.Object(
  {
    user_query: Type.String({
      minLength: 2,
      maxLength: 2_000,
      description:
        "Copy the original user request verbatim. It must explicitly name Binance, 币安, or standalone BN.",
    }),
    action: stringEnum(TRADFI_PERPETUAL_ACTIONS, {
      description: "Research action for Binance equity-linked TradFi perpetual contracts.",
    }),
    symbol: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 80,
        description:
          "Exact company name or security code from the original user request, or an exact Binance venue symbol. Never translate a company name or invent a ticker; the provider resolves aliases and listing-market intent. Optional only for instruments.",
      }),
    ),
    price_series: optionalStringEnum(TRADFI_PERPETUAL_PRICE_SERIES, {
      description: "OHLCV price series. Only applies to action=ohlcv; defaults to trade.",
    }),
    interval: optionalStringEnum(TRADFI_PERPETUAL_INTERVALS, {
      description: "Requested Binance interval. Defaults to 1d.",
    }),
    start_time: Type.Optional(
      Type.String({ minLength: 20, maxLength: 40, description: TIMESTAMP_DESCRIPTION }),
    ),
    end_time: Type.Optional(
      Type.String({ minLength: 20, maxLength: 40, description: TIMESTAMP_DESCRIPTION }),
    ),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 1_500, description: "Maximum records per section." }),
    ),
    depth: Type.Optional(
      Type.Integer({ minimum: 5, maximum: 1_000, description: "Orderbook depth." }),
    ),
  },
  { additionalProperties: false },
);

export type TradfiPerpetualDataInput = Static<typeof TradfiPerpetualDataInputSchema>;
