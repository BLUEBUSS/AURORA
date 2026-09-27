import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { stashRawRecords } from "../../raw-data-stash.js";
import { formatToolResult } from "../format-tool-result.js";
import { assessResearchDataQuality, formatResearchDataQuality } from "../research-data-quality.js";
import { CryptoProviderError, toCryptoProviderError } from "./errors.js";
import type { CryptoSentimentProvider } from "./provider.js";
import { CryptoSentimentDataInputSchema, type CryptoSentimentDataInput } from "./schemas.js";
import {
  normalizeSentimentDataInput,
  normalizeSentimentProviderResult,
} from "./sentiment-normalize.js";

export function createCryptoSentimentDataTool(
  api: AgentToolApi,
  provider: CryptoSentimentProvider,
) {
  return (_toolCtx: { config?: unknown; sessionKey?: string }) => ({
    name: "crypto_sentiment_data",
    label: "加密情绪与发现信号",
    description:
      "查询 Bitcoin Fear & Greed、CoinGecko 搜索热度以及 DEX Screener 新 token/付费推广信号。" +
      "每条记录都标注信号含义与来源，不把推广或搜索热度解释为资产质量。",
    parameters: CryptoSentimentDataInputSchema,

    async execute(toolCallId: string, input: CryptoSentimentDataInput) {
      try {
        const query = normalizeSentimentDataInput(input);
        const rawResult = await provider.getSentimentData(query);
        const result = normalizeSentimentProviderResult(rawResult, query, provider.id);
        const records = result.sections.flatMap((section) => section.records);
        if (result.status === "complete" && records.length === 0) {
          throw new CryptoProviderError("NO_DATA", "No sentiment or discovery signals returned.");
        }
        if (records.length > 0) {
          stashRawRecords(toolCallId, records, {
            source: provider.id,
            provider: provider.id,
            chain: query.chain,
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
        api.logger.error(`[crypto_sentiment_data] ${mapped.code}: ${mapped.message}`);
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
