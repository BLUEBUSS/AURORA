import { TradfiPerpetualProviderError } from "../errors.js";
import type { TradfiPerpetualQuery, TradfiPerpetualUnderlyingType } from "../types.js";
import { isEligibleUnderlyingType, type BinanceInstrument } from "./binance-utils.js";

interface InstrumentTarget {
  baseAsset: string;
  market: TradfiPerpetualUnderlyingType;
}

interface InstrumentIdentity {
  name: string;
  aliases: readonly string[];
  targets: readonly InstrumentTarget[];
}

/**
 * Company names are identities, not one-to-one ticker aliases. Keeping all
 * possible venue targets lets the resolver honor the user's market intent and
 * ask for clarification when the same company has multiple listed contracts.
 */
const INSTRUMENT_IDENTITIES: readonly InstrumentIdentity[] = [
  identity("SK 海力士", ["SK 海力士", "海力士", "skhynix"], ["SKHYNIX", "KR_EQUITY"]),
  identity("英伟达", ["英伟达", "nvidia"], ["NVDA", "EQUITY"]),
  identity("苹果", ["苹果", "apple"], ["AAPL", "EQUITY"]),
  identity("美光", ["美光", "micron"], ["MU", "EQUITY"]),
  identity("台积电", ["台积电", "tsmc"], ["TSM", "EQUITY"]),
  identity("三星电子", ["三星", "三星电子", "samsung"], ["SAMSUNG", "KR_EQUITY"]),
  identity("现代汽车", ["现代汽车", "hyundai"], ["HYUNDAI", "KR_EQUITY"]),
  identity("谷歌", ["谷歌", "google", "alphabet"], ["GOOGL", "EQUITY"]),
  identity("微软", ["微软", "microsoft"], ["MSFT", "EQUITY"]),
  identity("亚马逊", ["亚马逊", "amazon"], ["AMZN", "EQUITY"]),
  identity("智谱", ["智谱", "智谱AI", "智谱华章"], ["ZHIPU", "HK_EQUITY"]),
  identity("长鑫存储", ["长鑫", "长鑫存储"], ["CXMT", "CN_EQUITY"]),
  {
    name: "腾讯控股",
    aliases: ["腾讯", "腾讯控股", "tencent"],
    targets: [
      { baseAsset: "TENCENT", market: "HK_EQUITY" },
      { baseAsset: "HK0700", market: "HK_EQUITY" },
    ],
  },
  identity("小米集团", ["小米", "小米集团", "xiaomi"], ["HK1810", "HK_EQUITY"]),
  identity("泡泡玛特", ["泡泡玛特", "popmart"], ["POPMART", "HK_EQUITY"]),
  identity("美团", ["美团", "meituan"], ["MEITUAN", "HK_EQUITY"]),
  identity("快手", ["快手", "kuaishou"], ["KUAISHOU", "HK_EQUITY"]),
  identity("中际旭创", ["中际旭创", "zhongji"], ["ZHONGJI", "CN_EQUITY"]),
  identity("兆易创新", ["兆易创新", "gigadev"], ["GIGADEV", "CN_EQUITY"]),
  identity("MiniMax", ["minimax"], ["MINIMAX", "HK_EQUITY"]),
  {
    name: "阿里巴巴",
    aliases: ["阿里巴巴", "alibaba"],
    targets: [
      { baseAsset: "BABA", market: "EQUITY" },
      { baseAsset: "HK9988", market: "HK_EQUITY" },
    ],
  },
];

export function resolveBinanceInstrument(
  query: TradfiPerpetualQuery,
  symbols: BinanceInstrument[],
): BinanceInstrument {
  const input = query.symbol?.trim() ?? "";
  const marketHints = detectMarketHints(query.userQuery);
  const queryIdentities = identitiesReferencedBy(query.userQuery);
  const inputWasWrittenByUser = containsNormalized(query.userQuery, input);

  if (queryIdentities.length > 1 && !inputWasWrittenByUser) {
    throw ambiguousError(
      input || query.userQuery,
      queryIdentities.flatMap((item) => availableForIdentity(item, symbols)),
      "原始问句包含多个公司，请按标的分别调用工具",
    );
  }

  // The verbatim user query is authoritative. If the model invented a ticker,
  // resolve the company name plus market intent instead of trusting that guess.
  if (queryIdentities.length === 1 && !inputWasWrittenByUser) {
    return assertEligible(selectIdentity(queryIdentities[0]!, marketHints, symbols));
  }

  const inputIdentity = identityForExactAlias(input);
  if (inputIdentity) {
    return assertEligible(selectIdentity(inputIdentity, marketHints, symbols));
  }

  const directMatches = symbols.filter((candidate) => matchesInput(candidate, input));
  if (directMatches.length > 0) {
    return assertEligible(selectMatches(input, directMatches, marketHints));
  }

  if (queryIdentities.length === 1) {
    return assertEligible(selectIdentity(queryIdentities[0]!, marketHints, symbols));
  }

  throw new TradfiPerpetualProviderError(
    "NO_DATA",
    `Binance does not list a matching USDⓈ-M instrument for "${input}". Pass the company name or exact listed code from the original request; do not invent or translate a ticker.`,
  );
}

function identity(
  name: string,
  aliases: readonly string[],
  target: readonly [string, TradfiPerpetualUnderlyingType],
): InstrumentIdentity {
  return {
    name,
    aliases,
    targets: [{ baseAsset: target[0], market: target[1] }],
  };
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s._\-/]+/g, "");
}

function containsNormalized(text: string, value: string): boolean {
  const needle = normalize(value);
  return needle.length > 0 && normalize(text).includes(needle);
}

function identityForExactAlias(input: string): InstrumentIdentity | undefined {
  const key = normalize(input);
  return INSTRUMENT_IDENTITIES.find((item) =>
    item.aliases.some((alias) => normalize(alias) === key),
  );
}

function identitiesReferencedBy(query: string): InstrumentIdentity[] {
  return INSTRUMENT_IDENTITIES.filter((item) =>
    item.aliases.some((alias) => containsAlias(query, alias)),
  );
}

function containsAlias(query: string, alias: string): boolean {
  if ([...alias].some((character) => character.charCodeAt(0) > 127)) return normalize(query).includes(normalize(alias));
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(query);
}

function detectMarketHints(query: string): Set<TradfiPerpetualUnderlyingType> {
  const markets = new Set<TradfiPerpetualUnderlyingType>();
  if (/美股|美国(?:股票|上市)|纳斯达克|纽交所|\b(?:nyse|nasdaq|us_equity)\b/i.test(query)) {
    markets.add("EQUITY");
  }
  if (/港股|香港(?:股票|上市)|联交所|\bhk(?:_equity|\d+)\b/i.test(query)) {
    markets.add("HK_EQUITY");
  }
  if (/a\s*股|沪股|深股|科创板|创业板|上交所|深交所|\bcn_equity\b/i.test(query)) {
    markets.add("CN_EQUITY");
  }
  if (/韩股|韩国(?:股票|上市)|\bkr_equity\b/i.test(query)) markets.add("KR_EQUITY");
  return markets;
}

function availableForIdentity(
  identityValue: InstrumentIdentity,
  symbols: BinanceInstrument[],
): BinanceInstrument[] {
  return identityValue.targets.flatMap((target) =>
    symbols.filter(
      (candidate) =>
        candidate.baseAsset.toUpperCase() === target.baseAsset &&
        candidate.underlyingType === target.market,
    ),
  );
}

function selectIdentity(
  identityValue: InstrumentIdentity,
  marketHints: Set<TradfiPerpetualUnderlyingType>,
  symbols: BinanceInstrument[],
): BinanceInstrument {
  const available = availableForIdentity(identityValue, symbols);
  const matches = filterByMarket(available, marketHints);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw ambiguousError(identityValue.name, matches);
  if (marketHints.size > 0 && available.length > 0) {
    throw marketMismatchError(identityValue.name, marketHints, available);
  }
  throw new TradfiPerpetualProviderError(
    "NO_DATA",
    `Binance catalog has no listed equity-linked TradFi perpetual for ${identityValue.name}${formatMarkets(marketHints)}.`,
  );
}

function selectMatches(
  input: string,
  matches: BinanceInstrument[],
  marketHints: Set<TradfiPerpetualUnderlyingType>,
): BinanceInstrument {
  const marketMatches = filterByMarket(matches, marketHints);
  if (marketMatches.length === 1) return marketMatches[0]!;
  if (marketMatches.length > 1) throw ambiguousError(input, marketMatches);
  if (marketHints.size > 0) throw marketMismatchError(input, marketHints, matches);
  if (matches.length === 1) return matches[0]!;
  throw ambiguousError(input, matches);
}

function filterByMarket(
  instruments: BinanceInstrument[],
  marketHints: Set<TradfiPerpetualUnderlyingType>,
): BinanceInstrument[] {
  return marketHints.size === 0
    ? instruments
    : instruments.filter((item) =>
        marketHints.has(item.underlyingType as TradfiPerpetualUnderlyingType),
      );
}

function matchesInput(instrument: BinanceInstrument, input: string): boolean {
  const inputKeys = inputLookupKeys(input);
  return catalogLookupKeys(instrument).some((key) => inputKeys.has(key));
}

function inputLookupKeys(input: string): Set<string> {
  const keys = new Set([stripUsdt(normalize(input))]);
  const hkMatch = input.trim().match(/^(?:hk)?0*(\d{1,5})(?:\.hk)?$/i);
  if (hkMatch) {
    const digits = String(Number(hkMatch[1]));
    keys.add(digits);
    keys.add(`hk${digits}`);
  }
  const exchangeSuffix = input.trim().match(/^(\d{6})\.(?:sh|sz|bj)$/i);
  if (exchangeSuffix) keys.add(exchangeSuffix[1]!);
  return keys;
}

function catalogLookupKeys(instrument: BinanceInstrument): string[] {
  const keys = [instrument.symbol, instrument.pair ?? "", instrument.baseAsset]
    .map((value) => stripUsdt(normalize(value)))
    .filter(Boolean);
  if (instrument.underlyingType === "HK_EQUITY") {
    const match = instrument.baseAsset.match(/^HK0*(\d{1,5})$/i);
    if (match) {
      const digits = String(Number(match[1]));
      keys.push(digits, `hk${digits}`);
    }
  }
  if (instrument.underlyingType === "CN_EQUITY") {
    const match = instrument.baseAsset.match(/^(?:CN)?(\d{6})$/i);
    if (match) keys.push(match[1]!);
  }
  return [...new Set(keys)];
}

function stripUsdt(value: string): string {
  return value.endsWith("usdt") ? value.slice(0, -4) : value;
}

function assertEligible(instrument: BinanceInstrument): BinanceInstrument {
  if (
    instrument.contractType !== "TRADIFI_PERPETUAL" ||
    !isEligibleUnderlyingType(instrument.underlyingType) ||
    instrument.quoteAsset !== "USDT"
  ) {
    throw new TradfiPerpetualProviderError(
      "UNSUPPORTED_INSTRUMENT_CLASS",
      `${instrument.symbol} is not an eligible Binance equity-linked TradFi perpetual. Crypto, commodity, and PREMARKET contracts are intentionally excluded.`,
    );
  }
  return instrument;
}

function ambiguousError(
  input: string,
  matches: BinanceInstrument[],
  prefix = "匹配到多个 Binance 股票永续标的",
): TradfiPerpetualProviderError {
  const candidates = matches.map(formatCandidate).join("、") || "无可用候选";
  return new TradfiPerpetualProviderError(
    "AMBIGUOUS_INSTRUMENT",
    `${prefix}: "${input}" → ${candidates}。请指定市场或精确 venue symbol。`,
  );
}

function marketMismatchError(
  input: string,
  markets: Set<TradfiPerpetualUnderlyingType>,
  available: BinanceInstrument[],
): TradfiPerpetualProviderError {
  return new TradfiPerpetualProviderError(
    "MARKET_MISMATCH",
    `"${input}" 与原始问句指定市场 ${[...markets].join("/")} 不一致；Binance 可用候选为 ${available.map(formatCandidate).join("、")}。请保留用户市场意图，不要跨上市地替换。`,
  );
}

function formatCandidate(instrument: BinanceInstrument): string {
  const market = isEligibleUnderlyingType(instrument.underlyingType)
    ? instrument.underlyingType === "EQUITY"
      ? "US_EQUITY"
      : instrument.underlyingType
    : instrument.underlyingType;
  return `${instrument.symbol} (${market})`;
}

function formatMarkets(markets: Set<TradfiPerpetualUnderlyingType>): string {
  return markets.size > 0 ? ` in ${[...markets].join("/")}` : "";
}
