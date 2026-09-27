import {
  assessDataQuality,
  type DataCitation,
  type DataQualityGrade,
  type DataQualitySummary,
} from "../data-contracts/index.js";

export type ResearchDataQualityGrade = DataQualityGrade;

export interface ResearchDataCitation extends DataCitation {}

export interface ResearchDataQuality extends DataQualitySummary {}

interface ResearchQualityInput {
  status: "complete" | "partial";
  records: Array<Record<string, unknown>>;
  issues?: Array<{ code: string; message: string }>;
}

const PROVIDER_CITATIONS: Array<{
  pattern: RegExp;
  citation: ResearchDataCitation;
}> = [
  {
    pattern: /binance/i,
    citation: {
      label: "Binance",
      url: "https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api",
    },
  },
  {
    pattern: /coinalyze/i,
    citation: { label: "Coinalyze", url: "https://api.coinalyze.net/v1/doc/" },
  },
  {
    pattern: /deribit/i,
    citation: { label: "Deribit", url: "https://docs.deribit.com/" },
  },
  {
    pattern: /etherscan/i,
    citation: { label: "Etherscan", url: "https://docs.etherscan.io/" },
  },
  {
    pattern: /mempool/i,
    citation: { label: "mempool.space", url: "https://mempool.space/docs/api" },
  },
  {
    pattern: /dune/i,
    citation: { label: "Dune", url: "https://docs.dune.com/api-reference/overview/introduction" },
  },
  {
    pattern: /alternative[_ -]?me/i,
    citation: {
      label: "Alternative.me",
      url: "https://alternative.me/crypto/fear-and-greed-index/",
    },
  },
  {
    pattern: /coingecko/i,
    citation: { label: "CoinGecko", url: "https://docs.coingecko.com/" },
  },
  {
    pattern: /dexscreener/i,
    citation: { label: "DEX Screener", url: "https://docs.dexscreener.com/api/reference" },
  },
];

export function assessResearchDataQuality(input: ResearchQualityInput): ResearchDataQuality {
  return assessDataQuality({
    ...input,
    citations: citationsForRecords(input.records),
    isAttributed: (record) => Boolean(record.provider),
    failOnMissingAttribution: true,
  });
}

export function formatResearchDataQuality(quality: ResearchDataQuality): string {
  const lines = [
    `quality: ${quality.grade} (${quality.score}/100)`,
    `records: ${quality.recordCount}`,
  ];
  if (quality.citations.length > 0) {
    lines.push(
      "sources:",
      ...quality.citations.map((citation) => `- [${citation.label}](${citation.url})`),
    );
  }
  return lines.join("\n");
}

function citationsForRecords(records: Array<Record<string, unknown>>): ResearchDataCitation[] {
  const citations = new Map<string, ResearchDataCitation>();
  for (const record of records) {
    const identity = `${String(record.provider ?? "")} ${String(record.venue ?? "")}`;
    for (const entry of PROVIDER_CITATIONS) {
      if (entry.pattern.test(identity)) citations.set(entry.citation.url, entry.citation);
    }
  }
  return [...citations.values()];
}
