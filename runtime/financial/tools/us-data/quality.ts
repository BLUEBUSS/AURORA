import {
  assessDataQuality,
  type DataCitation,
  type DataQualityGrade,
  type DataQualitySummary,
} from "../../data-contracts/index.js";
import type { UsDataProviderIssue, UsDataProviderResult, UsDataRecord } from "./types.js";

export type UsDataQualityGrade = DataQualityGrade;

export interface UsDataCitation extends DataCitation {}

export interface UsDataQualitySummary extends DataQualitySummary {
  issues: UsDataProviderIssue[];
}

export function assessUsDataQuality(
  result: UsDataProviderResult<string, UsDataRecord>,
): UsDataQualitySummary {
  const records = result.sections.flatMap((section) => section.records);
  const issues = [
    ...(result.issues ?? []),
    ...result.sections.flatMap((section) => section.issues ?? []),
  ];
  const isPartial =
    result.status === "partial" || result.sections.some((section) => section.status === "partial");

  return {
    ...assessDataQuality({
      status: isPartial ? "partial" : "complete",
      records,
      issues,
      citations: buildCitations(records),
      isAttributed: (record) => Boolean(record.provider && record.source),
      failOnMissingAttribution: true,
    }),
    issues,
  };
}

export function formatUsDataQualitySummary(quality: UsDataQualitySummary): string {
  const lines = [
    `quality: ${quality.grade} (${quality.score}/100)`,
    `fallback: ${quality.fallbackUsed ? "yes" : "no"}`,
    `records: ${quality.recordCount}`,
  ];
  if (quality.citations.length > 0) {
    lines.push(
      "sources:",
      ...quality.citations.map((citation) => `- [${citation.label}](${citation.url})`),
    );
  }
  return lines.join("\n");
}

function buildCitations(records: UsDataRecord[]): UsDataCitation[] {
  const citations = new Map<string, UsDataCitation>();
  for (const record of records) {
    const citation = citationForRecord(record);
    if (citation) citations.set(citation.url, citation);
  }
  return [...citations.values()];
}

function citationForRecord(record: UsDataRecord): UsDataCitation | undefined {
  const source = record.source.toLowerCase();
  if (source.includes("fred") && record.dataType === "macro_observation") {
    return {
      label: `FRED · ${record.seriesId}`,
      url: `https://fred.stlouisfed.org/series/${encodeURIComponent(record.seriesId)}`,
    };
  }
  if (source.includes("eod")) {
    return { label: "EOD Historical Data", url: "https://eodhd.com/financial-apis/" };
  }
  if (source.includes("alpha vantage")) {
    return { label: "Alpha Vantage", url: "https://www.alphavantage.co/" };
  }
  if (source.includes("sec")) {
    if (record.dataType === "filing" && record.url) {
      return { label: `SEC EDGAR · ${record.form}`, url: record.url };
    }
    if (record.dataType === "fundamental_fact") {
      return {
        label: "SEC EDGAR · Company Facts",
        url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${record.cik}.json`,
      };
    }
  }
  return undefined;
}
