import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { normalizeEquityFilingsInput } from "./normalize.js";
import type { UsEquityFilingsProvider } from "./provider.js";
import { UsEquityFilingsInputSchema, type UsEquityFilingsInput } from "./schemas.js";
import { createUsDataTool } from "./tool-factory.js";
import type { UsEquityFilingRecord, UsEquityFilingsQuery } from "./types.js";

export function createUsEquityFilingsTool(api: AgentToolApi, provider: UsEquityFilingsProvider) {
  return createUsDataTool<
    UsEquityFilingsInput,
    UsEquityFilingsQuery,
    "filing",
    UsEquityFilingRecord,
    UsEquityFilingsProvider
  >(api, provider, {
    name: "us_equity_filings",
    label: "美股 SEC 公告",
    description:
      "Browse recent SEC EDGAR filings for a US equity, with optional form and date filters.",
    parameters: UsEquityFilingsInputSchema,
    normalizeInput: normalizeEquityFilingsInput,
    request: (provider, query) => provider.getEquityFilings(query),
    summarize: (query) => ({
      symbol: query.symbol,
      forms: query.forms?.join(","),
      startDate: query.startDate,
      endDate: query.endDate,
    }),
    noDataMessage: (query) => `No SEC filings returned for ${query.symbol}.`,
  });
}
