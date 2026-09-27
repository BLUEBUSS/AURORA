import { findXSource, normalizeXHandle } from "./sources.js";
import type { XPostProvider, XPostRecord, XSource } from "./types.js";

const DEFAULT_X_API_BASE_URL = "https://api.x.com";
const X_TWEET_FIELDS =
  "article,article_title,author_id,created_at,conversation_id,public_metrics,referenced_tweets";

const FIXTURE_POSTS: readonly XPostRecord[] = [
  {
    postId: "fixture-elon-1",
    authorId: "fixture-elon",
    handle: "elonmusk",
    displayName: "Elon Musk",
    sourceRole: "executive",
    createdAt: "2026-08-16T08:00:00.000Z",
    collectedAt: "2026-08-16T08:01:00.000Z",
    text: "AI inference demand is accelerating across data centers and GPU infrastructure.",
    url: "https://x.com/elonmusk/status/fixture-elon-1",
    isReply: false,
    isQuote: false,
    isRepost: false,
  },
  {
    postId: "fixture-kol-1",
    authorId: "fixture-kol",
    handle: "xiaomustock",
    displayName: "川沐",
    sourceRole: "analyst_kol",
    createdAt: "2026-08-15T08:00:00.000Z",
    collectedAt: "2026-08-15T08:01:00.000Z",
    text: "AI semiconductor supply remains tight; HBM and GPU demand are the key variables.",
    url: "https://x.com/xiaomustock/status/fixture-kol-1",
    isReply: false,
    isQuote: false,
    isRepost: false,
  },
  {
    postId: "fixture-jensen-1",
    authorId: "fixture-jensen",
    handle: "jensenhuang",
    displayName: "Jensen Huang",
    sourceRole: "executive",
    createdAt: "2026-08-14T08:00:00.000Z",
    collectedAt: "2026-08-14T08:01:00.000Z",
    text: "Blackwell demand remains strong as inference workloads scale across data centers.",
    url: "https://x.com/JensenHuang/status/fixture-jensen-1",
    isReply: false,
    isQuote: false,
    isRepost: false,
  },
  {
    postId: "fixture-noise-1",
    authorId: "fixture-elon",
    handle: "elonmusk",
    displayName: "Elon Musk",
    sourceRole: "executive",
    createdAt: "2026-08-16T07:00:00.000Z",
    collectedAt: "2026-08-16T07:01:00.000Z",
    text: "I enjoyed a quiet walk today.",
    url: "https://x.com/elonmusk/status/fixture-noise-1",
    isReply: false,
    isQuote: false,
    isRepost: false,
  },
];

export class FixtureXPostProvider implements XPostProvider {
  constructor(private readonly posts: readonly XPostRecord[] = FIXTURE_POSTS) {}

  async listRecentPosts(
    options: {
      sources?: readonly XSource[];
      since?: Date;
      limit?: number;
    } = {},
  ): Promise<XPostRecord[]> {
    const sourceHandles = options.sources
      ? new Set(options.sources.map((source) => normalizeXHandle(source.handle)))
      : undefined;
    const since = options.since?.getTime();
    return this.posts
      .filter((post) => !sourceHandles || sourceHandles.has(normalizeXHandle(post.handle)))
      .filter((post) => since === undefined || new Date(post.createdAt).getTime() >= since)
      .slice(0, options.limit ?? this.posts.length)
      .map((post) => ({ ...post, collectedAt: new Date().toISOString() }));
  }

  async getPost(postId: string, sources: readonly XSource[]): Promise<XPostRecord | undefined> {
    const post = this.posts.find((candidate) => candidate.postId === postId);
    if (!post || !findXSource(post.handle, sources)) return undefined;
    return post ? { ...post, collectedAt: new Date().toISOString() } : undefined;
  }
}

export interface XApiPostProviderOptions {
  bearerToken: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface XApiUserResponse {
  data?: { id?: string; name?: string; username?: string };
}

interface XApiTweet {
  id?: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  conversation_id?: string;
  article?: {
    title?: string;
    preview_text?: string;
    plain_text?: string;
  };
  article_title?: string | { title?: string };
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    impression_count?: number;
  };
  referenced_tweets?: Array<{ type?: string; id?: string }>;
}

interface XApiTweetsResponse {
  data?: XApiTweet[];
  includes?: { users?: Array<{ id?: string; name?: string; username?: string }> };
}

interface XApiTweetResponse {
  data?: XApiTweet;
  includes?: XApiTweetsResponse["includes"];
}

export class XApiPostProvider implements XPostProvider {
  private readonly bearerToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userIds = new Map<string, string>();

  constructor(options: XApiPostProviderOptions) {
    this.bearerToken = options.bearerToken.trim();
    if (!this.bearerToken) throw new Error("X API bearer token is required");
    this.baseUrl = (options.apiBaseUrl ?? DEFAULT_X_API_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listRecentPosts(
    options: {
      sources?: readonly XSource[];
      since?: Date;
      limit?: number;
    } = {},
  ): Promise<XPostRecord[]> {
    const sources = options.sources ?? [];
    const posts: XPostRecord[] = [];
    for (const source of sources) {
      const userId = await this.resolveUserId(source.handle);
      const url = new URL(`${this.baseUrl}/2/users/${userId}/tweets`);
      url.searchParams.set("exclude", "replies,retweets");
      url.searchParams.set("tweet.fields", X_TWEET_FIELDS);
      // X timeline API accepts 5-100; clamp caller limits to keep live requests valid.
      url.searchParams.set("max_results", String(Math.max(5, Math.min(options.limit ?? 5, 100))));
      if (options.since) url.searchParams.set("start_time", options.since.toISOString());

      const payload = await this.request<XApiTweetsResponse>(url);
      const includes = new Map(
        (payload.includes?.users ?? [])
          .filter((user) => user.id)
          .map((user) => [user.id as string, user]),
      );
      const sourcePosts = (payload.data ?? [])
        .map((tweet) => this.mapTweet(tweet, source, includes))
        .filter((post): post is XPostRecord => post !== undefined);
      posts.push(...sourcePosts);
    }
    return posts;
  }

  async getPost(postId: string, sources: readonly XSource[]): Promise<XPostRecord | undefined> {
    const url = new URL(`${this.baseUrl}/2/tweets/${encodeURIComponent(postId)}`);
    url.searchParams.set("tweet.fields", X_TWEET_FIELDS);
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "id,name,username");
    const payload = await this.request<XApiTweetResponse>(url);
    if (!payload.data) return undefined;
    const includes = new Map(
      (payload.includes?.users ?? [])
        .filter((user) => user.id)
        .map((user) => [user.id as string, user]),
    );
    const author = payload.data.author_id ? includes.get(payload.data.author_id) : undefined;
    const source = findXSource(author?.username ?? "", sources);
    if (!source) return undefined;
    return this.mapTweet(payload.data, source, includes);
  }

  private async resolveUserId(handle: string): Promise<string> {
    const normalized = normalizeXHandle(handle);
    const cached = this.userIds.get(normalized);
    if (cached) return cached;

    const url = new URL(`${this.baseUrl}/2/users/by/username/${encodeURIComponent(normalized)}`);
    url.searchParams.set("user.fields", "id,name,username");
    const payload = await this.request<XApiUserResponse>(url);
    const id = payload.data?.id;
    if (!id) throw new Error(`X API returned no user id for @${normalized}`);
    this.userIds.set(normalized, id);
    return id;
  }

  private async request<T>(url: URL): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.bearerToken}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`X API request failed (${response.status}): ${body.slice(0, 240)}`);
    }
    return (await response.json()) as T;
  }

  private mapTweet(
    tweet: XApiTweet,
    source: XSource,
    includes: Map<string, { id?: string; name?: string; username?: string }>,
  ): XPostRecord | undefined {
    if (!tweet.id || !tweet.text || !tweet.created_at) return undefined;
    const references = tweet.referenced_tweets ?? [];
    const author = (tweet.author_id && includes.get(tweet.author_id)) || {};
    const handle = normalizeXHandle(author.username ?? source.handle);
    const articleTitle =
      tweet.article?.title ??
      (typeof tweet.article_title === "string" ? tweet.article_title : tweet.article_title?.title);
    const articlePlainText = tweet.article?.plain_text?.trim();
    const article =
      articleTitle?.trim() && articlePlainText
        ? {
            title: articleTitle.trim(),
            previewText: tweet.article?.preview_text?.trim() || undefined,
            plainText: articlePlainText,
          }
        : undefined;
    return {
      postId: tweet.id,
      authorId: tweet.author_id ?? "",
      handle,
      displayName: author.name ?? source.displayName,
      sourceRole: source.sourceRole,
      createdAt: tweet.created_at,
      collectedAt: new Date().toISOString(),
      text: tweet.text,
      article,
      url: `https://x.com/${handle}/status/${tweet.id}`,
      isReply: references.some((reference) => reference.type === "replied_to"),
      isQuote: references.some((reference) => reference.type === "quoted"),
      isRepost: references.some((reference) => reference.type === "retweeted"),
      conversationId: tweet.conversation_id,
      publicMetrics: {
        likeCount: tweet.public_metrics?.like_count,
        repostCount: tweet.public_metrics?.retweet_count,
        replyCount: tweet.public_metrics?.reply_count,
        viewCount: tweet.public_metrics?.impression_count,
      },
    };
  }
}

export function createXPostProvider(options: {
  provider?: "fixture" | "x-api";
  bearerToken?: string;
  apiBaseUrl?: string;
}): XPostProvider {
  if (options.provider === "x-api") {
    return new XApiPostProvider({
      bearerToken: options.bearerToken ?? "",
      apiBaseUrl: options.apiBaseUrl,
    });
  }
  return new FixtureXPostProvider();
}
