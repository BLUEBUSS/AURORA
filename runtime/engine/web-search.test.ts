import { expect, it, vi } from "vitest";
import { modelDefinition } from "../models/store.js";
import { searchEndpoint, webSearchTool } from "./web-search.js";

const configured = { model: modelDefinition({ api: "openai-completions", baseUrl: "https://api.moonshot.cn/v1", modelId: "kimi-k3" }), apiKey: "fixture-search-key" };
it("only reuses credentials for the matching official provider", () => {
  expect(searchEndpoint(configured)).toBe("https://api.moonshot.cn/v1/tools/search");
  for (const baseUrl of ["https://proxy.invalid/v1", "https://api.moonshot.cn.evil.invalid/v1", "https://api.moonshot.cn:8443/v1", "https://api.moonshot.cn/other"]) {
    expect(searchEndpoint({ ...configured, model: { ...configured.model, baseUrl } })).toBeUndefined();
  }
});
it("returns bounded source links and persists citation evidence", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ search_results: [
    { title: "Official results", url: "https://investor.example/results", snippet: "Public evidence", date: "2026-09-01" },
    { title: "Unsafe", url: "javascript:alert(1)" },
  ] })));
  const save = vi.fn().mockResolvedValue("p_fixture");
  const tool = webSearchTool(configured, save, request)!;
  const result = await tool.execute("search-1", { query: "company results", count: 3 });
  expect(request.mock.calls[0][0]).toBe("https://api.moonshot.cn/v1/tools/search");
  expect(request.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { Authorization: "Bearer fixture-search-key" } });
  expect(save.mock.calls[0][3]).toHaveLength(1);
  expect(JSON.stringify(result)).toContain("[[p_fixture]]");
  expect(JSON.stringify(result)).not.toContain(configured.apiKey);
  expect(JSON.stringify(result)).not.toContain("javascript:");
});
it("never echoes provider failures or reports an unsuccessful search as evidence", async () => {
  const save = vi.fn();
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret provider details", { status: 401 }));
  await expect(webSearchTool(configured, save, request)!.execute("id", { query: "results" })).rejects.toThrow("联网检索失败");
  expect(save).not.toHaveBeenCalled();
});
it("stops before persisting aborted searches and rejects malformed arguments", async () => {
  const save = vi.fn();
  const controller = new AbortController(); controller.abort();
  const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("aborted"));
  const tool = webSearchTool(configured, save, request)!;
  await expect(tool.execute("id", { query: "results" }, controller.signal)).rejects.toThrow("Research stopped");
  await expect(tool.execute("id", { query: "", count: 20 })).rejects.toThrow("搜索词或条数无效");
  expect(save).not.toHaveBeenCalled();
});
