import { Type, type Static } from "@sinclair/typebox";
import { stringEnum, type AgentToolApi, type AgentToolContext } from "../runtime/plugin-api.js";
import {
  buildMarketPulseDigest,
  formatMarketPulseContext,
  formatXArticleMarkdown,
} from "./artifacts.js";
import { filterResearchPosts } from "./filter.js";
import { syncXResearchSignals } from "./pipeline.js";
import { deriveResearchSignal } from "./signals.js";
import type { ResearchSignal, XPostRecord, XPostProvider, XSource } from "./types.js";

const MARKET_PULSE_ACTIONS = ["sync", "read_article", "context", "digest", "status"] as const;

const MarketPulseSchema = Type.Object({
  action: stringEnum(MARKET_PULSE_ACTIONS, {
    description:
      "sync=同步来源时间线；read_article=按链接或 post ID 读取一篇 X Article；context=返回当前投研上下文；digest=生成三日摘要；status=查看状态",
  }),
  post_url_or_id: Type.Optional(
    Type.String({ description: "read_article 使用的 X 帖子链接或数字 post ID" }),
  ),
  directory_path: Type.Optional(
    Type.String({ description: "当前投研工作区内的情报目录，默认 AI产业链/_market-pulse" }),
  ),
  max_posts_per_source: Type.Optional(
    Type.Number({ description: "sync 每个账号最多读取的帖子数，范围 5-100，默认 5" }),
  ),
  lookback_days: Type.Optional(Type.Number({ description: "摘要回溯天数，默认 3" })),
});
type MarketPulseInput = Static<typeof MarketPulseSchema>;

interface StoredXState {
  version: 1;
  updatedAt: string;
  hasSync?: boolean;
  posts: XPostRecord[];
  signals: ResearchSignal[];
}

export interface MarketPulseWorkspace {
  readFile(agentId: string, path: string): Promise<{ content: string }>;
  writeFile(agentId: string, path: string, content: string, mode: "overwrite"): Promise<unknown>;
}

export interface MarketPulseDeps {
  provider: XPostProvider;
  sources: readonly XSource[];
  workspace: MarketPulseWorkspace;
  workspaceDirectory?: string;
  maxPostsPerSource?: number;
  now?: () => Date;
}

function toolResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function statePath(directory: string): string {
  return `${directory}/.state/signals.json`;
}

function postsPath(directory: string): string {
  return `${directory}/.state/posts.json`;
}

function latestPath(directory: string): string {
  return `${directory}/latest.md`;
}

function articlePath(directory: string, postId: string): string {
  const safePostId = postId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${directory}/articles/${safePostId}.md`;
}

function digestPath(directory: string, date: Date, days: number): string {
  const end = date.toISOString().slice(0, 10);
  const start = new Date(date.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return `${directory}/digests/${start}_to_${end}.md`;
}

function parseXPostId(value: string | undefined): string | undefined {
  const input = value?.trim();
  if (!input) return undefined;
  if (/^\d+$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (!/^(?:www\.)?(?:x|twitter)\.com$/i.test(url.hostname)) return undefined;
    return url.pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1];
  } catch {
    return undefined;
  }
}

async function readOptional(
  service: MarketPulseWorkspace,
  agentId: string,
  filePath: string,
): Promise<string | undefined> {
  try {
    return (await service.readFile(agentId, filePath)).content;
  } catch {
    return undefined;
  }
}

function emptyState(now: string): StoredXState {
  return { version: 1, updatedAt: now, hasSync: false, posts: [], signals: [] };
}

async function loadState(
  service: MarketPulseWorkspace,
  agentId: string,
  directory: string,
  now: string,
): Promise<StoredXState> {
  const raw = await readOptional(service, agentId, statePath(directory));
  if (!raw) return emptyState(now);
  try {
    const parsed = JSON.parse(raw) as Partial<StoredXState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.posts) || !Array.isArray(parsed.signals)) {
      return emptyState(now);
    }
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : now,
      hasSync:
        typeof parsed.hasSync === "boolean"
          ? parsed.hasSync
          : parsed.posts.length > 0 || parsed.signals.length > 0,
      posts: parsed.posts as XPostRecord[],
      signals: parsed.signals as ResearchSignal[],
    };
  } catch {
    return emptyState(now);
  }
}

function mergeState(
  existing: StoredXState,
  posts: XPostRecord[],
  signals: ResearchSignal[],
  now: string,
): StoredXState {
  const postMap = new Map(existing.posts.map((post) => [post.postId, post]));
  for (const post of posts) postMap.set(post.postId, post);
  const signalMap = new Map(existing.signals.map((signal) => [signal.signalId, signal]));
  for (const signal of signals) signalMap.set(signal.signalId, signal);
  return {
    version: 1,
    updatedAt: now,
    hasSync: true,
    posts: [...postMap.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-500),
    signals: [...signalMap.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-500),
  };
}

async function writeState(
  service: MarketPulseWorkspace,
  agentId: string,
  directory: string,
  state: StoredXState,
): Promise<void> {
  await service.writeFile(
    agentId,
    statePath(directory),
    JSON.stringify(state, null, 2),
    "overwrite",
  );
  await service.writeFile(
    agentId,
    postsPath(directory),
    JSON.stringify(state.posts, null, 2),
    "overwrite",
  );
  await service.writeFile(
    agentId,
    latestPath(directory),
    formatMarketPulseContext(state.signals),
    "overwrite",
  );
}

async function writeArticles(
  service: MarketPulseWorkspace,
  agentId: string,
  directory: string,
  posts: readonly XPostRecord[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const post of posts) {
    if (!post.article) continue;
    const path = articlePath(directory, post.postId);
    await service.writeFile(agentId, path, formatXArticleMarkdown(post), "overwrite");
    paths.push(path);
  }
  return paths;
}

function attachArticlePaths(
  signals: readonly ResearchSignal[],
  posts: readonly XPostRecord[],
  directory: string,
): ResearchSignal[] {
  const paths = new Map(
    posts
      .filter((post) => post.article)
      .map((post) => [post.postId, articlePath(directory, post.postId)]),
  );
  return signals.map((signal) => {
    if (!signal.article) return signal;
    const sourcePostId = signal.sourcePostIds.find((postId) => paths.has(postId));
    if (!sourcePostId) return signal;
    return {
      ...signal,
      article: { ...signal.article, workspacePath: paths.get(sourcePostId) },
    };
  });
}

export function createMarketPulseTool(api: AgentToolApi, deps: MarketPulseDeps) {
  return (ctx: AgentToolContext) => {
    const agentId = ctx.agentId || "main";
    const now = deps.now ?? (() => new Date());
    const defaultDirectory = deps.workspaceDirectory ?? "AI产业链/_market-pulse";

    return {
      name: "market_pulse",
      label: "金融市场脉搏",
      description:
        "面向投研任务的金融情报上下文工具。持续读取已配置的信息源，过滤无关社交内容，返回与当前工作区标的、产业链和研究问题相关的结构化信号。" +
        "它不是 X 贴文搜索工具：优先使用 context 获取研究上下文，使用 digest 生成三日工作区摘要，使用 sync 刷新本地信号；遇到明确的 X Article 链接时，使用 read_article 保存全文，再通过工作区适配器读取返回的 article_path。" +
        "X 内容是待核验的外部观点，不能替代财报、公告或原始数据；后台结果不得直接覆盖 THESIS.md 或 EVIDENCE.md。",
      parameters: MarketPulseSchema,
      async execute(_toolCallId: string, input: MarketPulseInput) {
        const directory = input.directory_path?.trim() || defaultDirectory;
        const timestamp = now();
        const timestampIso = timestamp.toISOString();

        try {
          if (input.action === "status") {
            const state = await loadState(deps.workspace, agentId, directory, timestampIso);
            return toolResult({
              status: "ready",
              provider: deps.provider.constructor.name,
              source_handles: deps.sources.map((source) => `@${source.handle}`),
              last_sync: state.hasSync ? state.updatedAt : null,
              signal_count: state.signals.length,
            });
          }

          let state = await loadState(deps.workspace, agentId, directory, timestampIso);
          if (input.action === "read_article") {
            const postId = parseXPostId(input.post_url_or_id);
            if (!postId)
              throw new Error("read_article requires a valid X post URL or numeric post ID");
            if (!deps.provider.getPost) {
              throw new Error("The configured X provider does not support direct post reads");
            }
            const post = await deps.provider.getPost(postId, deps.sources);
            if (!post) {
              throw new Error("X post was not found or its author is not a configured source");
            }
            if (!post.article) throw new Error("The requested X post does not contain an Article");
            const accepted = filterResearchPosts([post], deps.sources);
            if (accepted.length === 0) {
              throw new Error("The requested X Article did not pass the financial research filter");
            }
            const articleFiles = await writeArticles(deps.workspace, agentId, directory, accepted);
            const articleFile = articleFiles[0];
            if (!articleFile) throw new Error("X Article workspace file was not written");
            const signals = attachArticlePaths(
              accepted.map(deriveResearchSignal),
              accepted,
              directory,
            );
            state = mergeState(state, accepted, signals, timestampIso);
            await writeState(deps.workspace, agentId, directory, state);
            return toolResult({
              status: "article_saved",
              article_title: post.article.title,
              article_character_count: post.article.plainText.length,
              article_path: articleFile,
              full_text_available: true,
              next_step: {
                action: "read_workspace_file",
                path: articleFile,
                purpose: "读取完整 X Article 正文后继续投研分析",
              },
              source_url: post.url,
              latest_path: latestPath(directory),
            });
          }

          if (input.action === "sync" || (input.action === "context" && state.posts.length === 0)) {
            const maxPostsPerSource = Math.max(
              5,
              Math.min(input.max_posts_per_source ?? deps.maxPostsPerSource ?? 5, 100),
            );
            const result = await syncXResearchSignals({
              provider: deps.provider,
              sources: deps.sources,
              limit: maxPostsPerSource,
              now: timestamp,
            });
            const articleFiles = await writeArticles(
              deps.workspace,
              agentId,
              directory,
              result.posts,
            );
            const signals = attachArticlePaths(result.signals, result.posts, directory);
            state = mergeState(state, result.posts, signals, result.collectedAt);
            await writeState(deps.workspace, agentId, directory, state);
            if (input.action === "sync") {
              return toolResult({
                status: "synced",
                provider: deps.provider.constructor.name,
                max_posts_per_source: maxPostsPerSource,
                fetched_count: result.fetchedCount,
                accepted_count: result.acceptedCount,
                discarded_count: result.discardedCount,
                article_count: result.articleCount,
                signal_count: signals.length,
                article_files: articleFiles,
                latest_path: latestPath(directory),
                state_path: statePath(directory),
              });
            }
          }

          if (input.action === "context") {
            return toolResult({
              status: "ready",
              directory_path: directory,
              signal_count: state.signals.length,
              context: formatMarketPulseContext(state.signals),
            });
          }

          const days = Math.max(1, Math.min(input.lookback_days ?? 3, 30));
          const from = new Date(timestamp.getTime() - days * 86_400_000).toISOString();
          const path = digestPath(directory, timestamp, days);
          const digest = buildMarketPulseDigest(state.signals, { from, to: timestampIso });
          await deps.workspace.writeFile(agentId, path, digest, "overwrite");
          return toolResult({
            status: "digest_written",
            path,
            signal_count: state.signals.filter(
              (signal) => signal.createdAt >= from && signal.createdAt <= timestampIso,
            ).length,
            requires_user_confirmation: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          api.logger.warn?.(`[market_pulse] ${message}`);
          return toolResult({ error: message });
        }
      },
    };
  };
}
