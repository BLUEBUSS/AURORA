import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { normalizeEquityFundamentalsInput } from "./normalize.js";
import type { UsEquityFundamentalsProvider } from "./provider.js";
import { UsEquityFundamentalsInputSchema, type UsEquityFundamentalsInput } from "./schemas.js";
import { createUsDataTool } from "./tool-factory.js";
import type { UsEquityFundamentalRecord, UsEquityFundamentalsQuery } from "./types.js";

export function createUsEquityFundamentalsTool(
  api: AgentToolApi,
  provider: UsEquityFundamentalsProvider,
) {
  return createUsDataTool<
    UsEquityFundamentalsInput,
    UsEquityFundamentalsQuery,
    "fundamental_fact",
    UsEquityFundamentalRecord,
    UsEquityFundamentalsProvider
  >(api, provider, {
    name: "us_equity_fundamentals",
    label: "美股基本面数据",
    description:
      "Fetch normalized SEC EDGAR company facts for a US equity, grouped by companyfacts, income, balance, or cashflow.",
    parameters: UsEquityFundamentalsInputSchema,
    normalizeInput: normalizeEquityFundamentalsInput,
    request: (provider, query) => provider.getEquityFundamentals(query),
    summarize: (query) => ({
      symbol: query.symbol,
      statement: query.statement,
      annualOnly: query.annualOnly,
    }),
    noDataMessage: (query) => `No SEC company facts returned for ${query.symbol}.`,
  });
}
