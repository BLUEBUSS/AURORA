export const DATA_SOURCES = [
  { id: "sec", name: "SEC EDGAR", description: "公司公告与 XBRL 财务数据", credentialLabel: "应用名称与联系邮箱", url: "https://www.sec.gov/about/developer-resources", env: "SEC_EDGAR_USER_AGENT" },
  { id: "eodhd", name: "EODHD", description: "美股历史价格与成交量（日／周／月）", credentialLabel: "API Token", url: "https://eodhd.com/register", env: "EODHD_API_TOKEN" },
  { id: "alpha_vantage", name: "Alpha Vantage", description: "美股历史行情，可作为已配置 EODHD 的备选来源", credentialLabel: "API Key", url: "https://www.alphavantage.co/support/#api-key", env: "ALPHA_VANTAGE_API_KEY" },
  { id: "fred", name: "FRED", description: "通胀、就业、GDP、国债收益率与政策利率", credentialLabel: "API Key", url: "https://fred.stlouisfed.org/docs/api/api_key.html", env: "FRED_API_KEY" },
] as const;
export type DataSourceId = typeof DATA_SOURCES[number]["id"];
export type DataEnvironment = Partial<Record<typeof DATA_SOURCES[number]["env"], string>>;
export interface ProbeResult { ok: boolean; code: string; message: string; checkedAt: string }
export type DataProbe = (id: DataSourceId, credential: string) => Promise<ProbeResult>;
export function isDataSourceId(value: unknown): value is DataSourceId { return DATA_SOURCES.some(source => source.id === value); }
