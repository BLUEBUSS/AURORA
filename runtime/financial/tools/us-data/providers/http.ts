import { ProxyAgent, fetch as undiciFetch } from "undici";
import { UsDataProviderError } from "../errors.js";

export type UsDataFetch = typeof fetch;

interface UsDataFetchOptions {
  proxyUrl?: string;
  env?: Record<string, string | undefined>;
}

interface UsDataRequestOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 250;

export function createUsDataFetch(options: UsDataFetchOptions = {}): UsDataFetch {
  const env = options.env ?? process.env;
  const proxyUrl =
    options.proxyUrl ?? env.US_DATA_PROXY ?? env.HTTPS_PROXY ?? env.HTTP_PROXY ?? env.ALL_PROXY;
  if (!proxyUrl) return globalThis.fetch;

  const dispatcher = new ProxyAgent(proxyUrl);
  return ((input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
    undiciFetch(input as string | URL, {
      ...(init as Record<string, unknown>),
      dispatcher,
    }) as unknown as Promise<Response>) as UsDataFetch;
}

export async function requestJson<T>(
  fetchImpl: UsDataFetch,
  url: URL,
  init?: RequestInit,
  options: UsDataRequestOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  const sleep =
    options.sleep ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, init, timeoutMs);
      if (!response.ok) throw responseError(response, url);
      return (await response.json()) as T;
    } catch (error) {
      const providerError = normalizeRequestError(error, url);
      if (attempt === maxAttempts || !isRetryable(providerError)) throw providerError;

      const requestedDelay = providerError.details.retryAfterMs ?? retryDelayMs * attempt;
      await sleep(Math.min(requestedDelay, 5_000));
    }
  }

  throw new UsDataProviderError("UPSTREAM_UNAVAILABLE", `Unable to reach ${url.host}.`);
}

export function setQuery(url: URL, params: Record<string, string | number | undefined>): URL {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

export class MemoryJsonCache {
  private readonly values = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs = 5 * 60_000, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async getOrSet<T>(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value as T;
    const value = await load();
    this.values.set(key, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }
}

async function fetchWithTimeout(
  fetchImpl: UsDataFetch,
  url: URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init?.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timeout = setTimeout(
    () => controller.abort(new DOMException("US data provider request timed out", "AbortError")),
    timeoutMs,
  );
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new UsDataProviderError("TIMEOUT", `Request timed out: ${url.host}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function normalizeRequestError(error: unknown, url: URL): UsDataProviderError {
  if (error instanceof UsDataProviderError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new UsDataProviderError("TIMEOUT", `Request timed out: ${url.host}`);
  }
  return new UsDataProviderError(
    "UPSTREAM_UNAVAILABLE",
    `Unable to reach ${url.host}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

function responseError(response: Response, url: URL): UsDataProviderError {
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1_000 : undefined;
  if (response.status === 401 || response.status === 403) {
    return new UsDataProviderError(
      "AUTHENTICATION_FAILED",
      `${url.host} rejected the API credentials.`,
    );
  }
  if (response.status === 429) {
    return new UsDataProviderError("RATE_LIMITED", `${url.host} rate limit exceeded.`, {
      retryAfterMs,
    });
  }
  if (response.status >= 500) {
    return new UsDataProviderError(
      "UPSTREAM_UNAVAILABLE",
      `${url.host} returned HTTP ${response.status}.`,
    );
  }
  return new UsDataProviderError("UPSTREAM_ERROR", `${url.host} returned HTTP ${response.status}.`);
}

function isRetryable(error: UsDataProviderError): boolean {
  return (
    error.code === "RATE_LIMITED" ||
    error.code === "TIMEOUT" ||
    error.code === "UPSTREAM_UNAVAILABLE"
  );
}
