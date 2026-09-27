import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { stashRawRecords } from "../../raw-data-stash.js";
import { formatToolResult } from "../format-tool-result.js";
import { CryptoProviderError, toCryptoProviderError } from "./errors.js";
import { normalizeDefiDataInput, normalizeDefiProviderResult } from "./normalize.js";
import type { CryptoDefiProvider } from "./provider.js";
import { CryptoDefiDataInputSchema, type CryptoDefiDataInput } from "./schemas.js";

export function createCryptoDefiDataTool(api: AgentToolApi, provider: CryptoDefiProvider) {
  return (_toolCtx: { config?: unknown; sessionKey?: string }) => ({
    name: "crypto_defi_data",
    label: "加密 DeFi 数据",
    description:
      "查询协议和链 TVL、稳定币、收益率、DEX/期权成交量、DeFi 持仓量及费用收入。" +
      "通过 bundle 可一次获取协议基本面、稳定币概览或收益率筛选结果。",
    parameters: CryptoDefiDataInputSchema,

    async execute(toolCallId: string, input: CryptoDefiDataInput) {
      try {
        const query = normalizeDefiDataInput(input);
        const rawResult = await provider.getDefiData(query);
        const result = normalizeDefiProviderResult(rawResult, query, provider.id);
        const records = result.sections.flatMap((section) => section.records);
        if (result.status === "complete" && records.length === 0) {
          throw new CryptoProviderError(
            "NO_DATA",
            "No DeFi data returned for the requested filters.",
          );
        }
        if (records.length > 0) {
          stashRawRecords(toolCallId, records, {
            source: provider.id,
            provider: provider.id,
            protocol: query.protocol,
            chain: query.chain,
            status: result.status,
            dataTypes: result.sections.map((section) => section.dataType),
          });
        }
        const sectionSummary = result.sections
          .map((section) => `${section.dataType}:${section.status}(${section.records.length})`)
          .join(", ");
        const issues = result.sections.flatMap((section) => section.issues ?? []);
        const text = formatToolResult(
          {
            source: provider.id,
            protocol: query.protocol,
            chain: query.chain,
            status: result.status,
            sections: sectionSummary,
          },
          records,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: text + (issues.length ? `\n\nissues: ${JSON.stringify(issues)}` : ""),
            },
          ],
          isError: false,
        };
      } catch (error) {
        const mapped = toCryptoProviderError(error);
        api.logger.error(`[crypto_defi_data] ${mapped.code}: ${mapped.message}`);
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
