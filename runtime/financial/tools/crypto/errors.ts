export type CryptoErrorCode =
  | "INVALID_ARGUMENT"
  | "NO_DATA"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "AUTHENTICATION_FAILED"
  | "NETWORK_UNAVAILABLE"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_ERROR";

export interface CryptoErrorDetails {
  retryAfterMs?: number;
  networkStage?: "proxy" | "dns" | "connect" | "tls" | "unknown";
  causeCode?: string;
  upstreamResponded?: boolean;
  httpStatus?: number;
}

export class CryptoProviderError extends Error {
  constructor(
    readonly code: CryptoErrorCode,
    message: string,
    readonly details: CryptoErrorDetails = {},
  ) {
    super(message);
    this.name = "CryptoProviderError";
  }
}

export function toCryptoProviderError(error: unknown): CryptoProviderError {
  if (error instanceof CryptoProviderError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new CryptoProviderError("TIMEOUT", "Crypto data provider request timed out");
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CryptoProviderError("UPSTREAM_ERROR", message);
}
