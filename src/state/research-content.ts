// Display/skill compatibility adapted from ANLYST fin-core-react/lib/utils.ts (MIT).
import type { Source } from "../types";
export function displayUserText(content: string) {
  const cron = content.match(/^\[cron:[^\s\]]+\s+([^\]]+)\]/);
  if (cron?.[1]) return cron[1].trim();
  return content
    .replace(/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\]\s*/, "")
    .replace(/<!-- FINCLAW_SELECTED_SKILL:.*?-->\s*|<!-- FINCLAW_SELECTED_SKILL:[^\n]*\n?/, "")
    .replace(/\[指定技能：[^\]]*\]?\s*/, "")
    .replace(/\n?<!-- CHAT_IMAGES:[^ ]+ -->/g, "")
    .replace(/\n?\[系统提示：[^\]]*\]/g, "")
    .replace(
      /(?:\n---\n| --- | ---\n| ---)\s*📎?\s*\*\*附件信息\s*\*\*：[\s\S]*$|\n\*\*附件信息\s*\*\*：[\s\S]*$/,
      "",
    )
    .replace(/\n\n<research_file name=[\s\S]*$/, "")
    .trim();
}
export function withResearchMode(text: string, mode: string) {
  if (mode !== "深度研究" || text.includes("<!-- FINCLAW_SELECTED_SKILL:")) return text;
  return `<!-- FINCLAW_SELECTED_SKILL:deep-research -->\n[指定技能：deep-research，你必须使用此技能完成任务，matched_skill 必须设为 deep-research]\n\n${text}`;
}
export function sourcesFromText(text: string): Source[] {
  const sources = new Map<string, Source>();
  for (const [, title, url] of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) {
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) continue;
      sources.set(url, { id: url, title, publisher: parsed.hostname, url, kind: "web" });
    } catch {
      /* Unusable references do not become clickable sources. */
    }
  }
  return [...sources.values()];
}
