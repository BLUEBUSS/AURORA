import { UsDataProviderError } from "../errors.js";
import type { UsEquityFilingsProvider, UsEquityFundamentalsProvider } from "../provider.js";
import type {
  UsEquityFilingRecord,
  UsEquityFilingsQuery,
  UsEquityFilingsResult,
  UsEquityFundamentalRecord,
  UsEquityFundamentalsQuery,
  UsEquityFundamentalsResult,
  UsEquityFundamentalStatement,
} from "../types.js";
import { createUsDataFetch, MemoryJsonCache, requestJson, type UsDataFetch } from "./http.js";

const SEC_FILES_BASE_URL = "https://www.sec.gov";
const SEC_DATA_BASE_URL = "https://data.sec.gov";
const TICKERS_CACHE_KEY = "sec-edgar:company-tickers";

interface SecEdgarProviderOptions {
  userAgent: string;
  fetchImpl?: UsDataFetch;
  proxyUrl?: string;
  filesBaseUrl?: string;
  dataBaseUrl?: string;
  cache?: MemoryJsonCache;
}

interface SecCompanyTicker {
  cik_str: number;
  ticker: string;
  title: string;
}

type SecCompanyTickersResponse = Record<string, SecCompanyTicker>;

interface SecCompanyProfile {
  cik: string;
  symbol: string;
  title: string;
}

interface SecSubmissionsResponse {
  name?: string;
  cik?: string;
  filings?: {
    recent?: SecRecentFilings;
  };
}

interface SecRecentFilings {
  accessionNumber?: string[];
  filingDate?: string[];
  reportDate?: string[];
  form?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
}

interface SecCompanyFactsResponse {
  entityName?: string;
  facts?: Record<string, Record<string, SecConceptFact>>;
}

interface SecConceptFact {
  label?: string;
  description?: string;
  units?: Record<string, SecFactUnit[]>;
}

interface SecFactUnit {
  val?: number | string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  start?: string;
  end?: string;
  frame?: string;
}

const DEFAULT_CONCEPTS: Record<UsEquityFundamentalStatement, string[]> = {
  companyfacts: [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "GrossProfit",
    "OperatingIncomeLoss",
    "NetIncomeLoss",
    "EarningsPerShareDiluted",
    "Assets",
    "AssetsCurrent",
    "CashAndCashEquivalentsAtCarryingValue",
    "Liabilities",
    "LiabilitiesCurrent",
    "StockholdersEquity",
    "NetCashProvidedByUsedInOperatingActivities",
    "PaymentsToAcquirePropertyPlantAndEquipment",
  ],
  income: [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "CostOfRevenue",
    "GrossProfit",
    "OperatingIncomeLoss",
    "NetIncomeLoss",
    "EarningsPerShareDiluted",
  ],
  balance: [
    "Assets",
    "AssetsCurrent",
    "CashAndCashEquivalentsAtCarryingValue",
    "Liabilities",
    "LiabilitiesCurrent",
    "StockholdersEquity",
  ],
  cashflow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "NetCashProvidedByUsedInInvestingActivities",
    "NetCashProvidedByUsedInFinancingActivities",
  ],
};

export class SecEdgarProvider implements UsEquityFilingsProvider, UsEquityFundamentalsProvider {
  readonly id = "sec_edgar";
  private readonly userAgent: string;
  private readonly filesBaseUrl: string;
  private readonly dataBaseUrl: string;
  private readonly fetchImpl: UsDataFetch;
  private readonly cache: MemoryJsonCache;

  constructor(options: SecEdgarProviderOptions) {
    if (!options.userAgent.trim()) {
      throw new UsDataProviderError(
        "CONFIGURATION_MISSING",
        "SEC_EDGAR_USER_AGENT is required for SEC EDGAR requests.",
      );
    }
    this.userAgent = options.userAgent.trim();
    this.filesBaseUrl = options.filesBaseUrl ?? SEC_FILES_BASE_URL;
    this.dataBaseUrl = options.dataBaseUrl ?? SEC_DATA_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? createUsDataFetch({ proxyUrl: options.proxyUrl });
    this.cache = options.cache ?? new MemoryJsonCache(24 * 60 * 60_000);
  }

  async getEquityFilings(query: UsEquityFilingsQuery): Promise<UsEquityFilingsResult> {
    const company = await this.resolveCompany(query.symbol);
    const submissions = await this.getJson<SecSubmissionsResponse>(
      new URL(`/submissions/CIK${company.cik}.json`, this.dataBaseUrl),
    );
    const rows = recentFilings(submissions.filings?.recent)
      .filter((row) => matchesForms(row.form, query.forms))
      .filter((row) => isInDateRange(row.filingDate, query.startDate, query.endDate))
      .slice(0, query.limit ?? 20);
    const records = rows.map(
      (row): UsEquityFilingRecord => ({
        dataType: "filing",
        symbol: company.symbol,
        cik: company.cik,
        companyName: submissions.name ?? company.title,
        accessionNumber: row.accessionNumber,
        form: row.form,
        filingDate: row.filingDate,
        reportDate: row.reportDate,
        primaryDocument: row.primaryDocument,
        description: row.primaryDocDescription,
        url: archiveUrl(company.cik, row.accessionNumber, row.primaryDocument),
        provider: this.id,
        source: "SEC EDGAR",
      }),
    );

    return {
      status: "complete",
      sections: [{ dataType: "filing", status: "complete", records }],
    };
  }

  async getEquityFundamentals(
    query: UsEquityFundamentalsQuery,
  ): Promise<UsEquityFundamentalsResult> {
    const company = await this.resolveCompany(query.symbol);
    const companyFacts = await this.getJson<SecCompanyFactsResponse>(
      new URL(`/api/xbrl/companyfacts/CIK${company.cik}.json`, this.dataBaseUrl),
    );
    const concepts = normalizeConcepts(query.concepts ?? DEFAULT_CONCEPTS[query.statement]);
    const usGaapFacts = companyFacts.facts?.["us-gaap"] ?? {};
    const records = concepts
      .flatMap((concept) =>
        factRecords(company, concept, usGaapFacts[concept], query.annualOnly ?? false),
      )
      .sort(compareFundamentalRecords)
      .slice(0, query.limit ?? 50);

    return {
      status: "complete",
      sections: [{ dataType: "fundamental_fact", status: "complete", records }],
    };
  }

  private async resolveCompany(symbol: string): Promise<SecCompanyProfile> {
    const tickers = await this.cache.getOrSet(TICKERS_CACHE_KEY, () =>
      this.getJson<SecCompanyTickersResponse>(
        new URL("/files/company_tickers.json", this.filesBaseUrl),
      ),
    );
    const match = Object.values(tickers).find((item) => item.ticker.toUpperCase() === symbol);
    if (!match) {
      throw new UsDataProviderError("NO_DATA", `SEC EDGAR could not resolve ticker ${symbol}.`);
    }
    return {
      cik: String(match.cik_str).padStart(10, "0"),
      symbol: match.ticker.toUpperCase(),
      title: match.title,
    };
  }

  private getJson<T>(url: URL): Promise<T> {
    return requestJson<T>(this.fetchImpl, url, {
      headers: {
        accept: "application/json",
        "user-agent": this.userAgent,
      },
    });
  }
}

interface RecentFilingRow {
  accessionNumber: string;
  filingDate: string;
  reportDate?: string;
  form: string;
  primaryDocument?: string;
  primaryDocDescription?: string;
}

function recentFilings(recent?: SecRecentFilings): RecentFilingRow[] {
  if (!recent?.accessionNumber) return [];
  return recent.accessionNumber.flatMap((accessionNumber, index) => {
    const filingDate = recent.filingDate?.[index];
    const form = recent.form?.[index];
    if (!accessionNumber || !filingDate || !form) return [];
    return [
      {
        accessionNumber,
        filingDate,
        reportDate: recent.reportDate?.[index] || undefined,
        form,
        primaryDocument: recent.primaryDocument?.[index] || undefined,
        primaryDocDescription: recent.primaryDocDescription?.[index] || undefined,
      },
    ];
  });
}

function matchesForms(form: string, requestedForms?: string[]): boolean {
  if (!requestedForms?.length) return true;
  return requestedForms.includes(form.toUpperCase());
}

function isInDateRange(date: string, startDate?: string, endDate?: string): boolean {
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function archiveUrl(
  cik: string,
  accessionNumber: string,
  primaryDocument?: string,
): string | undefined {
  if (!primaryDocument) return undefined;
  const cikNoLeadingZeros = cik.replace(/^0+/, "") || "0";
  const accessionNoDashes = accessionNumber.replaceAll("-", "");
  return `${SEC_FILES_BASE_URL}/Archives/edgar/data/${cikNoLeadingZeros}/${accessionNoDashes}/${primaryDocument}`;
}

function normalizeConcepts(concepts: string[]): string[] {
  return [
    ...new Set(
      concepts
        .map((concept) => concept.split(":").at(-1)?.trim())
        .filter((concept): concept is string => Boolean(concept)),
    ),
  ];
}

function factRecords(
  company: SecCompanyProfile,
  concept: string,
  fact: SecConceptFact | undefined,
  annualOnly: boolean,
): UsEquityFundamentalRecord[] {
  if (!fact?.units) return [];
  return Object.entries(fact.units).flatMap(([unit, rows]) =>
    rows.flatMap((row) => {
      if (annualOnly && row.fp !== "FY") return [];
      const value = numberValue(row.val);
      if (value === undefined) return [];
      return [
        {
          dataType: "fundamental_fact",
          symbol: company.symbol,
          cik: company.cik,
          concept,
          label: fact.label,
          taxonomy: "us-gaap",
          unit,
          value,
          fiscalYear: row.fy,
          fiscalPeriod: row.fp,
          form: row.form,
          filedDate: row.filed,
          startDate: row.start,
          endDate: row.end,
          frame: row.frame,
          provider: "sec_edgar",
          source: "SEC EDGAR",
        },
      ];
    }),
  );
}

function compareFundamentalRecords(
  a: UsEquityFundamentalRecord,
  b: UsEquityFundamentalRecord,
): number {
  const filed = (b.filedDate ?? "").localeCompare(a.filedDate ?? "");
  if (filed !== 0) return filed;
  return (b.endDate ?? "").localeCompare(a.endDate ?? "");
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
