import type { ChartReadout } from "./types.js";

export function createPendingChartReadout(
  fileId: string,
  missingInformation: string[] = [],
): ChartReadout {
  return {
    schemaVersion: "chart-readout.v1",
    source: { kind: "image", fileId },
    visibleIndicators: [],
    candidatePatterns: [],
    levels: [],
    riskNotes: ["截图识别候选尚未经过结构化行情复核，不应视为交易信号。"],
    missingInformation,
    verification: { status: "not_available", comparedToStructuredData: false },
  };
}
