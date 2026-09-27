export const DATA_QUALITY_SCHEMA_VERSION = "fin-core.data-quality.v1" as const;

export type DataQualityGrade = "good" | "degraded" | "failed";
export type DataQualityStatus = "complete" | "partial";

export interface DataCitation {
  label: string;
  url: string;
}

export interface DataQualitySummary {
  schemaVersion: typeof DATA_QUALITY_SCHEMA_VERSION;
  status: DataQualityStatus;
  grade: DataQualityGrade;
  score: number;
  recordCount: number;
  attributedRecordCount: number;
  fallbackUsed: boolean;
  citations: DataCitation[];
  issueCodes: string[];
}

export interface DataQualityIssue {
  code: string;
  message: string;
}

type AssessDataQualityInput<TRecord> = {
  status: DataQualityStatus;
  records: TRecord[];
  issues?: DataQualityIssue[];
  citations?: DataCitation[];
  isAttributed?: (record: TRecord) => boolean;
  failOnMissingAttribution?: boolean;
};

export function assessDataQuality<TRecord>(
  input: AssessDataQualityInput<TRecord>,
): DataQualitySummary {
  const issues = input.issues ?? [];
  const issueCodes = [...new Set(issues.map((issue) => issue.code))];
  const fallbackUsed = issueCodes.includes("PROVIDER_FALLBACK");
  const isAttributed = input.isAttributed ?? (() => true);
  const attributedRecordCount = input.records.filter(isAttributed).length;
  const missingAttribution = attributedRecordCount < input.records.length;

  let score = input.records.length === 0 ? 0 : 100;
  if (fallbackUsed) score = Math.max(0, score - 15);
  if (input.status === "partial") score = Math.max(0, score - 25);
  if (missingAttribution) score = Math.max(0, score - 40);

  const grade: DataQualityGrade =
    score === 0 || (input.failOnMissingAttribution === true && missingAttribution)
      ? "failed"
      : score < 100
        ? "degraded"
        : "good";

  return {
    schemaVersion: DATA_QUALITY_SCHEMA_VERSION,
    status: input.status,
    grade,
    score,
    recordCount: input.records.length,
    attributedRecordCount,
    fallbackUsed,
    citations: input.citations ?? [],
    issueCodes,
  };
}
