import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { normalizeDerivativesDataInput } from "./normalize.js";
import type { CryptoProvider } from "./provider.js";
import { CryptoDerivativesDataInputSchema, type CryptoDerivativesDataInput } from "./schemas.js";
import { createCryptoDomainTool } from "./tool-factory.js";

export function createCryptoDerivativesDataTool(api: AgentToolApi, provider: CryptoProvider) {
  return createCryptoDomainTool(api, provider, {
    name: "crypto_derivatives_data",
    label: "加密衍生品数据",
    description:
      "查询永续或交割合约的资金费率、持仓量、基差、多空比、主动买卖、清算和风险指标。" +
      "通过 bundle 可一次获取衍生品研究概览；部分 API 失败时保留成功 section 并明确 issues。",
    parameters: CryptoDerivativesDataInputSchema,
    normalizeInput: (input: CryptoDerivativesDataInput) => normalizeDerivativesDataInput(input),
    request: (selectedProvider, query) => selectedProvider.getDerivativesData(query),
  });
}
