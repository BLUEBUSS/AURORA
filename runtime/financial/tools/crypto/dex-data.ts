import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { stashRawRecords } from "../../raw-data-stash.js";
import { formatToolResult } from "../format-tool-result.js";
import { CryptoProviderError, toCryptoProviderError } from "./errors.js";
import { normalizeDexDataInput, normalizeDexProviderResult } from "./normalize.js";
import type { CryptoDexProvider } from "./provider.js";
import { CryptoDexDataInputSchema, type CryptoDexDataInput } from "./schemas.js";

export function createCryptoDexDataTool(api: AgentToolApi, provider: CryptoDexProvider) {
  return (_toolCtx: { config?: unknown; sessionKey?: string }) => ({
    name: "crypto_dex_data",
    label: "加密 DEX 数据",
    description:
      "查询链上 token/pool 搜索、池快照、OHLCV、成交、流动性和交易活跃度。" +
      "优先使用 chain + contract_address 或 chain + pool_address，避免同名 ticker 误匹配。",
    parameters: CryptoDexDataInputSchema,

    async execute(toolCallId: string, input: CryptoDexDataInput) {
      try {
        const query = normalizeDexDataInput(input);
        const rawResult = await provider.getDexData(query);
        const result = normalizeDexProviderResult(rawResult, query, provider.id);
        const records = result.sections.flatMap((section) => section.records);
        if (result.status === "complete" && records.length === 0) {
          throw new CryptoProviderError(
            "NO_DATA",
            "No DEX data returned for the requested identity.",
          );
        }
        if (records.length > 0) {
          stashRawRecords(toolCallId, records, {
            source: provider.id,
            provider: provider.id,
            chain: query.chain,
            poolAddress: query.poolAddress,
            contractAddress: query.contractAddress,
            status: result.status,
            dataTypes: result.sections.map((section) => section.dataType),
          });
        }
        return formatResult(provider.id, result.status, result.sections, records);
      } catch (error) {
        return formatError(api, error);
      }
    },
  });
}

function formatResult(
  provider: string,
  status: string,
  sections: Array<{
    dataType: string;
    status: string;
    records: Record<string, unknown>[];
    issues?: unknown[];
  }>,
  records: Record<string, unknown>[],
) {
  const sectionSummary = sections
    .map((section) => `${section.dataType}:${section.status}(${section.records.length})`)
    .join(", ");
  const issues = sections.flatMap((section) => section.issues ?? []);
  const text = formatToolResult({ source: provider, status, sections: sectionSummary }, records);
  return {
    content: [
      {
        type: "text" as const,
        text: text + (issues.length ? `\n\nissues: ${JSON.stringify(issues)}` : ""),
      },
    ],
    isError: false,
  };
}

function formatError(api: AgentToolApi, error: unknown) {
  const mapped = toCryptoProviderError(error);
  api.logger.error(`[crypto_dex_data] ${mapped.code}: ${mapped.message}`);
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
