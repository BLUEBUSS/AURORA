import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { stashRawRecords } from "../../raw-data-stash.js";
import { formatToolResult } from "../format-tool-result.js";
import { normalizeAssetDataInput, normalizeAssetProviderResult } from "./asset-normalize.js";
import { CryptoProviderError, toCryptoProviderError } from "./errors.js";
import type { CryptoAssetProvider } from "./provider.js";
import { CryptoAssetDataInputSchema, type CryptoAssetDataInput } from "./schemas.js";

export function createCryptoAssetDataTool(api: AgentToolApi, provider: CryptoAssetProvider) {
  return (_toolCtx: { config?: unknown; sessionKey?: string }) => ({
    name: "crypto_asset_data",
    label: "加密资产数据",
    description:
      "查询聚合资产档案、价格市值、供应量、排名、分类、交易场所和热门资产。" +
      "所有记录均为 aggregate 口径，不返回盘口、衍生品或链上账户事实。",
    parameters: CryptoAssetDataInputSchema,

    async execute(toolCallId: string, input: CryptoAssetDataInput) {
      try {
        const query = normalizeAssetDataInput(input);
        const rawResult = await provider.getAssetData(query);
        const result = normalizeAssetProviderResult(rawResult, query, provider.id);
        const records = result.sections.flatMap((section) => section.records);
        if (result.status === "complete" && records.length === 0) {
          throw new CryptoProviderError("NO_DATA", "No aggregate asset data returned.");
        }
        if (records.length > 0) {
          stashRawRecords(toolCallId, records, {
            source: provider.id,
            provider: provider.id,
            asset: query.asset,
            quoteCurrency: query.quoteCurrency,
            status: result.status,
            dataTypes: result.sections.map((section) => section.dataType),
          });
        }
        const sections = result.sections
          .map((section) => `${section.dataType}:${section.status}(${section.records.length})`)
          .join(", ");
        const issues = result.sections.flatMap((section) => section.issues ?? []);
        const text = formatToolResult(
          { source: provider.id, asset: query.asset, status: result.status, sections },
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
        api.logger.error(`[crypto_asset_data] ${mapped.code}: ${mapped.message}`);
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
