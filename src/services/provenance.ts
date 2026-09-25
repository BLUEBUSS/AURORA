import { gateway } from "./gateway";
import { isProvenanceId } from "../components/provenance/citations";

export interface ProvenanceEntry {
  provenanceId: string;
  sessionKey: string;
  toolName: string;
  toolCallId: string;
  timestamp?: number;
  label?: string;
  dataSource?: string;
  subject?: string;
  dataType?: string;
  timeRange?: string;
  persistedFilePath?: string;
  summary?: unknown;
  toolArgs?: unknown;
  toolResult?: string;
}

export interface ProvenanceData {
  records: unknown[] | null;
  totalRows: number;
  filename?: string;
  raw?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestParams(sessionKey: string, provenanceId: string) {
  if (!sessionKey.trim() || !isProvenanceId(provenanceId)) throw new Error("来源引用缺少有效的会话或标识。");
  return { sessionKey, provenanceId };
}

/** The RPC returns the entry directly, not an { entry } envelope. */
export async function resolveProvenance(sessionKey: string, provenanceId: string): Promise<ProvenanceEntry> {
  const result = await gateway.request<unknown>("fin-core.provenance.resolve", requestParams(sessionKey, provenanceId));
  if (!isRecord(result) || result.provenanceId !== provenanceId || typeof result.toolName !== "string" || typeof result.toolCallId !== "string") {
    throw new Error("后端返回的来源详情格式不完整。");
  }
  const optionalText = (key: string) => typeof result[key] === "string" ? result[key] as string : undefined;
  return {
    provenanceId,
    sessionKey: optionalText("sessionKey") || sessionKey,
    toolName: result.toolName,
    toolCallId: result.toolCallId,
    timestamp: typeof result.timestamp === "number" && Number.isFinite(result.timestamp) ? result.timestamp : undefined,
    label: optionalText("label"),
    dataSource: optionalText("dataSource"),
    subject: optionalText("subject"),
    dataType: optionalText("dataType"),
    timeRange: optionalText("timeRange"),
    persistedFilePath: optionalText("persistedFilePath"),
    summary: result.summary,
    toolArgs: result.toolArgs,
    toolResult: optionalText("toolResult"),
  };
}

export async function fetchProvenanceData(sessionKey: string, provenanceId: string): Promise<ProvenanceData> {
  const result = await gateway.request<unknown>("fin-core.provenance.fetchData", requestParams(sessionKey, provenanceId));
  if (!isRecord(result)) throw new Error("后端未返回可读取的来源数据。");
  if (result.records === null && typeof result.raw === "string") return { records: null, raw: result.raw, totalRows: 0 };
  if (!Array.isArray(result.records)) throw new Error("来源数据记录格式不正确。");
  return {
    records: result.records,
    totalRows: typeof result.totalRows === "number" && Number.isFinite(result.totalRows) && result.totalRows >= 0 ? result.totalRows : result.records.length,
    filename: typeof result.filename === "string" ? result.filename : undefined,
  };
}
