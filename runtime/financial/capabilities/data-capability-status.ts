import { Type } from "@sinclair/typebox";
import type { AgentToolApi, AgentToolContext } from "../runtime/plugin-api.js";

export const DATA_CAPABILITIES_SCHEMA_VERSION = "fin-core.data-capabilities.v1" as const;

type CapabilityState =
  | "not_registered"
  | "available_without_config"
  | "configured_unverified"
  | "fixture_only"
  | "unconfigured";

type RouteDefinition = {
  provider: string;
  role: "primary" | "fallback" | "supplemental" | "fixture";
  configGroups?: string[][];
};

type CapabilityDefinition = {
  tool: string;
  domain: string;
  routes: RouteDefinition[];
};

export type DataCapabilityStatusInput = {
  registeredTools: ReadonlySet<string>;
  configured: Readonly<Record<string, boolean | undefined>>;
  xProvider: "fixture" | "x-api" | string;
};

const CRYPTO_MARKET_ROUTES: RouteDefinition[] = [
  { provider: "binance", role: "primary" },
  { provider: "bybit", role: "supplemental" },
  { provider: "deribit", role: "supplemental" },
];

const DEFINITIONS: CapabilityDefinition[] = [
  { tool: "crypto_market_data", domain: "crypto_market", routes: CRYPTO_MARKET_ROUTES },
  {
    tool: "crypto_derivatives_data",
    domain: "crypto_derivatives",
    routes: [
      ...CRYPTO_MARKET_ROUTES,
      { provider: "coinalyze", role: "fallback", configGroups: [["COINALYZE_API_KEY"]] },
    ],
  },
  {
    tool: "crypto_options_data",
    domain: "crypto_options",
    routes: [{ provider: "deribit", role: "primary" }],
  },
  {
    tool: "crypto_dex_data",
    domain: "crypto_dex",
    routes: [
      { provider: "geckoterminal", role: "primary" },
      { provider: "dexscreener", role: "supplemental" },
    ],
  },
  {
    tool: "crypto_defi_data",
    domain: "crypto_defi",
    routes: [{ provider: "defillama", role: "primary" }],
  },
  {
    tool: "crypto_onchain_data",
    domain: "crypto_onchain",
    routes: [
      { provider: "mempool.space", role: "primary" },
      { provider: "etherscan", role: "supplemental", configGroups: [["ETHERSCAN_API_KEY"]] },
      {
        provider: "dune",
        role: "supplemental",
        configGroups: [["DUNE_API_KEY", "DUNE_SAVED_QUERY_IDS"]],
      },
    ],
  },
  {
    tool: "crypto_asset_data",
    domain: "crypto_reference",
    routes: [
      { provider: "coinpaprika", role: "fallback" },
      { provider: "coingecko", role: "primary", configGroups: [["COINGECKO_API_KEY"]] },
    ],
  },
  {
    tool: "crypto_sentiment_data",
    domain: "crypto_sentiment",
    routes: [
      { provider: "alternative.me", role: "primary" },
      { provider: "dexscreener", role: "supplemental" },
      { provider: "coingecko", role: "supplemental", configGroups: [["COINGECKO_API_KEY"]] },
    ],
  },
  {
    tool: "tradfi_perpetual_data",
    domain: "tradfi_perpetual",
    routes: [{ provider: "binance-public", role: "primary" }],
  },
  {
    tool: "macro_indicator_data",
    domain: "us_macro",
    routes: [{ provider: "fred", role: "primary", configGroups: [["FRED_API_KEY"]] }],
  },
  {
    tool: "us_equity_market_data",
    domain: "us_equity_market",
    routes: [
      {
        provider: "eodhd",
        role: "primary",
        configGroups: [["EODHD_API_TOKEN"], ["EODHD_API_KEY"]],
      },
      {
        provider: "alpha_vantage",
        role: "fallback",
        configGroups: [["ALPHA_VANTAGE_API_KEY"]],
      },
    ],
  },
  {
    tool: "us_equity_filings",
    domain: "us_equity_filings",
    routes: [
      {
        provider: "sec_edgar",
        role: "primary",
        configGroups: [["SEC_EDGAR_USER_AGENT"]],
      },
    ],
  },
  {
    tool: "us_equity_fundamentals",
    domain: "us_equity_fundamentals",
    routes: [
      {
        provider: "sec_edgar",
        role: "primary",
        configGroups: [["SEC_EDGAR_USER_AGENT"]],
      },
    ],
  },
  {
    tool: "kline_analysis",
    domain: "standardized_market_series",
    routes: [
      { provider: "deterministic-fixture", role: "fixture" },
      {
        provider: "us-data-router",
        role: "primary",
        configGroups: [["EODHD_API_TOKEN"], ["EODHD_API_KEY"], ["ALPHA_VANTAGE_API_KEY"]],
      },
    ],
  },
  {
    tool: "market_pulse",
    domain: "x_market_intelligence",
    routes: [
      { provider: "x-fixture", role: "fixture" },
      {
        provider: "x-api",
        role: "primary",
        configGroups: [["X_API_BEARER_TOKEN"]],
      },
    ],
  },
];

function routeConfigured(
  route: RouteDefinition,
  configured: DataCapabilityStatusInput["configured"],
): boolean {
  if (!route.configGroups?.length) return true;
  return route.configGroups.some((group) => group.every((name) => configured[name] === true));
}

function capabilityState(
  definition: CapabilityDefinition,
  input: DataCapabilityStatusInput,
): CapabilityState {
  if (!input.registeredTools.has(definition.tool)) return "not_registered";
  if (definition.tool === "market_pulse" && input.xProvider === "fixture") return "fixture_only";

  const nonFixtureRoutes = definition.routes.filter((route) => route.role !== "fixture");
  if (nonFixtureRoutes.some((route) => !route.configGroups?.length)) {
    return "available_without_config";
  }
  if (nonFixtureRoutes.some((route) => routeConfigured(route, input.configured))) {
    return "configured_unverified";
  }
  if (definition.routes.some((route) => route.role === "fixture")) return "fixture_only";
  return "unconfigured";
}

export function buildDataCapabilitySnapshot(input: DataCapabilityStatusInput) {
  return {
    schemaVersion: DATA_CAPABILITIES_SCHEMA_VERSION,
    contracts: {
      quality: "fin-core.data-quality.v1",
      marketSeries: "fin-core.market-series.v1",
      provenance: "fin-core.provenance.v1",
    },
    capabilities: DEFINITIONS.map((definition) => ({
      tool: definition.tool,
      domain: definition.domain,
      registered: input.registeredTools.has(definition.tool),
      state: capabilityState(definition, input),
      routes: definition.routes.map((route) => ({
        provider: route.provider,
        role: route.role,
        configured:
          definition.tool === "market_pulse" && route.provider === "x-api"
            ? input.xProvider === "x-api" && routeConfigured(route, input.configured)
            : routeConfigured(route, input.configured),
        configNames: [...new Set(route.configGroups?.flat() ?? [])],
      })),
    })),
  };
}

export function createDataCapabilityStatusTool(
  _api: AgentToolApi,
  getInput: () => DataCapabilityStatusInput,
) {
  return (_ctx: AgentToolContext) => ({
    name: "data_capability_status",
    label: "数据能力状态",
    description:
      "返回当前实际注册的数据工具、Provider 路由、配置是否存在及统一质量/行情/provenance 契约版本。只返回配置项名称和布尔状态，不返回密钥值，也不进行外部连通性探测。",
    parameters: Type.Object({}),
    async execute() {
      const snapshot = buildDataCapabilitySnapshot(getInput());
      return {
        content: [{ type: "text" as const, text: JSON.stringify(snapshot) }],
        details: snapshot,
      };
    },
  });
}
