import { filterResearchPosts } from "./filter.js";
import { deriveResearchSignal } from "./signals.js";
import type { XPostProvider, XSource, XSyncResult } from "./types.js";

export async function syncXResearchSignals(options: {
  provider: XPostProvider;
  sources: readonly XSource[];
  since?: Date;
  limit?: number;
  now?: Date;
}): Promise<XSyncResult> {
  const posts = await options.provider.listRecentPosts({
    sources: options.sources,
    since: options.since,
    limit: options.limit,
  });
  const filteredPosts = filterResearchPosts(posts, options.sources);

  return {
    collectedAt: (options.now ?? new Date()).toISOString(),
    fetchedCount: posts.length,
    acceptedCount: filteredPosts.length,
    discardedCount: posts.length - filteredPosts.length,
    articleCount: filteredPosts.filter((post) => post.article).length,
    posts: filteredPosts,
    signals: filteredPosts.map(deriveResearchSignal),
  };
}
