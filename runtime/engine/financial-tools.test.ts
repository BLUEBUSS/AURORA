import { afterEach, expect, it, vi } from "vitest";
import { financialTools } from "./financial-tools.js";
import { researchTools } from "./tools.js";
import type { WorkspaceFiles } from "../files/index.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("uses explicitly configured data keys, never an inherited developer key", async () => {
  vi.stubEnv("FRED_API_KEY", "developer-key-must-not-be-used");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ observations: [{ date: "2026-01-01", value: "312.2" }] })));
  vi.stubGlobal("fetch", fetcher);
  const absent = financialTools("fixture", async () => "p_fixture").find(t => t.name === "macro_indicator_data")!;
  await expect(absent.execute("missing", { indicator: "cpi_headline" })).rejects.toThrow("CONFIGURATION_MISSING");
  expect(fetcher).not.toHaveBeenCalled();
  const configured = financialTools("fixture", async () => "p_fixture", undefined, { FRED_API_KEY: "user-fred-key" }).find(t => t.name === "macro_indicator_data")!;
  const result = await configured.execute("configured", { indicator: "cpi_headline" });
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("api_key")).toBe("user-fred-key");
  expect(JSON.stringify(result)).not.toContain("user-fred-key");
  expect(JSON.stringify(result)).toContain("312.2");
});
it("exposes granular enabled capability flags without revealing credentials", async () => {
  const tools = researchTools({ sessionKey: "fixture", files: {} as WorkspaceFiles, readSkill: () => "", spawn: async () => { throw new Error("unused"); }, child: true, saveEvidence: async () => "p_fixture", dataEnvironment: { FRED_API_KEY: "fixture-sensitive" } });
  const tool = tools.find(t => t.name === "data_capability_status")!;
  const result = JSON.stringify(await tool.execute("cap", {}));
  expect(result).toContain("configured_unverified"); expect(result).toContain("usMacro"); expect(result).not.toContain("fixture-sensitive");
});

it("registers the real financial factories and marks missing configuration as tool failure", async () => {
  const tools = financialTools("fixture-session", async () => "p_fixture");
  expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["us_equity_filings", "tradfi_perpetual_data", "crypto_market_data"]));
  const filings = tools.find((tool) => tool.name === "us_equity_filings")!;
  await expect(filings.execute("fixture-call", { symbol: "NVDA" })).rejects.toThrow("CONFIGURATION_MISSING");
});
