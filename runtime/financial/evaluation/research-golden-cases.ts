export type ResearchGoldenDomain =
  | "us-equity"
  | "macro-cross-asset"
  | "tradfi-basis"
  | "crypto-multi-signal";

export interface ResearchGoldenCase {
  id: string;
  domain: ResearchGoldenDomain;
  userQuery: string;
  requiredTools: string[];
  forbiddenSubstitutions: string[];
  qualityGates: string[];
  fallbackPolicy: string;
}

export const RESEARCH_GOLDEN_CASES: ResearchGoldenCase[] = [
  {
    id: "us-aapl-technical-sec-fundamentals",
    domain: "us-equity",
    userQuery: "结合 AAPL 最近六个月日线技术走势、SEC 10-K/10-Q 披露和营收利润基本面给出判断。",
    requiredTools: ["us_equity_market_data", "us_equity_filings", "us_equity_fundamentals"],
    forbiddenSubstitutions: ["tradfi_perpetual_data 不得替代现金美股行情"],
    qualityGates: ["source-citations", "adjustment-disclosure", "period-coverage"],
    fallbackPolicy: "EODHD 失败或空数据时允许降级到 Alpha Vantage，并在结论中显式标记。",
  },
  {
    id: "us-tsla-sec-risk-review",
    domain: "us-equity",
    userQuery: "检查 TSLA 最近的 SEC 10-K 和 8-K，并结合 SEC 基本面事实识别经营风险。",
    requiredTools: ["us_equity_filings", "us_equity_fundamentals"],
    forbiddenSubstitutions: ["公开网页摘要不得替代 SEC 原始披露"],
    qualityGates: ["source-citations", "filing-date", "fact-period"],
    fallbackPolicy: "SEC 不可用时返回明确失败，不用新闻或模型记忆伪造披露内容。",
  },
  {
    id: "macro-cpi-rates-qqq",
    domain: "macro-cross-asset",
    userQuery: "分析美国 CPI、2Y/10Y 国债收益率变化与 QQQ 最近三个月价格表现的关系。",
    requiredTools: ["macro_indicator_data", "us_equity_market_data"],
    forbiddenSubstitutions: ["不得用搜索摘要替代 FRED 时间序列"],
    qualityGates: ["source-citations", "frequency-alignment", "no-causal-overclaim"],
    fallbackPolicy: "单个宏观序列缺失时保留其他结果并标记 partial，不填造缺口。",
  },
  {
    id: "macro-fed-payroll-spy",
    domain: "macro-cross-asset",
    userQuery: "比较美联储利率、非农就业变化和 SPY 半年走势，判断风险偏好阶段。",
    requiredTools: ["macro_indicator_data", "us_equity_market_data"],
    forbiddenSubstitutions: ["单次最新值不得冒充完整趋势"],
    qualityGates: ["source-citations", "period-coverage", "release-lag-disclosure"],
    fallbackPolicy: "行情可降级到 Alpha Vantage；FRED 缺失则明确列出未验证指标。",
  },
  {
    id: "tradfi-aapl-cash-basis",
    domain: "tradfi-basis",
    userQuery: "比较 Binance AAPLUSDT 股票永续与 AAPL 现金美股最近一个月的价差和流动性风险。",
    requiredTools: ["tradfi_perpetual_data", "us_equity_market_data"],
    forbiddenSubstitutions: ["Binance 永续不得被描述为现金股票"],
    qualityGates: ["source-citations", "instrument-type-disclosure", "timestamp-alignment"],
    fallbackPolicy: "缺少任一市场时不计算 basis，只返回已验证腿和缺口。",
  },
  {
    id: "tradfi-skhynix-cash-boundary",
    domain: "tradfi-basis",
    userQuery: "查看币安 SKHYNIX 股票永续走势，并说明为什么不能直接当作韩国现金股报价。",
    requiredTools: ["tradfi_perpetual_data"],
    forbiddenSubstitutions: ["不得虚构韩国现金股对照数据"],
    qualityGates: ["source-citations", "coverage-limit", "instrument-type-disclosure"],
    fallbackPolicy: "合约历史不足时返回 COVERAGE_LIMITED，不外推缺失区间。",
  },
  {
    id: "crypto-btc-derivatives-onchain-sentiment",
    domain: "crypto-multi-signal",
    userQuery: "结合 BTC 衍生品资金费率和持仓量、链上交易所净流入与市场情绪判断拥挤度。",
    requiredTools: ["crypto_derivatives_data", "crypto_onchain_data", "crypto_sentiment_data"],
    forbiddenSubstitutions: ["情绪指标不得替代链上或衍生品事实"],
    qualityGates: ["source-citations", "venue-disclosure", "timestamp-alignment"],
    fallbackPolicy: "某一信号不可用时降低结论置信度并保留其他来源，不静默跨口径替换。",
  },
  {
    id: "crypto-eth-spot-options",
    domain: "crypto-multi-signal",
    userQuery: "比较 ETH 现货价格走势与期权隐含波动率和 skew，判断市场尾部风险。",
    requiredTools: ["crypto_market_data", "crypto_options_data"],
    forbiddenSubstitutions: ["期权 venue 不得静默切换"],
    qualityGates: ["source-citations", "venue-disclosure", "expiry-disclosure"],
    fallbackPolicy: "指定 venue 不可用时直接报告失败；未指定时只使用契约允许的兼容源。",
  },
];

export function inferResearchTools(query: string): Set<string> {
  const tools = new Set<string>();
  const hasUsAsset = /\b(?:AAPL|TSLA|QQQ|SPY)\b/i.test(query);

  if (hasUsAsset && /走势|表现|行情|价格|技术|现金美股/i.test(query)) {
    tools.add("us_equity_market_data");
  }
  if (/SEC|10-K|10-Q|8-K|披露/i.test(query)) tools.add("us_equity_filings");
  if (/基本面|营收|利润|公司事实/i.test(query)) tools.add("us_equity_fundamentals");
  if (/CPI|国债收益率|美联储|利率|非农|就业|通胀/i.test(query)) {
    tools.add("macro_indicator_data");
  }
  if (/(?:Binance|币安|\bBN\b).*(?:股票永续|AAPLUSDT|SKHYNIX)/i.test(query)) {
    tools.add("tradfi_perpetual_data");
  }
  if (/\b(?:BTC|ETH)\b.*(?:现货|价格|行情)/i.test(query)) tools.add("crypto_market_data");
  if (/衍生品|资金费率|持仓量|清算/i.test(query)) tools.add("crypto_derivatives_data");
  if (/链上|交易所净流入|地址活动/i.test(query)) tools.add("crypto_onchain_data");
  if (/市场情绪|恐惧|贪婪|社交情绪/i.test(query)) tools.add("crypto_sentiment_data");
  if (/期权|隐含波动率|\bskew\b/i.test(query)) tools.add("crypto_options_data");

  return tools;
}

export function evaluateResearchGoldenRouting(cases: ResearchGoldenCase[] = RESEARCH_GOLDEN_CASES) {
  let exactMatchCount = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const testCase of cases) {
    const expected = new Set(testCase.requiredTools);
    const actual = inferResearchTools(testCase.userQuery);
    if (expected.size === actual.size && [...expected].every((tool) => actual.has(tool))) {
      exactMatchCount++;
    }
    for (const tool of actual) {
      if (expected.has(tool)) truePositive++;
      else falsePositive++;
    }
    for (const tool of expected) {
      if (!actual.has(tool)) falseNegative++;
    }
  }

  const divide = (numerator: number, denominator: number) =>
    denominator === 0 ? 0 : numerator / denominator;
  return {
    caseCount: cases.length,
    exactMatchCount,
    exactMatchRate: divide(exactMatchCount, cases.length),
    toolPrecision: divide(truePositive, truePositive + falsePositive),
    toolRecall: divide(truePositive, truePositive + falseNegative),
  };
}
