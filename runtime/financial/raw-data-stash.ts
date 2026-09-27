export interface StashedToolData {
  records: Record<string, unknown>[];
  meta?: Record<string, unknown>;
}

const toolData = new Map<string, StashedToolData>();

export function stashRawRecords(
  callId: string,
  records: Record<string, unknown>[],
  meta?: Record<string, unknown>,
): void {
  toolData.set(callId, { records, meta });
}

/** Reads and removes one result so call IDs cannot retain data indefinitely. */
export function popRawRecords(callId: string): StashedToolData | undefined {
  const result = toolData.get(callId);
  toolData.delete(callId);
  return result;
}
