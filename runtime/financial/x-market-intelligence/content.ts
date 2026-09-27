import type { XPostRecord } from "./types.js";

export function getXPostResearchText(post: XPostRecord): string {
  return [post.article?.title, post.article?.previewText, post.article?.plainText, post.text]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n\n");
}
