import type { DataProbe, DataSourceId, ProbeResult } from "./catalog.js";

const result = (ok: boolean, code: string, message: string): ProbeResult => ({ ok, code, message, checkedAt: new Date().toISOString() });
export function createDataProbe(request: typeof fetch = fetch): DataProbe {
  return async (id, credential) => {
    const { url, headers } = probeRequest(id, credential);
    try {
      const response = await request(url, { headers, signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) return result(false, "access_denied", "凭据或访问权限被拒绝，请检查账户授权与网络限制。");
        if (response.status === 429) return result(false, "rate_limited", "请求受限，请检查额度并稍后再试。");
        if (response.status === 400) return result(false, "request_rejected", "供应商拒绝请求，请检查凭据和账户配置。");
        return result(false, "upstream_error", "供应商暂未正常响应，请稍后再试。");
      }
      // Keep upstream bodies bounded and never surface raw provider errors or request URLs.
      const reader = response.body?.getReader();
      if (!reader) return result(false, "invalid_response", "供应商未返回数据。");
      const parts: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 4 * 1024 * 1024) return result(false, "invalid_response", "响应超出测试大小限制。"); parts.push(part.value); }
      } finally { await reader.cancel().catch(() => undefined); }
      const body: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
      const object = body && typeof body === "object" ? body as Record<string, unknown> : {};
      if (id === "alpha_vantage" && (object.Information || object.Note || object["Error Message"])) {
        const diagnostic = String(object.Information || object.Note || object["Error Message"]).toLowerCase();
        if (/invalid.*key|key.*invalid/.test(diagnostic)) return result(false, "access_denied", "API Key 无效，请核对供应商账户。");
        if (/premium|subscription|entitlement/.test(diagnostic)) return result(false, "permission_required", "当前账户不具备该数据接口权限。");
        return /limit|quota|frequency|requests per/.test(diagnostic)
          ? result(false, "rate_limited", "供应商返回配额或请求限制，请检查账户后再试。")
          : result(false, "request_rejected", "供应商拒绝当前查询，请检查账户权限与接口配置。");
      }
      const hasData = id === "sec" ? !!(object.filings as { recent?: unknown } | undefined)?.recent
        : id === "fred" ? Array.isArray(object.observations) && object.observations.length > 0
          : id === "eodhd" ? Array.isArray(body) && body.some(row => row && typeof row === "object" && "close" in row)
            : !!object["Time Series (Daily)"] && Object.keys(object["Time Series (Daily)"] as object).length > 0;
      return hasData ? result(true, "ok", "测试通过：已取得样本数据；不代表全部接口权限或实时行情可用。") : result(false, "no_data", "未取得预期样本数据，请核对账户权限或稍后重试。");
    } catch (error) {
      return error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
        ? result(false, "timeout", "连接超时，请检查网络后重试。")
        : result(false, "network_error", "连接或响应读取失败，请检查网络后重试。");
    }
  };
}
function probeRequest(id: DataSourceId, credential: string) {
  let url: URL;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (id === "sec") {
    url = new URL("https://data.sec.gov/submissions/CIK0001045810.json"); headers["User-Agent"] = credential;
  } else if (id === "fred") {
    url = new URL("https://api.stlouisfed.org/fred/series/observations");
    url.search = new URLSearchParams({ api_key: credential, series_id: "CPIAUCSL", file_type: "json", limit: "1", sort_order: "desc" }).toString();
  } else if (id === "eodhd") {
    url = new URL("https://eodhd.com/api/eod/AAPL.US");
    const from = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);
    url.search = new URLSearchParams({ api_token: credential, fmt: "json", period: "d", from }).toString();
  } else {
    url = new URL("https://www.alphavantage.co/query");
    url.search = new URLSearchParams({ apikey: credential, function: "TIME_SERIES_DAILY", symbol: "MSFT", outputsize: "compact" }).toString();
  }
  return { url, headers };
}
