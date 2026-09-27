export const TRADFI_PERPETUAL_ROUTE_REASONS = [
  "eligible",
  "missing_binance_venue",
  "crypto_asset",
  "commodity_contract",
  "premarket_contract",
  "cash_equity_or_filing",
  "unrelated_binance_request",
] as const;

export type TradfiPerpetualRouteReason = (typeof TRADFI_PERPETUAL_ROUTE_REASONS)[number];

export interface TradfiPerpetualRouteDecision {
  shouldRoute: boolean;
  reason: TradfiPerpetualRouteReason;
}

const DERIVATIVE_HINT =
  /永续|合约|perpetual|contract|资金费率|funding|持仓|open\s*interest|多空比|long.?short|盘口|order\s*book|标记价格|mark\s*price|指数价格|index\s*price|交易时段|trading\s*schedule|k线|kline|ohlcv/i;
const EQUITY_HINT =
  /股票|美股|韩股|港股|a\s*股|equity|tradfi|sk\s*海力士|海力士|英伟达|苹果|美光|台积电|三星|现代汽车|谷歌|微软|亚马逊|智谱|长鑫存储?|腾讯(?:控股)?|小米(?:集团)?|泡泡玛特|美团|快手|中际旭创|兆易创新|minimax|\b(?:nvda|aapl|mu|tsm|skhynix|samsung|hyundai|googl|goog|msft|amzn|meta|tsla|zhipu|cxmt|tencent|hk0700|hk1810|popmart|meituan|kuaishou|zhongji|gigadev|minimax)\b/i;
const CRYPTO_ASSET_HINT =
  /加密货币|数字货币|币种|代币|crypto|\b(?:btc|eth|bnb|sol|xrp|doge|ada|avax|link|sui)\b/i;
const COMMODITY_HINT = /商品|黄金|白银|原油|天然气|gold|silver|crude|oil|commodity/i;
const PREMARKET_HINT = /premarket|盘前代币|盘前合约/i;
const ACCOUNT_HINT = /账户|账号|account|余额|balance|下单|交易权限/i;
const CASH_OR_FILING_HINT =
  /现金(?:a\s*股|港股|美股)|现货(?:a\s*股|港股|股票)|真实股票|cash\s*equity|sec\b|10-[kq]\b|财报|利润表|资产负债表|现金流量表|营收|净利润|估值|市盈率|市净率/i;
const EXPLICIT_NON_DERIVATIVE_HINT = /不要(?:合约|永续)|非(?:合约|永续)|只要(?:现货|现金股票)/i;

export function hasExplicitBinanceIntent(userQuery: string): boolean {
  const query = userQuery.trim();
  if (/binance|币安/i.test(query)) return true;
  return /(?:^|[^a-z0-9])bn(?:$|[^a-z0-9])/i.test(query);
}

export function classifyTradfiPerpetualRoute(userQuery: string): TradfiPerpetualRouteDecision {
  const query = userQuery.trim();
  if (!hasExplicitBinanceIntent(query)) {
    return { shouldRoute: false, reason: "missing_binance_venue" };
  }
  if (PREMARKET_HINT.test(query)) {
    return { shouldRoute: false, reason: "premarket_contract" };
  }
  if (ACCOUNT_HINT.test(query)) {
    return { shouldRoute: false, reason: "unrelated_binance_request" };
  }
  if (EXPLICIT_NON_DERIVATIVE_HINT.test(query)) {
    return { shouldRoute: false, reason: "cash_equity_or_filing" };
  }
  if (COMMODITY_HINT.test(query)) {
    return { shouldRoute: false, reason: "commodity_contract" };
  }
  if (CRYPTO_ASSET_HINT.test(query) && !EQUITY_HINT.test(query)) {
    return { shouldRoute: false, reason: "crypto_asset" };
  }
  if (CASH_OR_FILING_HINT.test(query) && !DERIVATIVE_HINT.test(query)) {
    return { shouldRoute: false, reason: "cash_equity_or_filing" };
  }
  if (!DERIVATIVE_HINT.test(query) && !EQUITY_HINT.test(query)) {
    return { shouldRoute: false, reason: "unrelated_binance_request" };
  }
  return { shouldRoute: true, reason: "eligible" };
}
