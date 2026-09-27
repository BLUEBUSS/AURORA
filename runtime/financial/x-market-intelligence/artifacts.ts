import type { ResearchSignal, XPostRecord } from "./types.js";

const EVIDENCE_CAVEAT =
  "X 内容属于外部观点信号，不能替代财报、公告或原始数据；长期研究结论仍需用户确认。";

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 32))}\n\n[上下文已截断，请按来源链接获取完整内容]`;
}

function formatSignal(signal: ResearchSignal): string {
  const assets = signal.relatedAssets.length > 0 ? signal.relatedAssets.join(", ") : "未映射标的";
  const nodes =
    signal.industryChainNodes.length > 0 ? signal.industryChainNodes.join(", ") : "未映射产业链";
  const catalysts = signal.catalysts.length > 0 ? signal.catalysts.join(", ") : "无明确催化剂";
  const risks = signal.risks.length > 0 ? signal.risks.join(", ") : "未提及风险";
  const lines = [
    `- **${assets}** | ${signal.stance} | ${signal.sourceRole} @${signal.sourceHandle}`,
    `  - 产业链：${nodes}`,
    `  - 观点：${signal.claim}`,
    `  - 周期：${signal.timeHorizon}；催化剂：${catalysts}；风险：${risks}`,
    `  - 证据等级：${signal.evidenceLevel}；置信度：${signal.confidence.toFixed(2)}；来源：${signal.sourceUrl}`,
  ];
  if (signal.article) {
    lines.push(
      `  - X Article：${signal.article.title}（正文 ${signal.article.characterCount.toLocaleString("en-US")} 字符）`,
    );
    if (signal.article.workspacePath) {
      lines.push(`  - 全文工作区路径：${signal.article.workspacePath}`);
    }
  }
  return lines.join("\n");
}

export function formatXArticleMarkdown(post: XPostRecord): string {
  if (!post.article) throw new Error(`X post ${post.postId} does not contain an Article`);
  return [
    `# ${post.article.title}`,
    "",
    `- 作者：${post.displayName} (@${post.handle})`,
    `- 发布时间：${post.createdAt}`,
    `- 采集时间：${post.collectedAt}`,
    `- 原文：${post.url}`,
    `- 正文字符数：${post.article.plainText.length.toLocaleString("en-US")}`,
    "",
    "## 预览",
    "",
    post.article.previewText ?? "无预览文本。",
    "",
    "## 完整正文",
    "",
    post.article.plainText,
    "",
    "## 使用边界",
    "",
    `> ${EVIDENCE_CAVEAT}`,
  ].join("\n");
}

export function formatMarketPulseContext(
  signals: readonly ResearchSignal[],
  maxChars = 8_000,
): string {
  const ordered = [...signals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const body = ordered.length > 0 ? ordered.map(formatSignal).join("\n") : "暂无新的金融相关信号。";
  return truncate(
    [
      "# X 金融情报上下文",
      "",
      `信号数量：${ordered.length}`,
      "",
      body,
      "",
      `> ${EVIDENCE_CAVEAT}`,
    ].join("\n"),
    maxChars,
  );
}

export function buildMarketPulseDigest(
  signals: readonly ResearchSignal[],
  range: { from: string; to: string },
): string {
  const inRange = signals.filter(
    (signal) => signal.createdAt >= range.from && signal.createdAt <= range.to,
  );
  const sections =
    inRange.length > 0 ? inRange.map(formatSignal).join("\n\n") : "本周期没有新的金融相关信号。";
  return [
    "# X 金融情报三日摘要",
    "",
    `时间范围：${range.from} 至 ${range.to}`,
    `信号数量：${inRange.length}`,
    "",
    "## 研究信号",
    "",
    sections,
    "",
    "## 使用边界",
    "",
    `- 所有观点和市场评论均标记为待核验。`,
    `- ${EVIDENCE_CAVEAT}`,
  ].join("\n");
}
