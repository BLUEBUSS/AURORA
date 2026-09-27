import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { normalizeMarketDataInput } from "./normalize.js";
import type { CryptoProvider } from "./provider.js";
import { CryptoMarketDataInputSchema, type CryptoMarketDataInput } from "./schemas.js";
import { createCryptoDomainTool } from "./tool-factory.js";

export function createCryptoMarketDataTool(api: AgentToolApi, provider: CryptoProvider) {
  return createCryptoDomainTool(api, provider, {
    name: "crypto_market_data",
    label: "加密交易市场数据",
    description:
      "查询 CEX/DEX 交易市场的快照、K线、成交、盘口和合约元数据。" +
      "通过 data_type 查询单项，或通过 bundle 一次查询完整行情概览/微观结构。" +
      "结果保留 provider、venue、市场类型、时间和单位，不静默混用不同市场口径。",
    parameters: CryptoMarketDataInputSchema,
    normalizeInput: (input: CryptoMarketDataInput) => normalizeMarketDataInput(input),
    request: (selectedProvider, query) => selectedProvider.getMarketData(query),
  });
}
