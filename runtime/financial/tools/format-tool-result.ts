export interface CoreFieldConfig {
  key: string;
  label: string;
  format?: "currency" | "percent" | "raw";
}

function compactValue(value: unknown, format?: CoreFieldConfig["format"]): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (format === "percent") return `${numeric}%`;
  if (format === "currency") return new Intl.NumberFormat("en-US").format(numeric);
  return String(value);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Compact, deterministic text output suitable for an LLM tool result. */
export function formatToolResult(
  meta: Record<string, unknown>,
  records: Record<string, unknown>[],
  coreFields?: CoreFieldConfig[],
  fieldLabels?: Record<string, string>,
): string {
  const lines = Object.entries(meta)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
    .map(([key, value]) => `${key}: ${String(value)}`);

  if (records.length === 0) return [...lines, "(no data)"].join("\n");

  const availableKeys = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const configured = coreFields?.filter((field) => availableKeys.includes(field.key)) ?? [];
  const fields: CoreFieldConfig[] =
    configured.length > 0
      ? configured
      : availableKeys.map((key) => ({ key, label: fieldLabels?.[key] ?? key }));

  if (records.length === 1) {
    for (const field of fields) {
      lines.push(`${field.label}: ${compactValue(records[0][field.key], field.format)}`);
    }
    return lines.join("\n");
  }

  lines.push(`| ${fields.map((field) => escapeCell(field.label)).join(" | ")} |`);
  lines.push(`| ${fields.map(() => "---").join(" | ")} |`);
  for (const record of records) {
    lines.push(
      `| ${fields
        .map((field) => escapeCell(compactValue(record[field.key], field.format)))
        .join(" | ")} |`,
    );
  }
  return lines.join("\n");
}
