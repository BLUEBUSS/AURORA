import type { AgentToolApi } from "../../runtime/plugin-api.js";
import { normalizeTradfiPerpetualInput } from "./normalize.js";
import type { TradfiPerpetualProvider } from "./provider.js";
import { TradfiPerpetualDataInputSchema, type TradfiPerpetualDataInput } from "./schemas.js";
import { createTradfiPerpetualTool } from "./tool-factory.js";

export function createTradfiPerpetualDataTool(
  api: AgentToolApi,
  provider: TradfiPerpetualProvider,
) {
  return createTradfiPerpetualTool<TradfiPerpetualDataInput>(api, provider, {
    name: "tradfi_perpetual_data",
    label: "Binance 股票永续数据",
    description:
      'STRICT ROUTING: use only when the original user explicitly names Binance, 币安, or standalone BN and asks for Binance US, Korean, Hong Kong, or China equity-linked TradFi perpetual catalog/market/derivatives data or analysis. Positive examples: "帮我看看 bn 上的 SK 海力士近3个月永续合约数据并做技术分析", "查看 Binance 长鑫存储股票永续合约". Copy the original request verbatim into user_query. Never use for ordinary cash-equity questions, SEC filings, BTC/crypto perpetuals, commodities, PREMARKET contracts, account balances, or BNB (BNB is not the BN venue alias). Negative examples: "看 NVDA 现金美股走势", "查看智谱现金港股", "Binance BTC 永续", "BNB 永续". technical_analysis_input returns deterministic MA/MACD/RSI/BOLL/ATR and raw series, so do not invoke Python to recompute standard indicators. Returns public read-only Binance USDⓈ-M data and always marks isCashEquity=false.',
    parameters: TradfiPerpetualDataInputSchema,
    normalizeInput: normalizeTradfiPerpetualInput,
  });
}
