export type SourceId = "sec" | "eodhd" | "alpha_vantage" | "fred";
export type SourceAction = "save" | "test" | "enable" | "disable" | "remove";
export interface SourceTest { ok: boolean; code: string; message: string; checkedAt: string }
export interface SourceView { id: SourceId; name: string; description: string; credentialLabel: string; url: string; configured: boolean; enabled: boolean; lastTest?: SourceTest }
export interface SourcesView { sources: SourceView[]; test?: SourceTest }
export async function requestDataSources(input?: { id: SourceId; action: SourceAction; credential?: string }): Promise<SourcesView> {
  const response = await fetch("/fin-core/api/data-sources", { method: input ? "POST" : "GET", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(25000), headers: { "Content-Type": "application/json" }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "数据源设置暂不可用，请检查本机连接。");
  if (!data || !Array.isArray(data.sources)) throw new Error("数据源设置返回格式无效。");
  return data as SourcesView;
}
