import { CryptoProviderError } from "../crypto/errors.js";

export type TradfiPerpetualErrorCode =
  | "INVALID_ARGUMENT"
  | "VENUE_INTENT_REQUIRED"
  | "UNSUPPORTED_INSTRUMENT_CLASS"
  | "AMBIGUOUS_INSTRUMENT"
  | "MARKET_MISMATCH"
  | "NO_DATA"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "AUTHENTICATION_FAILED"
  | "NETWORK_UNAVAILABLE"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_ERROR";

export interface TradfiPerpetualErrorDetails {
  retryAfterMs?: number;
  networkStage?: "proxy" | "dns" | "connect" | "tls" | "unknown";
  causeCode?: string;
  upstreamResponded?: boolean;
  httpStatus?: number;
}

export class TradfiPerpetualProviderError extends Error {
  constructor(
    readonly code: TradfiPerpetualErrorCode,
    message: string,
    readonly details: TradfiPerpetualErrorDetails = {},
  ) {
    super(message);
    this.name = "TradfiPerpetualProviderError";
  }
}

export function toTradfiPerpetualProviderError(error: unknown): TradfiPerpetualProviderError {
  if (error instanceof TradfiPerpetualProviderError) return error;
  if (error instanceof CryptoProviderError) {
    return new TradfiPerpetualProviderError(error.code, error.message, error.details);
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new TradfiPerpetualProviderError(
      "TIMEOUT",
      "Binance TradFi perpetual request timed out.",
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new TradfiPerpetualProviderError("UPSTREAM_ERROR", message);
}
