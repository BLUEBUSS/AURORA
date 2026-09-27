import { getXPostResearchText } from "./content.js";
import type { ResearchSignal, SignalStance, XPostRecord } from "./types.js";

const MAX_SIGNAL_CLAIM_CHARS = 600;

const ASSET_TERMS: Array<[string, string[]]> = [
  ["NVDA", ["nvidia", "nvda", "blackwell", "h100", "h200", "gpu"]],
  ["AMD", ["amd", "mi300"]],
  ["MU", ["micron", "mu", "hbm"]],
  ["TSM", ["tsmc", "taiwan semiconductor"]],
  ["TSLA", ["tesla", "tsla", "autonomous driving", "self-driving"]],
];

const INDUSTRY_TERMS: Array<[string, string[]]> = [
  ["GPU", ["gpu", "blackwell", "h100", "h200"]],
  ["data-center", ["data center", "datacenter", "cloud"]],
  ["inference", ["inference"]],
  ["semiconductor", ["chip", "semiconductor", "hbm"]],
  ["robotics", ["robot", "robotics"]],
  ["autonomy", ["autonomous", "self-driving"]],
  ["energy", ["energy", "power"]],
  ["policy", ["policy", "regulation", "export control", "tariff"]],
];

const BULLISH_TERMS = [
  "strong",
  "accelerat",
  "growth",
  "record",
  "expand",
  "scale",
  "surge",
  "上行",
  "强劲",
  "增长",
  "加速",
];

const BEARISH_TERMS = [
  "weak",
  "decline",
  "slow",
  "delay",
  "cut",
  "risk",
  "concern",
  "下行",
  "放缓",
  "延迟",
  "风险",
];

function containsAny(text: string, terms: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function collectMatches(text: string, dictionary: Array<[string, string[]]>): string[] {
  const lower = text.toLowerCase();
  return dictionary
    .filter(([, terms]) => terms.some((term) => lower.includes(term)))
    .map(([name]) => name);
}

function deriveStance(text: string): SignalStance {
  const bullish = containsAny(text, BULLISH_TERMS);
  const bearish = containsAny(text, BEARISH_TERMS);
  if (bullish && !bearish) return "bullish";
  if (bearish && !bullish) return "bearish";
  return "neutral";
}

function deriveCatalysts(text: string): string[] {
  const lower = text.toLowerCase();
  const catalysts: string[] = [];
  if (lower.includes("blackwell") && lower.includes("demand")) catalysts.push("Blackwell demand");
  if (lower.includes("inference") && lower.includes("demand")) catalysts.push("inference demand");
  if (lower.includes("capex")) catalysts.push("capital expenditure");
  if (lower.includes("earnings") || lower.includes("revenue")) catalysts.push("company results");
  return catalysts;
}

function deriveRisks(text: string): string[] {
  const lower = text.toLowerCase();
  const risks: string[] = [];
  if (lower.includes("risk") || lower.includes("concern")) risks.push("stated risk or concern");
  if (lower.includes("delay")) risks.push("delivery delay");
  if (lower.includes("regulation") || lower.includes("export control"))
    risks.push("policy constraint");
  return risks;
}

function deriveTimeHorizon(text: string): ResearchSignal["timeHorizon"] {
  const lower = text.toLowerCase();
  if (lower.includes("next quarter") || lower.includes("quarter")) return "medium_term";
  if (lower.includes("today") || lower.includes("this week") || lower.includes("near term")) {
    return "near_term";
  }
  return "unspecified";
}

function deriveClaim(post: XPostRecord): string {
  if (!post.article) return post.text;
  const lead = [post.article.title, post.article.previewText, post.article.plainText]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n\n");
  if (lead.length <= MAX_SIGNAL_CLAIM_CHARS) return lead;
  return `${lead.slice(0, MAX_SIGNAL_CLAIM_CHARS - 1).trimEnd()}…`;
}

export function deriveResearchSignal(post: XPostRecord): ResearchSignal {
  const researchText = getXPostResearchText(post);
  const stance = deriveStance(researchText);
  const relatedAssets = collectMatches(researchText, ASSET_TERMS);
  const industryChainNodes = collectMatches(researchText, INDUSTRY_TERMS);
  const confidence = stance === "neutral" ? 0.45 : post.sourceRole === "executive" ? 0.68 : 0.58;
  const catalysts = deriveCatalysts(researchText);

  return {
    signalId: `x:${post.postId}`,
    sourcePostIds: [post.postId],
    sourceRole: post.sourceRole,
    sourceHandle: post.handle,
    sourceUrl: post.url,
    createdAt: post.createdAt,
    claim: deriveClaim(post),
    signalKind: catalysts.length > 0 ? "catalyst" : "claim",
    relatedAssets,
    industryChainNodes,
    stance,
    timeHorizon: deriveTimeHorizon(researchText),
    catalysts,
    risks: deriveRisks(researchText),
    verificationPoints: relatedAssets.length > 0 ? ["核对后续财报、订单、资本开支或官方指引"] : [],
    evidenceLevel: "expert_opinion",
    confidence,
    article: post.article
      ? {
          title: post.article.title,
          previewText: post.article.previewText,
          characterCount: post.article.plainText.length,
        }
      : undefined,
  };
}
