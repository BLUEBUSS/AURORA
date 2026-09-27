import { Type, type TSchema } from "typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createDefaultCryptoProvider, createCryptoMarketDataTool, createCryptoDerivativesDataTool, createCryptoOptionsDataTool, createCryptoDefiDataTool, createCryptoAssetDataTool, createCryptoSentimentDataTool } from "../financial/tools/crypto/index.js";
import { createDefaultUsDataProvider, createUsEquityFilingsTool, createUsEquityFundamentalsTool, createUsEquityMarketDataTool, createUsMacroIndicatorDataTool } from "../financial/tools/us-data/index.js";
import { createTradfiPerpetualDataTool, BinanceTradfiPerpetualProvider } from "../financial/tools/tradfi-perpetual/index.js";
import { popRawRecords } from "../financial/raw-data-stash.js";
import type { DataEnvironment } from "../data-sources/index.js";

export type SaveEvidence = (toolName: string, callId: string, args: unknown, records: Record<string, unknown>[], meta?: Record<string, unknown>) => Promise<string>;
function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Research stopped."));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    pending.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
export function financialTools(sessionKey: string, saveEvidence: SaveEvidence, secUserAgent?: string, dataEnvironment?: DataEnvironment): AgentTool<TSchema, unknown>[] {
  const api = { logger: { error: (_message: string) => {} } };
  // An explicit empty environment prevents accidental reuse of developer data keys.
  // Only the current user's explicitly enabled data settings are supplied to providers.
  const crypto = createDefaultCryptoProvider({});
  const us = createDefaultUsDataProvider(dataEnvironment ?? (secUserAgent ? { SEC_EDGAR_USER_AGENT: secUserAgent } : {}));
  const factories = [
    createCryptoMarketDataTool(api, crypto), createCryptoDerivativesDataTool(api, crypto),
    createCryptoOptionsDataTool(api, crypto), createCryptoDefiDataTool(api, crypto),
    createCryptoAssetDataTool(api, crypto), createCryptoSentimentDataTool(api, crypto),
    createUsEquityFilingsTool(api, us), createUsEquityFundamentalsTool(api, us),
    createUsEquityMarketDataTool(api, us), createUsMacroIndicatorDataTool(api, us),
    createTradfiPerpetualDataTool(api, new BinanceTradfiPerpetualProvider({})),
  ];
  return factories.map((factory) => {
    const tool = factory({ sessionKey });
    return {
      name: tool.name, label: tool.label, description: tool.description,
      parameters: Type.Unsafe<Record<string, unknown>>(JSON.parse(JSON.stringify(tool.parameters))),
      execute: async (callId, args, signal) => {
        if (signal?.aborted) throw new Error("Research stopped.");
        const invoke = tool.execute as (id: string, args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
        try {
          const pending = invoke(callId, args);
          void pending.then(() => { if (signal?.aborted) popRawRecords(callId); }, () => popRawRecords(callId));
          const result = await abortable(pending, signal);
          if (signal?.aborted) throw new Error("Research stopped.");
          if (result.isError) {
            let code = "DATA_UNAVAILABLE";
            try { const parsed = JSON.parse(result.content[0]?.text || "{}"); if (typeof parsed.error?.code === "string" && /^[A-Z_]+$/.test(parsed.error.code)) code = parsed.error.code; } catch { /* Keep a safe public error category. */ }
            throw new Error(`${tool.name}: ${code}。请检查网络、地区限制或用户数据源配置。`);
          }
          const raw = popRawRecords(callId);
          if (raw?.records.length) {
            const id = await saveEvidence(tool.name, callId, args, raw.records, raw.meta);
            return { ...result, content: [{ type: "text" as const, text: `来源引用：[[${id}]]\n` }, ...result.content], details: { provenanceId: id } };
          }
          return { ...result, details: {} };
        } finally { popRawRecords(callId); }
      },
    };
  });
}
