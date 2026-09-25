/** Citation syntax retained from ANLYST fin-core-react (MIT, see ../../engine/LICENSE). */
export interface CitationReference {
  provenanceId: string;
  index: number;
  fields: string[];
}

const prefix = "#aurora-citation?";
const placeholders = new Set(["p_abcd", "p_dcba", "p_1234", "p_4321"]);
const markerPattern = /^\[\[(p_[0-9a-f]{4})(?::([^\]\n]+))?\]\]$/;

export function isProvenanceId(value: string): boolean {
  return /^p_[0-9a-f]{4}$/.test(value) && !placeholders.has(value);
}

function fieldsFromText(value: string) {
  return Array.from(new Set(value.split(/[,，、]/).map((field) => field.trim()).filter(Boolean)));
}

export function citationUrl(reference: CitationReference): string {
  const params = new URLSearchParams({ pid: reference.provenanceId, index: String(reference.index) });
  if (reference.fields.length) params.set("fields", reference.fields.join(","));
  return `${prefix}${params.toString()}`;
}

export function parseCitationUrl(href: string | undefined): CitationReference | null {
  if (!href?.startsWith(prefix)) return null;
  const params = new URLSearchParams(href.slice(prefix.length));
  if ([...params.keys()].some((key) => !["pid", "index", "fields"].includes(key))) return null;
  if (["pid", "index", "fields"].some((key) => params.getAll(key).length > 1)) return null;
  const provenanceId = params.get("pid") || "";
  const index = params.get("index") || "";
  const fields = params.get("fields") || "";
  if (!isProvenanceId(provenanceId) || !/^[1-9]\d{0,5}$/.test(index) || fields.length > 2048) return null;
  return { provenanceId, index: Number(index), fields: fieldsFromText(fields) };
}

/** Only explicit HTTP(S) sources become navigable links. */
export function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  })) return undefined;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function closingBracket(text: string, start: number, open: string, close: string) {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    if (text[index] === "\\") { index++; continue; }
    if (text[index] === open) depth++;
    if (text[index] === close && --depth === 0) return index;
  }
  return -1;
}

function inlineCodeEnd(text: string, fence: string, start: number) {
  let end = text.indexOf(fence, start);
  while (end >= 0 && (text[end - 1] === "`" || text[end + fence.length] === "`")) end = text.indexOf(fence, end + fence.length);
  return end;
}

function transformInline(text: string, indices: Map<string, number>, inline: { fence: string | null }) {
  let result = "";
  for (let cursor = 0; cursor < text.length;) {
    if (inline.fence) {
      const end = inlineCodeEnd(text, inline.fence, cursor);
      if (end < 0) return result + text.slice(cursor);
      const next = end + inline.fence.length;
      result += text.slice(cursor, next); cursor = next; inline.fence = null; continue;
    }
    if (text[cursor] === "\\") {
      result += text.slice(cursor, cursor + 2); cursor += 2; continue;
    }
    if (text[cursor] === "`") {
      const fence = text.slice(cursor).match(/^`+/)![0];
      const end = inlineCodeEnd(text, fence, cursor + fence.length);
      const next = end < 0 ? text.length : end + fence.length;
      if (end < 0) inline.fence = fence;
      result += text.slice(cursor, next); cursor = next; continue;
    }
    // Existing Markdown links/images remain intact; never nest a reference button in a link.
    if (text[cursor] === "[" && text[cursor + 1] !== "[") {
      const endLabel = closingBracket(text, cursor, "[", "]");
      const next = text[endLabel + 1];
      if (endLabel >= 0 && (next === "(" || next === "[")) {
        const endLink = closingBracket(text, endLabel + 1, next, next === "(" ? ")" : "]");
        if (endLink >= 0) { result += text.slice(cursor, endLink + 1); cursor = endLink + 1; continue; }
      }
    }
    if (text.startsWith("[[", cursor)) {
      const end = text.indexOf("]]", cursor + 2);
      if (end >= 0) {
        const token = text.slice(cursor, end + 2);
        const match = markerPattern.exec(token);
        if (match && isProvenanceId(match[1])) {
          const provenanceId = match[1];
          const index = indices.get(provenanceId) ?? indices.size + 1;
          indices.set(provenanceId, index);
          result += `[${index}](${citationUrl({ provenanceId, index, fields: fieldsFromText(match[2] || "") })})`;
          cursor = end + 2; continue;
        }
        // Match the source's short-placeholder cleanup without touching code spans.
        if (/^\[\[[^\]\n]{1,40}\]\]$/.test(token)) { cursor = end + 2; continue; }
      }
    }
    result += text[cursor++];
  }
  return result;
}

/** Session identity is supplied to the reference component, never embedded in Markdown URLs. */
export function transformCitationMarkdown(text: string): string {
  if (!text.includes("[[")) return text;
  const indices = new Map<string, number>();
  const inline: { fence: string | null } = { fence: null };
  let fence: { character: string; length: number } | null = null;
  return text.split(/(\r?\n)/).map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return line;
    }
    if (marker && !inline.fence) { fence = { character: marker[1][0], length: marker[1].length }; return line; }
    if (/^(?: {4}|\t)/.test(line) && !inline.fence) return line;
    return transformInline(line, indices, inline);
  }).join("");
}
