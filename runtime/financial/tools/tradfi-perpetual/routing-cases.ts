import { classifyTradfiPerpetualRoute } from "./routing.js";

export interface TradfiAgentRoutingCase {
  id: string;
  userQuery: string;
  expectedTool: string | null;
  shouldUseTradfiPerpetualData: boolean;
}

export const TRADFI_AGENT_ROUTING_CASES: readonly TradfiAgentRoutingCase[] = [
  {
    id: "positive-sk-hynix-technical",
    userQuery: "帮我看看 bn 上的 SK 海力士近3个月永续合约数据，并作技术面分析",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-nvda-kline",
    userQuery: "拉一下 Binance 上 NVDA 股票永续最近60根日K线",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-mu-funding",
    userQuery: "币安 MU 美股合约最近一个月资金费率怎么样",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-aapl-orderbook",
    userQuery: "看一下 BN 上 AAPL 永续现在的盘口深度",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-instrument-catalog",
    userQuery: "币安现在有哪些美股和韩股永续合约",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-samsung-snapshot",
    userQuery: "给我 Binance 三星电子股票永续的行情快照",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-googl-mark-price",
    userQuery: "分析 binance GOOGL 合约的标记价格 K 线",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-msft-open-interest",
    userQuery: "BN 上微软永续最近两周持仓量有什么变化",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-tsm-long-short",
    userQuery: "查 Binance 台积电美股永续的多空比",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-trading-schedule",
    userQuery: "币安美股永续现在是不是交易时段",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-nvda-technical-alias",
    userQuery: "帮我做一下 bn 上英伟达合约的 MACD 和 RSI 技术分析",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-equity-catalog-english",
    userQuery: "List the available Binance TradFi equity perpetual contracts",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-zhipu-hk-equity-perpetual",
    userQuery: "结合智谱近30日日K做技术分析，采用 BN 上的股票永续合约数据",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "positive-cxmt-cn-equity-perpetual",
    userQuery: "查看 Binance 长鑫存储 CXMT 股票永续合约的行情与交易时段",
    expectedTool: "tradfi_perpetual_data",
    shouldUseTradfiPerpetualData: true,
  },
  {
    id: "negative-cash-nvda",
    userQuery: "看看英伟达最近三个月的现金美股走势",
    expectedTool: "us_equity_market_data",
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-sec-filing",
    userQuery: "查一下 NVDA 最新 SEC 10-K 财报",
    expectedTool: "us_equity_filings",
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-binance-btc",
    userQuery: "分析 Binance BTC 永续最近一个月资金费率",
    expectedTool: "crypto_derivatives_data",
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-binance-eth",
    userQuery: "币安 ETH 合约的多空比和持仓量",
    expectedTool: "crypto_derivatives_data",
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-bnb-not-bn",
    userQuery: "看看 BNB 永续的 K 线",
    expectedTool: "crypto_derivatives_data",
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-commodity-gold",
    userQuery: "Binance 黄金永续合约最近走势如何",
    expectedTool: null,
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-premarket",
    userQuery: "看一下 Binance PREMARKET 合约目录",
    expectedTool: null,
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-binance-news",
    userQuery: "Binance 最近有什么平台新闻",
    expectedTool: "open_search",
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-a-share",
    userQuery: "贵州茅台最近20天的技术面怎么样",
    expectedTool: "a_stock_equity",
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-cash-aapl-on-binance",
    userQuery: "查 Binance 上 AAPL 的现货股票价格",
    expectedTool: "us_equity_market_data",
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-token-catalog",
    userQuery: "币安最近上线了哪些币种",
    expectedTool: "crypto_market_data",
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-nvda-valuation",
    userQuery: "分析 NVDA 的估值和净利润增速",
    expectedTool: "us_equity_filings",
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-binance-account",
    userQuery: "帮我查 Binance 账户里的持仓余额",
    expectedTool: null,
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-zhipu-cash-hk-equity",
    userQuery: "查看 Binance 上智谱的现金港股价格，不要合约数据",
    expectedTool: "hk_equity_market_data",
    shouldUseTradfiPerpetualData: false,
  },
  {
    id: "negative-cxmt-cash-a-share",
    userQuery: "查看 Binance 上长鑫存储的现金 A 股价格，不要永续数据",
    expectedTool: "a_stock_equity",
    shouldUseTradfiPerpetualData: false,
  },
] as const;

export interface TradfiAgentRoutingMetrics {
  caseCount: number;
  positiveCount: number;
  negativeCount: number;
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  accuracy: number;
  precision: number;
  recall: number;
  specificity: number;
}

export function evaluateTradfiAgentRouting(
  cases: readonly TradfiAgentRoutingCase[] = TRADFI_AGENT_ROUTING_CASES,
): TradfiAgentRoutingMetrics {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const testCase of cases) {
    const actual = classifyTradfiPerpetualRoute(testCase.userQuery).shouldRoute;
    if (actual && testCase.shouldUseTradfiPerpetualData) truePositive++;
    else if (!actual && !testCase.shouldUseTradfiPerpetualData) trueNegative++;
    else if (actual) falsePositive++;
    else falseNegative++;
  }
  const positiveCount = truePositive + falseNegative;
  const negativeCount = trueNegative + falsePositive;
  const divide = (numerator: number, denominator: number) =>
    denominator === 0 ? 0 : numerator / denominator;
  return {
    caseCount: cases.length,
    positiveCount,
    negativeCount,
    truePositive,
    trueNegative,
    falsePositive,
    falseNegative,
    accuracy: divide(truePositive + trueNegative, cases.length),
    precision: divide(truePositive, truePositive + falsePositive),
    recall: divide(truePositive, positiveCount),
    specificity: divide(trueNegative, negativeCount),
  };
}
