import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { stashRawRecords } from "../../raw-data-stash.js";
import { formatToolResult } from "../format-tool-result.js";
import { assessResearchDataQuality, formatResearchDataQuality } from "../research-data-quality.js";
import { CryptoProviderError, toCryptoProviderError } from "./errors.js";
import { normalizeOptionsDataInput, normalizeOptionsProviderResult } from "./normalize.js";
import type { CryptoOptionsProvider } from "./provider.js";
import { CryptoOptionsDataInputSchema, type CryptoOptionsDataInput } from "./schemas.js";

export function createCryptoOptionsDataTool(api: AgentToolApi, provider: CryptoOptionsProvider) {
  return (_toolCtx: { config?: unknown; sessionKey?: string }) => ({
    name: "crypto_options_data",
    label: "加密期权数据",
    description:
      "查询加密期权链、精确合约行情/盘口/成交、Greeks、隐含波动率、波动率指数和到期结构。" +
      "输入使用 canonical BASE/QUOTE，精确合约通过 expiry、strike、option_type 选择，不需要拼交易所私有合约名。",
    parameters: CryptoOptionsDataInputSchema,

    async execute(toolCallId: string, input: CryptoOptionsDataInput) {
      try {
        const query = normalizeOptionsDataInput(input);
        const rawResult = await provider.getOptionsData(query);
        const result = normalizeOptionsProviderResult(rawResult, query, provider.id);
        const records = result.sections.flatMap((section) => section.records);
        if (result.status === "complete" && records.length === 0) {
          throw new CryptoProviderError("NO_DATA", `No options data returned for ${query.symbol}.`);
        }
        if (records.length > 0) {
          stashRawRecords(toolCallId, records, {
            source: provider.id,
            provider: provider.id,
            symbol: query.symbol,
            venue: query.venue,
            status: result.status,
            dataTypes: result.sections.map((section) => section.dataType),
          });
        }
        const sectionSummary = result.sections
          .map((section) => `${section.dataType}:${section.status}(${section.records.length})`)
          .join(", ");
        const text = formatToolResult(
          {
            source: provider.id,
            symbol: query.symbol,
            venue: query.venue,
            status: result.status,
            sections: sectionSummary,
          },
          records,
        );
        const issues = [
          ...(result.issues ?? []),
          ...result.sections.flatMap((section) => section.issues ?? []),
        ];
        const quality = assessResearchDataQuality({ status: result.status, records, issues });
        return {
          content: [
            {
              type: "text" as const,
              text:
                text +
                `\n\n${formatResearchDataQuality(quality)}` +
                (issues.length ? `\n\nissues: ${JSON.stringify(issues)}` : ""),
            },
          ],
        };
      } catch (error) {
        const mapped = toCryptoProviderError(error);
        api.logger.error(`[crypto_options_data] ${mapped.code}: ${mapped.message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: {
                  code: mapped.code,
                  message: mapped.message,
                  retryAfterMs: mapped.details.retryAfterMs,
                },
              }),
            },
          ],
          isError: true,
        };
      }
    },
  });
}
