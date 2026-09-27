import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { normalizeMacroIndicatorInput } from "./normalize.js";
import type { UsMacroProvider } from "./provider.js";
import { UsMacroIndicatorDataInputSchema, type UsMacroIndicatorDataInput } from "./schemas.js";
import { createUsDataTool } from "./tool-factory.js";
import type { UsMacroDataQuery, UsMacroObservationRecord } from "./types.js";

export function createUsMacroIndicatorDataTool(api: AgentToolApi, provider: UsMacroProvider) {
  return createUsDataTool<
    UsMacroIndicatorDataInput,
    UsMacroDataQuery,
    "macro_observation",
    UsMacroObservationRecord,
    UsMacroProvider
  >(api, provider, {
    name: "macro_indicator_data",
    label: "美国宏观指标数据",
    description:
      "Fetch provider-neutral US macro time series such as CPI, PPI, Core PCE, payrolls, unemployment, Fed funds, Treasury yields, and GDP.",
    parameters: UsMacroIndicatorDataInputSchema,
    normalizeInput: normalizeMacroIndicatorInput,
    request: (provider, query) => provider.getMacroIndicatorData(query),
    summarize: (query) => ({
      indicator: query.indicator,
      units: query.units,
      startDate: query.startDate,
      endDate: query.endDate,
    }),
    noDataMessage: (query) => `No macro observations returned for ${query.indicator}.`,
  });
}
