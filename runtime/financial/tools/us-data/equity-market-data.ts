import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { normalizeEquityMarketDataInput } from "./normalize.js";
import type { UsEquityMarketProvider } from "./provider.js";
import { UsEquityMarketDataInputSchema, type UsEquityMarketDataInput } from "./schemas.js";
import { createUsDataTool } from "./tool-factory.js";
import type { UsEquityBarRecord, UsEquityMarketDataQuery } from "./types.js";

export function createUsEquityMarketDataTool(api: AgentToolApi, provider: UsEquityMarketProvider) {
  return createUsDataTool<
    UsEquityMarketDataInput,
    UsEquityMarketDataQuery,
    "ohlcv",
    UsEquityBarRecord,
    UsEquityMarketProvider
  >(api, provider, {
    name: "us_equity_market_data",
    label: "美股行情数据",
    description:
      "Fetch provider-neutral US equity daily, weekly, or monthly OHLCV bars with adjusted close when available.",
    parameters: UsEquityMarketDataInputSchema,
    normalizeInput: normalizeEquityMarketDataInput,
    request: (provider, query) => provider.getEquityMarketData(query),
    summarize: (query) => ({
      symbol: query.symbol,
      frequency: query.frequency,
      adjustment: query.adjustment,
      startDate: query.startDate,
      endDate: query.endDate,
    }),
    noDataMessage: (query) => `No US equity bars returned for ${query.symbol}.`,
  });
}
