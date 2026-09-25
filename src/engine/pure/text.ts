// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * Generate a deterministic UUID from a seed string using simple hashing.
 * This provides stable IDs across page refreshes without requiring uuid v5.
 * Uses a simple string hash algorithm for synchronous operation.
 * @param seed - The seed string to generate UUID from
 */
export function generateDeterministicUUID(seed: string): string {
  // Simple DJB2 hash algorithm for deterministic hash
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33) ^ seed.charCodeAt(i);
  }

  // Convert to positive integer
  const hashValue = hash >>> 0;

  // Generate UUID-like string from hash
  const hex = hashValue.toString(16).padStart(8, "0");
  const hex2 = ((hashValue * 31) >>> 0).toString(16).padStart(8, "0");
  const hex3 = ((hashValue * 37) >>> 0).toString(16).padStart(8, "0");
  const hex4 = ((hashValue * 41) >>> 0).toString(16).padStart(8, "0");

  return `${hex.slice(0, 8)}-${hex2.slice(0, 4)}-4${hex2.slice(4, 7)}-${hex3.slice(0, 4)}-${hex4.slice(0, 12).padEnd(12, "0")}`;
}


// ── Narration Sanitize ────────────────────────────────────────────────────

/**
 * 剥离推理标签（reasoning tags）。
 *
 * 部分模型 / provider 在流式 text content 里会泄漏推理标签字面字符串，例如开头出现孤立的
 * `</think>`，或整段 `<thinking>...</thinking>`。这些既不应在 thinking slot 也不应在
 * narration 显示，统一去除。
 *
 * 处理策略（不严格配对，宽松剥离，与后端 stripReasoningTagsFromText 等价子集）：
 *   1. 成对剥离 `<tag>...</tag>` 含内容（tag ∈ think / thinking / thought / antthinking）
 *   2. 孤立闭合 / 开放 tag 字面字符串再剥一次
 *
 * 注意：不保护 markdown 代码块——narration 文本不应承载文档/教程类内容；如未来有需要再做精确化。
 */
export function stripReasoningTags(text: string): string {
  if (!text) return text;
  if (!/<\s*\/?\s*(?:think(?:ing)?|thought|antthinking)\b/i.test(text)) {
    return text;
  }
  let cleaned = text.replace(
    /<\s*(think(?:ing)?|thought|antthinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    "",
  );
  cleaned = cleaned.replace(/<\s*\/?\s*(?:think(?:ing)?|thought|antthinking)\b[^>]*>/gi, "");
  return cleaned;
}


/**
 * 通用的 narration 文本清洗：
 *   - 剥离 provenance token（[[p_xxxx]] / [[搜索结果]]）—— narration 不展示溯源 UI
 *   - 剥离推理标签字面字符串
 *   - 折叠多余空白
 */
export function sanitizeNarrationCommon(text: string): string {
  return stripReasoningTags(text)
    .replace(/\[\[p_[a-z0-9_-]+\]\]/gi, "")
    .replace(/\[\[搜索结果\]\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
