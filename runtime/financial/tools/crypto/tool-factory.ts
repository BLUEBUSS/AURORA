import type { TSchema } from "@sinclair/typebox";
import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { stashRawRecords } from "../../raw-data-stash.js";
import { formatToolResult } from "../format-tool-result.js";
import { assessResearchDataQuality, formatResearchDataQuality } from "../research-data-quality.js";
import { CryptoProviderError, toCryptoProviderError } from "./errors.js";
import { normalizeProviderResult } from "./normalize.js";
import type { CryptoProvider } from "./provider.js";
import type {
  CryptoDerivativeRecord,
  CryptoMarketDataRecord,
  CryptoMarketQuery,
  CryptoProviderResult,
} from "./types.js";

interface CryptoDomainToolDefinition<
  TInput,
  TQuery extends CryptoMarketQuery,
  TDataType extends string,
  TRecord extends CryptoMarketDataRecord | CryptoDerivativeRecord,
> {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  normalizeInput(input: TInput): TQuery;
  request(
    provider: CryptoProvider,
    query: TQuery,
  ): Promise<CryptoProviderResult<TDataType, TRecord>>;
}

export function createCryptoDomainTool<
  TInput,
  TQuery extends CryptoMarketQuery,
  TDataType extends string,
  TRecord extends CryptoMarketDataRecord | CryptoDerivativeRecord,
>(
  api: AgentToolApi,
  provider: CryptoProvider,
  definition: CryptoDomainToolDefinition<TInput, TQuery, TDataType, TRecord>,
) {
  return (_toolCtx: { config?: unknown; sessionKey?: string }) => ({
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,

    async execute(toolCallId: string, input: TInput) {
      try {
        const query = definition.normalizeInput(input);
        const rawResult = await definition.request(provider, query);
        const result = normalizeProviderResult(rawResult, query, provider.id);
        const records = result.sections.flatMap((section) => section.records);
        const issues = [
          ...(result.issues ?? []),
          ...result.sections.flatMap((section) => section.issues ?? []),
        ];
        const quality = assessResearchDataQuality({
          status: result.status,
          records,
          issues,
        });

        if (result.status === "complete" && records.length === 0) {
          throw new CryptoProviderError(
            "NO_DATA",
            `No data returned for ${query.symbol} ${query.marketType}.`,
          );
        }

        if (records.length > 0) {
          stashRawRecords(toolCallId, records, {
            source: provider.id,
            provider: provider.id,
            symbol: query.symbol,
            marketType: query.marketType,
            venue: query.venue ?? "provider-default",
            status: result.status,
            dataTypes: result.sections.map((section) => section.dataType),
            quality,
          });
        }

        const sectionSummary = result.sections
          .map((section) => `${section.dataType}:${section.status}(${section.records.length})`)
          .join(", ");
        const text = formatToolResult(
          {
            source: provider.id,
            symbol: query.symbol,
            marketType: query.marketType,
            status: result.status,
            sections: sectionSummary,
          },
          records,
        );
        const qualityText = `\n\n${formatResearchDataQuality(quality)}`;
        const issueText = issues.length ? `\n\nissues: ${JSON.stringify(issues)}` : "";
        return { content: [{ type: "text" as const, text: text + qualityText + issueText }] };
      } catch (error) {
        const mapped = toCryptoProviderError(error);
        api.logger.error(`[${definition.name}] ${mapped.code}: ${mapped.message}`);
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
