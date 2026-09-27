import { getXPostResearchText } from "./content.js";
import { findXSource, normalizeXHandle } from "./sources.js";
import type { XPostRecord, XSource } from "./types.js";

const RESEARCH_TERMS = [
  "ai",
  "artificial intelligence",
  "compute",
  "gpu",
  "inference",
  "data center",
  "chip",
  "semiconductor",
  "blackwell",
  "capex",
  "earnings",
  "revenue",
  "demand",
  "supply",
  "robot",
  "autonomous",
  "self-driving",
  "tesla",
  "spacex",
  "energy",
  "policy",
  "regulation",
  "export control",
  "tariff",
  "stock",
  "equity",
  "market impact",
];

function includesTerm(text: string, term: string): boolean {
  return text.toLowerCase().includes(term);
}

function isInTopicScope(post: XPostRecord, source: XSource): boolean {
  const text = getXPostResearchText(post).toLowerCase();
  return source.topicScope.some((topic) => text.includes(topic.toLowerCase()));
}

function hasResearchRelevance(post: XPostRecord, source: XSource): boolean {
  const researchText = getXPostResearchText(post);
  return (
    source.topicScope.length > 0 &&
    isInTopicScope(post, source) &&
    RESEARCH_TERMS.some((term) => includesTerm(researchText, term))
  );
}

export function filterResearchPosts(
  posts: readonly XPostRecord[],
  sources: readonly XSource[],
): XPostRecord[] {
  const accepted: XPostRecord[] = [];
  const seen = new Set<string>();

  for (const post of posts) {
    const source = findXSource(post.handle, sources);
    if (!source || seen.has(post.postId)) continue;
    if (post.isReply || post.isQuote || post.isRepost) continue;
    if (!post.text.trim() || !hasResearchRelevance(post, source)) continue;

    seen.add(post.postId);
    accepted.push({
      ...post,
      handle: normalizeXHandle(post.handle),
      sourceRole: source.sourceRole,
      displayName: source.displayName,
    });
  }

  return accepted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
