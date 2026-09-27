import type { TSchema } from "@sinclair/typebox";
import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { stashRawRecords } from "../../raw-data-stash.js";
import { formatToolResult } from "../format-tool-result.js";
import { toUsDataProviderError, UsDataProviderError } from "./errors.js";
import { validateUsProviderResult } from "./normalize.js";
import { assessUsDataQuality, formatUsDataQualitySummary } from "./quality.js";
import type { UsDataProviderResult, UsDataRecord } from "./types.js";

interface UsDataToolDefinition<
  TInput,
  TQuery,
  TDataType extends string,
  TRecord extends UsDataRecord,
  TProvider extends { readonly id: string },
> {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  normalizeInput(input: TInput): TQuery;
  request(provider: TProvider, query: TQuery): Promise<UsDataProviderResult<TDataType, TRecord>>;
  summarize(query: TQuery): Record<string, unknown>;
  noDataMessage(query: TQuery): string;
}

export function createUsDataTool<
  TInput,
  TQuery,
  TDataType extends string,
  TRecord extends UsDataRecord,
  TProvider extends { readonly id: string },
>(
  api: AgentToolApi,
  provider: TProvider,
  definition: UsDataToolDefinition<TInput, TQuery, TDataType, TRecord, TProvider>,
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
        const result = validateUsProviderResult(rawResult, provider.id);
        const records = result.sections.flatMap((section) => section.records);
        const quality = assessUsDataQuality(result);

        if (result.status === "complete" && records.length === 0) {
          throw new UsDataProviderError("NO_DATA", definition.noDataMessage(query));
        }

        if (records.length > 0) {
          stashRawRecords(toolCallId, records, {
            source: provider.id,
            provider: provider.id,
            status: result.status,
            dataTypes: result.sections.map((section) => section.dataType),
            quality,
            ...definition.summarize(query),
          });
        }

        const sectionSummary = result.sections
          .map((section) => `${section.dataType}:${section.status}(${section.records.length})`)
          .join(", ");
        const text = formatToolResult(
          {
            source: provider.id,
            status: result.status,
            sections: sectionSummary,
            ...definition.summarize(query),
          },
          records,
        );
        const issues = [
          ...(result.issues ?? []),
          ...result.sections.flatMap((section) => section.issues ?? []),
        ];
        const issueText = issues.length ? `\n\nissues: ${JSON.stringify(issues)}` : "";
        const qualityText = `\n\n${formatUsDataQualitySummary(quality)}`;
        return { content: [{ type: "text" as const, text: text + qualityText + issueText }] };
      } catch (error) {
        const mapped = toUsDataProviderError(error);
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
