import type { XSource } from "./types.js";

const AI_RESEARCH_TOPICS = [
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
  "robot",
  "autonomous",
  "self-driving",
  "energy",
  "spacex",
  "policy",
  "regulation",
  "export control",
] as const;

export const DEFAULT_X_SOURCES: readonly XSource[] = [
  {
    handle: "elonmusk",
    displayName: "Elon Musk",
    profileUrl: "https://x.com/elonmusk",
    sourceRole: "executive",
    topicScope: AI_RESEARCH_TOPICS,
  },
  {
    handle: "xiaomustock",
    displayName: "川沐",
    profileUrl: "https://x.com/xiaomustock",
    sourceRole: "analyst_kol",
    topicScope: AI_RESEARCH_TOPICS,
  },
  {
    handle: "jensenhuang",
    displayName: "Jensen Huang",
    profileUrl: "https://x.com/JensenHuang",
    sourceRole: "executive",
    topicScope: AI_RESEARCH_TOPICS,
  },
];

export function normalizeXHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function findXSource(
  handle: string,
  sources: readonly XSource[] = DEFAULT_X_SOURCES,
): XSource | undefined {
  const normalized = normalizeXHandle(handle);
  return sources.find((source) => normalizeXHandle(source.handle) === normalized);
}
