// Adapted from ANLYST fin-core-react/lib/strip-provenance-tool-header.ts.
// MIT; see ../../engine/LICENSE.
const tag = /\s*\[\[p_[0-9a-f]{4}(?::[^\]]+)?\]\]/g;
const currentHeader = /^\s*🔖[^]*?（来自[^）\n]+）\s*\r?\n?/;
const legacyHeader = /^\[\[p_[0-9a-f]{4}(?::[^\]]+)?\]\]\s*←\s*引用此数据请复制此标记（来自[^）]+）\s*\r?\n?/gm;

export function stripProvenanceFromToolResultText(text: string): string {
  return text.replace(currentHeader, "").replace(legacyHeader, "").replace(tag, "");
}
