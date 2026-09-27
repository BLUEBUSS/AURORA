import { expect, it, vi } from "vitest";
import { createDataProbe } from "./probe.js";

it("checks provider-specific payloads and sends credentials only to the corresponding endpoint", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ observations: [{ date: "2026-01-01", value: "1" }] })));
  const result = await createDataProbe(request)("fred", "fixture-own-key");
  const url = new URL(String(request.mock.calls[0][0]));
  expect(url.origin).toBe("https://api.stlouisfed.org");
  expect(url.searchParams.get("api_key")).toBe("fixture-own-key");
  expect(request.mock.calls[0][1]?.redirect).toBe("error");
  expect(result.ok).toBe(true); expect(JSON.stringify(result)).not.toContain("fixture-own-key");
});
it("does not call an HTML login page a successful data connection", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Login</html>"));
  expect((await createDataProbe(request)("eodhd", "fixture-key")).ok).toBe(false);
});
it("distinguishes quota and access failures without reflecting secret upstream details", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("fixture-secret", { status: 403 })).mockResolvedValueOnce(new Response(JSON.stringify({ Information: "fixture-secret premium entitlement required" })));
  expect(await createDataProbe(request)("fred", "fixture-secret")).toMatchObject({ ok: false, code: "access_denied" });
  const second = await createDataProbe(request)("alpha_vantage", "fixture-secret");
  expect(second).toMatchObject({ ok: false, code: "permission_required" }); expect(JSON.stringify(second)).not.toContain("fixture-secret");
});
