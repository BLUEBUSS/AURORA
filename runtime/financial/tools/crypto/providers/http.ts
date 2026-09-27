import { ProxyAgent, fetch as undiciFetch } from "undici";
import { CryptoProviderError } from "../errors.js";

export type CryptoFetch = typeof fetch;

interface CryptoFetchOptions {
  proxyUrl?: string;
  env?: Record<string, string | undefined>;
}

interface CryptoRequestOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 250;

export function createCryptoFetch(options: CryptoFetchOptions = {}): CryptoFetch {
  const env = options.env ?? process.env;
  const proxyUrl =
    options.proxyUrl ?? env.CRYPTO_PROXY ?? env.HTTPS_PROXY ?? env.HTTP_PROXY ?? env.ALL_PROXY;
  if (!proxyUrl) return globalThis.fetch;

  const dispatcher = new ProxyAgent(proxyUrl);
  return ((input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
    undiciFetch(input as string | URL, {
      ...(init as Record<string, unknown>),
      dispatcher,
    }) as unknown as Promise<Response>) as CryptoFetch;
}

export async function requestJson<T>(
  fetchImpl: CryptoFetch,
  url: URL,
  init?: RequestInit,
  options: CryptoRequestOptions = {},
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

  throw new CryptoProviderError("UPSTREAM_UNAVAILABLE", `Unable to reach ${url.host}.`);
}

async function fetchWithTimeout(
  fetchImpl: CryptoFetch,
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
    () => controller.abort(new DOMException("Crypto provider request timed out", "AbortError")),
    timeoutMs,
  );
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new CryptoProviderError("TIMEOUT", `Request timed out: ${url.host}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function normalizeRequestError(error: unknown, url: URL): CryptoProviderError {
  if (error instanceof CryptoProviderError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new CryptoProviderError("TIMEOUT", `Request timed out: ${url.host}`, {
      networkStage: "connect",
      upstreamResponded: false,
    });
  }
  const diagnostic = classifyNetworkFailure(error);
  return new CryptoProviderError(
    "NETWORK_UNAVAILABLE",
    `Network route to ${url.host} failed: ${diagnostic.message}. This does not confirm an upstream outage.`,
    {
      networkStage: diagnostic.stage,
      causeCode: diagnostic.causeCode,
      upstreamResponded: false,
    },
  );
}

function classifyNetworkFailure(error: unknown): {
  stage: "proxy" | "dns" | "connect" | "tls" | "unknown";
  causeCode?: string;
  message: string;
} {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current && chain.length < 6) {
    chain.push(current);
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  const causeCode = chain
    .map((item) =>
      typeof item === "object" && item && "code" in item
        ? String((item as { code?: unknown }).code ?? "")
        : "",
    )
    .find(Boolean);
  const diagnosticText = chain
    .map((item) => (item instanceof Error ? item.message : String(item)))
    .join(" ");
  const isLoopback = /(?:127(?:\.\d{1,3}){3}|localhost|\[?::1\]?)/i.test(diagnosticText);

  if (causeCode === "ECONNREFUSED" && isLoopback) {
    return {
      stage: "proxy",
      causeCode,
      message:
        "the configured local proxy listener refused the connection; verify that the Windows proxy application and port are running",
    };
  }
  if (causeCode === "ENOTFOUND" || causeCode === "EAI_AGAIN") {
    return {
      stage: "dns",
      causeCode,
      message: "DNS resolution failed before the upstream could reply; check DNS and proxy routing",
    };
  }
  if (causeCode === "UND_ERR_CONNECT_TIMEOUT" || causeCode === "ETIMEDOUT") {
    return {
      stage: "connect",
      causeCode,
      message:
        "the connection timed out before the upstream replied; check the proxy route and direct connectivity",
    };
  }
  if (causeCode === "ECONNREFUSED" || causeCode === "ECONNRESET") {
    return {
      stage: "connect",
      causeCode,
      message:
        "the connection failed before the upstream replied; check the selected network route",
    };
  }
  if (causeCode?.startsWith("CERT_") || causeCode?.includes("TLS")) {
    return {
      stage: "tls",
      causeCode,
      message:
        "TLS negotiation failed before an HTTP response; check certificates and proxy interception",
    };
  }
  return {
    stage: "unknown",
    causeCode,
    message:
      "no HTTP response was received; check the configured proxy, Windows system route, DNS, and direct connectivity",
  };
}

function responseError(response: Response, url: URL): CryptoProviderError {
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1_000 : undefined;
  if (response.status === 401 || response.status === 403) {
    return new CryptoProviderError(
      "AUTHENTICATION_FAILED",
      `${url.host} rejected the API credentials.`,
      { upstreamResponded: true, httpStatus: response.status },
    );
  }
  if (response.status === 429) {
    return new CryptoProviderError("RATE_LIMITED", `${url.host} rate limit exceeded.`, {
      retryAfterMs,
      upstreamResponded: true,
      httpStatus: response.status,
    });
  }
  if (response.status >= 500) {
    return new CryptoProviderError(
      "UPSTREAM_UNAVAILABLE",
      `${url.host} returned HTTP ${response.status}.`,
      { upstreamResponded: true, httpStatus: response.status },
    );
  }
  return new CryptoProviderError(
    "UPSTREAM_ERROR",
    `${url.host} returned HTTP ${response.status}.`,
    {
      upstreamResponded: true,
      httpStatus: response.status,
    },
  );
}

function isRetryable(error: CryptoProviderError): boolean {
  return (
    error.code === "RATE_LIMITED" ||
    error.code === "TIMEOUT" ||
    error.code === "NETWORK_UNAVAILABLE" ||
    error.code === "UPSTREAM_UNAVAILABLE"
  );
}

export function setQuery(url: URL, params: Record<string, string | number | undefined>): URL {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}
