import { UsDataProviderError } from "./errors.js";
import type {
  UsEquityFilingsInput,
  UsEquityFundamentalsInput,
  UsEquityMarketDataInput,
  UsMacroIndicatorDataInput,
} from "./schemas.js";
import type {
  UsDataProviderResult,
  UsDataRecord,
  UsEquityFilingsQuery,
  UsEquityFundamentalsQuery,
  UsEquityMarketDataQuery,
  UsMacroDataQuery,
} from "./types.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value: string): string {
  const date = value.trim();
  if (!DATE_PATTERN.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new UsDataProviderError("INVALID_ARGUMENT", `Invalid date "${value}". Use YYYY-MM-DD.`);
  }
  return date;
}

function normalizeDateRange(startDate?: string, endDate?: string) {
  if ((startDate && !endDate) || (!startDate && endDate)) {
    throw new UsDataProviderError(
      "INVALID_ARGUMENT",
      "start_date and end_date must be provided together.",
    );
  }
  if (!startDate || !endDate) return {};
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  if (start > end) {
    throw new UsDataProviderError("INVALID_ARGUMENT", "start_date must be before end_date.");
  }
  return { startDate: start, endDate: end };
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function parseCommaList(value?: string): string[] | undefined {
  const items = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length ? items : undefined;
}

export function normalizeMacroIndicatorInput(input: UsMacroIndicatorDataInput): UsMacroDataQuery {
  return {
    indicator: input.indicator,
    provider: input.provider ?? "auto",
    units: input.units ?? "level",
    ...normalizeDateRange(input.start_date, input.end_date),
    limit: input.limit,
  };
}

export function normalizeEquityMarketDataInput(
  input: UsEquityMarketDataInput,
): UsEquityMarketDataQuery {
  return {
    symbol: normalizeSymbol(input.symbol),
    provider: input.provider ?? "auto",
    frequency: input.frequency ?? "daily",
    adjustment: input.adjustment ?? "adjusted",
    ...normalizeDateRange(input.start_date, input.end_date),
    limit: input.limit,
  };
}

export function normalizeEquityFilingsInput(input: UsEquityFilingsInput): UsEquityFilingsQuery {
  return {
    symbol: normalizeSymbol(input.symbol),
    provider: input.provider ?? "auto",
    forms: parseCommaList(input.forms)?.map((form) => form.toUpperCase()),
    ...normalizeDateRange(input.start_date, input.end_date),
    limit: input.limit ?? 20,
  };
}

export function normalizeEquityFundamentalsInput(
  input: UsEquityFundamentalsInput,
): UsEquityFundamentalsQuery {
  return {
    symbol: normalizeSymbol(input.symbol),
    provider: input.provider ?? "auto",
    statement: input.statement ?? "companyfacts",
    concepts: parseCommaList(input.concepts),
    annualOnly: input.annual_only,
    limit: input.limit ?? 50,
  };
}

export function validateUsProviderResult<TDataType extends string, TRecord extends UsDataRecord>(
  result: UsDataProviderResult<TDataType, TRecord>,
  providerId: string,
): UsDataProviderResult<TDataType, TRecord> {
  const sections = result.sections.map((section) => ({
    ...section,
    records: section.records.map((record) => ({
      ...record,
      provider: record.provider || providerId,
    })),
  }));
  const issues = [...(result.issues ?? []), ...sections.flatMap((section) => section.issues ?? [])];
  const isPartial =
    result.status === "partial" || sections.some((section) => section.status === "partial");
  if (isPartial && !issues.some((issue) => issue.code === "PARTIAL_DATA")) {
    throw new UsDataProviderError(
      "UPSTREAM_ERROR",
      "Partial provider results must include a PARTIAL_DATA issue.",
    );
  }
  return { ...result, sections };
}
