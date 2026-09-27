export type XSourceRole =
  | "executive"
  | "official_company"
  | "policy_macro"
  | "analyst_kol"
  | "research_media"
  | "community";

export type EvidenceLevel =
  | "first_party_fact"
  | "official_statement"
  | "reported_information"
  | "expert_opinion"
  | "market_commentary"
  | "unverified_claim";

export type SignalStance = "bullish" | "bearish" | "neutral";
export type SignalKind = "claim" | "catalyst" | "risk" | "event";

export interface XSource {
  handle: string;
  displayName: string;
  profileUrl: string;
  sourceRole: XSourceRole;
  topicScope: readonly string[];
}

export interface XArticleContent {
  title: string;
  previewText?: string;
  plainText: string;
}

export interface XPostRecord {
  postId: string;
  authorId: string;
  handle: string;
  displayName: string;
  sourceRole: XSourceRole;
  createdAt: string;
  collectedAt: string;
  text: string;
  article?: XArticleContent;
  url: string;
  isReply: boolean;
  isQuote: boolean;
  isRepost: boolean;
  conversationId?: string;
  publicMetrics?: {
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    viewCount?: number;
  };
  deletedAt?: string;
}

export interface ResearchSignal {
  signalId: string;
  sourcePostIds: string[];
  sourceRole: XSourceRole;
  sourceHandle: string;
  sourceUrl: string;
  createdAt: string;
  claim: string;
  signalKind: SignalKind;
  relatedAssets: string[];
  industryChainNodes: string[];
  stance: SignalStance;
  timeHorizon: "near_term" | "medium_term" | "unspecified";
  catalysts: string[];
  risks: string[];
  verificationPoints: string[];
  evidenceLevel: EvidenceLevel;
  confidence: number;
  article?: {
    title: string;
    previewText?: string;
    characterCount: number;
    workspacePath?: string;
  };
}

export interface XPostProvider {
  listRecentPosts(options?: {
    sources?: readonly XSource[];
    since?: Date;
    limit?: number;
  }): Promise<XPostRecord[]>;
  getPost?(postId: string, sources: readonly XSource[]): Promise<XPostRecord | undefined>;
}

export interface XSyncResult {
  collectedAt: string;
  fetchedCount: number;
  acceptedCount: number;
  discardedCount: number;
  articleCount: number;
  posts: XPostRecord[];
  signals: ResearchSignal[];
}

export interface XMarketIntelligenceConfig {
  enabled?: boolean;
  provider?: "fixture" | "x-api";
  bearerToken?: string;
  apiBaseUrl?: string;
  sources?: XSource[];
  topicKeywords?: string[];
  workspaceDirectory?: string;
  digestIntervalDays?: number;
  pollIntervalMinutes?: number;
  /** 每个账号每次同步最多读取的帖子数；X API 合法范围为 5-100，默认 5。 */
  maxPostsPerSource?: number;
  /** 本地 owner-only 凭据文件路径；文件中只读取 Bearer Token。 */
  bearerTokenFile?: string;
}
