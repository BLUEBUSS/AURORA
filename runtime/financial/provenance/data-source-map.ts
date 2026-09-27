const DATA_SOURCE_LABELS: Record<string, string> = {
  crypto_market_data: "Crypto market data",
  crypto_derivatives_data: "Crypto derivatives data",
  crypto_options_data: "Crypto options data",
  crypto_dex_data: "DEX data",
  crypto_defi_data: "DeFi data",
  crypto_onchain_data: "On-chain data",
  crypto_asset_data: "Crypto asset data",
  crypto_sentiment_data: "Crypto sentiment data",
  tradfi_perpetual_data: "Binance equity-linked perpetual data",
  macro_indicator_data: "US macro data",
  us_equity_market_data: "US equity market data",
  us_equity_filings: "SEC filings",
  us_equity_fundamentals: "SEC fundamentals",
  kline_analysis: "Standardized K-line market series",
  market_pulse: "X market intelligence",
};

export function resolve(toolName: string): string {
  return DATA_SOURCE_LABELS[toolName] ?? toolName;
}
