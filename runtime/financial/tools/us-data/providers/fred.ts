import { UsDataProviderError } from "../errors.js";
import type { UsMacroProvider } from "../provider.js";
import type {
  UsMacroDataQuery,
  UsMacroIndicator,
  UsMacroIndicatorResult,
  UsMacroObservationRecord,
  UsMacroValueUnit,
} from "../types.js";
import { createUsDataFetch, requestJson, setQuery, type UsDataFetch } from "./http.js";

const DEFAULT_BASE_URL = "https://api.stlouisfed.org";

interface FredMacroProviderOptions {
  apiKey: string;
  fetchImpl?: UsDataFetch;
  proxyUrl?: string;
  baseUrl?: string;
}

interface FredSeriesConfig {
  seriesId: string;
  title: string;
  frequency: string;
}

interface FredObservationsResponse {
  observations?: FredObservation[];
  error_code?: number;
  error_message?: string;
}

interface FredObservation {
  realtime_start?: string;
  realtime_end?: string;
  date: string;
  value: string;
}

const SERIES: Record<UsMacroIndicator, FredSeriesConfig> = {
  cpi_headline: {
    seriesId: "CPIAUCSL",
    title: "Consumer Price Index for All Urban Consumers",
    frequency: "monthly",
  },
  cpi_core: {
    seriesId: "CPILFESL",
    title: "Core Consumer Price Index",
    frequency: "monthly",
  },
  ppi_final_demand: {
    seriesId: "PPIFIS",
    title: "Producer Price Index by Commodity: Final Demand",
    frequency: "monthly",
  },
  pce_core: {
    seriesId: "PCEPILFE",
    title: "Core PCE Price Index",
    frequency: "monthly",
  },
  pce_headline: {
    seriesId: "PCEPI",
    title: "PCE Price Index",
    frequency: "monthly",
  },
  nonfarm_payrolls: {
    seriesId: "PAYEMS",
    title: "All Employees, Total Nonfarm",
    frequency: "monthly",
  },
  unemployment_rate: {
    seriesId: "UNRATE",
    title: "Unemployment Rate",
    frequency: "monthly",
  },
  fed_funds: {
    seriesId: "FEDFUNDS",
    title: "Federal Funds Effective Rate",
    frequency: "monthly",
  },
  treasury_10y: {
    seriesId: "DGS10",
    title: "Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity",
    frequency: "daily",
  },
  treasury_2y: {
    seriesId: "DGS2",
    title: "Market Yield on U.S. Treasury Securities at 2-Year Constant Maturity",
    frequency: "daily",
  },
  gdp_nominal: {
    seriesId: "GDP",
    title: "Gross Domestic Product",
    frequency: "quarterly",
  },
  gdp_real: {
    seriesId: "GDPC1",
    title: "Real Gross Domestic Product",
    frequency: "quarterly",
  },
};

const FRED_UNITS: Record<UsMacroValueUnit, string> = {
  level: "lin",
  change: "chg",
  pct_change: "pch",
  yoy: "pc1",
};

const OUTPUT_UNITS: Record<UsMacroValueUnit, string> = {
  level: "level",
  change: "change",
  pct_change: "percent_change",
  yoy: "year_over_year_percent_change",
};

export class FredMacroProvider implements UsMacroProvider {
  readonly id = "fred";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: UsDataFetch;

  constructor(options: FredMacroProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new UsDataProviderError("CONFIGURATION_MISSING", "FRED_API_KEY is required.");
    }
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? createUsDataFetch({ proxyUrl: options.proxyUrl });
  }

  async getMacroIndicatorData(query: UsMacroDataQuery): Promise<UsMacroIndicatorResult> {
    const series = SERIES[query.indicator];
    if (!series) {
      throw new UsDataProviderError(
        "INVALID_ARGUMENT",
        `Unsupported FRED macro indicator: ${query.indicator}.`,
      );
    }

    const requestedLimit = query.limit ?? (!query.startDate && !query.endDate ? 120 : undefined);
    const url = setQuery(new URL("/fred/series/observations", this.baseUrl), {
      api_key: this.apiKey,
      file_type: "json",
      series_id: series.seriesId,
      units: FRED_UNITS[query.units],
      observation_start: query.startDate,
      observation_end: query.endDate,
      sort_order: requestedLimit ? "desc" : "asc",
      limit: requestedLimit,
    });
    const response = await requestJson<FredObservationsResponse>(this.fetchImpl, url);
    if (response.error_code) {
      throw new UsDataProviderError(
        response.error_code === 400 ? "INVALID_ARGUMENT" : "UPSTREAM_ERROR",
        response.error_message ?? `FRED returned error ${response.error_code}.`,
      );
    }

    const records = (response.observations ?? [])
      .map(
        (observation): UsMacroObservationRecord => ({
          dataType: "macro_observation",
          indicator: query.indicator,
          seriesId: series.seriesId,
          title: series.title,
          date: observation.date,
          value: parseFredValue(observation.value),
          units: OUTPUT_UNITS[query.units],
          frequency: series.frequency,
          realtimeStart: observation.realtime_start,
          realtimeEnd: observation.realtime_end,
          provider: this.id,
          source: "FRED",
        }),
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      status: "complete",
      sections: [{ dataType: "macro_observation", status: "complete", records }],
    };
  }
}

function parseFredValue(value: string): number | null {
  if (value === ".") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
