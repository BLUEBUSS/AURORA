import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { stashRawRecords } from "../../raw-data-stash.js";
import { formatToolResult } from "../format-tool-result.js";
import { assessResearchDataQuality, formatResearchDataQuality } from "../research-data-quality.js";
import { CryptoProviderError, toCryptoProviderError } from "./errors.js";
import { normalizeOnchainDataInput, normalizeOnchainProviderResult } from "./onchain-normalize.js";
import type { CryptoOnchainProvider } from "./provider.js";
import { CryptoOnchainDataInputSchema, type CryptoOnchainDataInput } from "./schemas.js";

export function createCryptoOnchainDataTool(api: AgentToolApi, provider: CryptoOnchainProvider) {
  return (_toolCtx: { config?: unknown; sessionKey?: string }) => ({
    name: "crypto_onchain_data",
    label: "加密链上数据",
    description:
      "查询经审核的 EVM 地址活动、代币转账、日志、Gas，以及 Bitcoin 区块、费用和内存池。" +
      "Dune 仅允许读取部署方白名单中的已保存查询，不接受任意 SQL 或 RPC。",
    parameters: CryptoOnchainDataInputSchema,

    async execute(toolCallId: string, input: CryptoOnchainDataInput) {
      try {
        const query = normalizeOnchainDataInput(input);
        const rawResult = await provider.getOnchainData(query);
        const result = normalizeOnchainProviderResult(rawResult, query, provider.id);
        const records = result.sections.flatMap((section) => section.records);
        if (result.status === "complete" && records.length === 0) {
          throw new CryptoProviderError("NO_DATA", "No on-chain data returned for the request.");
        }
        if (records.length > 0) {
          stashRawRecords(toolCallId, records, {
            source: provider.id,
            provider: provider.id,
            chain: query.chain,
            address: query.address,
            contractAddress: query.contractAddress,
            queryId: query.queryId,
            status: result.status,
            dataTypes: result.sections.map((section) => section.dataType),
          });
        }
        const sections = result.sections
          .map((section) => `${section.dataType}:${section.status}(${section.records.length})`)
          .join(", ");
        const issues = [
          ...(result.issues ?? []),
          ...result.sections.flatMap((section) => section.issues ?? []),
        ];
        const quality = assessResearchDataQuality({ status: result.status, records, issues });
        const text = formatToolResult(
          { source: provider.id, chain: query.chain, status: result.status, sections },
          records,
        );
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
          isError: false,
        };
      } catch (error) {
        const mapped = toCryptoProviderError(error);
        api.logger.error(`[crypto_onchain_data] ${mapped.code}: ${mapped.message}`);
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
