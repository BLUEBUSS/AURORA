import { Type, type Static } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum } from "../../runtime/plugin-api.js";
import {
  US_EQUITY_ADJUSTMENTS,
  US_EQUITY_FILING_PROVIDERS,
  US_EQUITY_FREQUENCIES,
  US_EQUITY_FUNDAMENTAL_PROVIDERS,
  US_EQUITY_FUNDAMENTAL_STATEMENTS,
  US_EQUITY_MARKET_PROVIDERS,
  US_MACRO_INDICATORS,
  US_MACRO_PROVIDERS,
  US_MACRO_VALUE_UNITS,
} from "./types.js";

const DATE_DESCRIPTION = "YYYY-MM-DD date.";

const DateRangeFields = {
  start_date: Type.Optional(
    Type.String({ minLength: 10, maxLength: 10, description: DATE_DESCRIPTION }),
  ),
  end_date: Type.Optional(
    Type.String({ minLength: 10, maxLength: 10, description: DATE_DESCRIPTION }),
  ),
};

const UsSymbolField = Type.String({
  pattern: "^[A-Za-z][A-Za-z0-9.-]{0,14}$",
  description: "US equity ticker, for example AAPL, MSFT, SPY, or BRK.B.",
});

export const UsMacroIndicatorDataInputSchema = Type.Object(
  {
    indicator: stringEnum(US_MACRO_INDICATORS, {
      description: "Provider-neutral US macro indicator.",
    }),
    provider: optionalStringEnum(US_MACRO_PROVIDERS, {
      description: "Provider override. Auto currently selects FRED.",
    }),
    units: optionalStringEnum(US_MACRO_VALUE_UNITS, {
      description: "Value transform. Defaults to level.",
    }),
    ...DateRangeFields,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5_000 })),
  },
  { additionalProperties: false },
);

export const UsEquityMarketDataInputSchema = Type.Object(
  {
    symbol: UsSymbolField,
    provider: optionalStringEnum(US_EQUITY_MARKET_PROVIDERS, {
      description: "Provider override. Auto prefers EODHD, then Alpha Vantage.",
    }),
    frequency: optionalStringEnum(US_EQUITY_FREQUENCIES, {
      description: "OHLCV frequency. Defaults to daily.",
    }),
    adjustment: optionalStringEnum(US_EQUITY_ADJUSTMENTS, {
      description: "Adjusted close preference. Defaults to adjusted.",
    }),
    ...DateRangeFields,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
  },
  { additionalProperties: false },
);

export const UsEquityFilingsInputSchema = Type.Object(
  {
    symbol: UsSymbolField,
    provider: optionalStringEnum(US_EQUITY_FILING_PROVIDERS, {
      description: "Provider override. Auto currently selects SEC EDGAR.",
    }),
    forms: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 120,
        description: "Comma-separated filing forms, for example 10-K,10-Q,8-K.",
      }),
    ),
    ...DateRangeFields,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);

export const UsEquityFundamentalsInputSchema = Type.Object(
  {
    symbol: UsSymbolField,
    provider: optionalStringEnum(US_EQUITY_FUNDAMENTAL_PROVIDERS, {
      description: "Provider override. Auto currently selects SEC EDGAR.",
    }),
    statement: optionalStringEnum(US_EQUITY_FUNDAMENTAL_STATEMENTS, {
      description: "Company facts section. Defaults to companyfacts.",
    }),
    concepts: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 500,
        description: "Comma-separated SEC us-gaap concepts to fetch.",
      }),
    ),
    annual_only: Type.Optional(Type.Boolean({ description: "Only keep FY facts when true." })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);

export type UsMacroIndicatorDataInput = Static<typeof UsMacroIndicatorDataInputSchema>;
export type UsEquityMarketDataInput = Static<typeof UsEquityMarketDataInputSchema>;
export type UsEquityFilingsInput = Static<typeof UsEquityFilingsInputSchema>;
export type UsEquityFundamentalsInput = Static<typeof UsEquityFundamentalsInputSchema>;
