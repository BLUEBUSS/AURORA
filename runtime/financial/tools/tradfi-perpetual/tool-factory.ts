import type { TSchema } from "@sinclair/typebox";
import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { stashRawRecords } from "../../raw-data-stash.js";
import { formatToolResult } from "../format-tool-result.js";
import { assessResearchDataQuality, formatResearchDataQuality } from "../research-data-quality.js";
import {
  formatTechnicalAnalysisResult,
  formatTechnicalIndicatorsSection,
} from "./analytics-format.js";
import { enrichTradfiPerpetualResultWithAnalytics } from "./analytics.js";
import { TradfiPerpetualProviderError, toTradfiPerpetualProviderError } from "./errors.js";
import { validateTradfiPerpetualResult } from "./normalize.js";
import type { TradfiPerpetualProvider } from "./provider.js";
import type { TradfiPerpetualQuery } from "./types.js";

interface TradfiPerpetualToolDefinition<TInput> {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  normalizeInput(input: TInput): TradfiPerpetualQuery;
}

export function createTradfiPerpetualTool<TInput>(
  api: AgentToolApi,
  provider: TradfiPerpetualProvider,
  definition: TradfiPerpetualToolDefinition<TInput>,
) {
  return (_toolCtx: { config?: unknown; sessionKey?: string }) => ({
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,

    async execute(toolCallId: string, input: TInput) {
      try {
        const query = definition.normalizeInput(input);
        const providerResult = await provider.getData(query);
        const rawResult = enrichTradfiPerpetualResultWithAnalytics(query, providerResult);
        const result = validateTradfiPerpetualResult(rawResult, provider.id);
        const records = result.sections.flatMap((section) => section.records);
        const issues = [
          ...(result.issues ?? []),
          ...result.sections.flatMap((section) => section.issues ?? []),
        ];
        const quality = assessResearchDataQuality({ status: result.status, records, issues });

        if (result.status === "complete" && records.length === 0) {
          throw new TradfiPerpetualProviderError(
            "NO_DATA",
            `No Binance equity-linked TradFi perpetual data returned for ${query.symbol ?? "the requested catalog"}.`,
          );
        }

        if (records.length > 0) {
          stashRawRecords(toolCallId, records, {
            source: provider.id,
            provider: provider.id,
            venue: "binance",
            action: query.action,
            symbol: query.symbol,
            status: result.status,
            dataTypes: result.sections.map((section) => section.dataType),
            coverage: result.sections
              .filter((section) => section.coverage)
              .map((section) => ({ dataType: section.dataType, ...section.coverage })),
            isCashEquity: false,
            quality,
          });
        }

        const header = [
          `source: ${provider.id}`,
          "venue: binance",
          `action: ${query.action}`,
          query.symbol ? `symbol: ${query.symbol}` : undefined,
          `status: ${result.status}`,
          "isCashEquity: false",
        ]
          .filter(Boolean)
          .join(" | ");
        const sectionText =
          query.action === "technical_analysis_input"
            ? formatTechnicalAnalysisResult(result)
            : result.sections
                .map((section) =>
                  section.dataType === "technical_indicators"
                    ? formatTechnicalIndicatorsSection(section)
                    : formatToolResult(
                        {
                          section: section.dataType,
                          status: section.status,
                          recordCount: section.records.length,
                        },
                        section.records,
                      ),
                )
                .join("\n\n---\n\n");
        const coverage = result.sections
          .filter((section) => section.coverage)
          .map((section) => ({ dataType: section.dataType, ...section.coverage }));
        const qualityText = formatResearchDataQuality(quality);
        const suffix =
          query.action === "technical_analysis_input"
            ? ""
            : [
                coverage.length ? `coverage: ${JSON.stringify(coverage)}` : undefined,
                issues.length ? `issues: ${JSON.stringify(issues)}` : undefined,
                "notice: Binance TradFi perpetuals are USDT-settled derivatives, not cash equities or ownership of the underlying security.",
              ]
                .filter(Boolean)
                .join("\n\n");
        const responseText =
          query.action === "technical_analysis_input"
            ? [sectionText, qualityText].join("\n\n")
            : [header, sectionText, qualityText, suffix].filter(Boolean).join("\n\n");
        return {
          content: [
            {
              type: "text" as const,
              text: responseText,
            },
          ],
        };
      } catch (error) {
        const mapped = toTradfiPerpetualProviderError(error);
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
