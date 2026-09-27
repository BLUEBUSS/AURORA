export type UsDataErrorCode =
  | "INVALID_ARGUMENT"
  | "CONFIGURATION_MISSING"
  | "NO_DATA"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "AUTHENTICATION_FAILED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_ERROR";

export interface UsDataErrorDetails {
  retryAfterMs?: number;
}

export class UsDataProviderError extends Error {
  constructor(
    readonly code: UsDataErrorCode,
    message: string,
    readonly details: UsDataErrorDetails = {},
  ) {
    super(message);
    this.name = "UsDataProviderError";
  }
}

export function toUsDataProviderError(error: unknown): UsDataProviderError {
  if (error instanceof UsDataProviderError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new UsDataProviderError("TIMEOUT", "US data provider request timed out");
  }
  const message = error instanceof Error ? error.message : String(error);
  return new UsDataProviderError("UPSTREAM_ERROR", message);
}
