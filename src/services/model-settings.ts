export interface ModelSettingsInput { api: "openai-completions" | "openai-responses" | "anthropic-messages"; baseUrl: string; modelId: string; apiKey: string; reasoning: boolean; contextWindow: number; maxTokens: number; secUserAgent?: string }
export interface ModelSettingsView { configured: boolean; model: Omit<ModelSettingsInput, "apiKey"> | null; auxiliary: "inherit-main" }
export async function requestModelSettings(method: "GET" | "POST" | "DELETE", input?: ModelSettingsInput): Promise<ModelSettingsView> {
  const response = await fetch("/fin-core/api/model", { method, credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(40000), headers: { "Content-Type": "application/json" }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "模型设置暂不可用，请先连接 AURORA 本机服务。");
  if (!data || typeof data !== "object" || !("configured" in data)) throw new Error("模型配置返回格式无效。");
  return data as ModelSettingsView;
}
