import { beforeEach, describe, expect, it, vi } from "vitest";
import { gateway } from "./gateway";
import { fetchProvenanceData, resolveProvenance } from "./provenance";

vi.mock("./gateway", () => ({ gateway: { request: vi.fn() } }));
const request = vi.mocked(gateway.request);
const entry = { provenanceId: "p_1a2b", sessionKey: "session-a", toolName: "web_fetch", toolCallId: "call-a", summary: { kind: "page", title: "官方资料", url: "https://example.test", excerpt: "真实返回的摘要" } };

beforeEach(() => request.mockReset());

describe("provenance Gateway contract", () => {
  it("calls resolve with the exact session and ID and reads the direct payload", async () => {
    request.mockResolvedValue(entry);
    expect(await resolveProvenance("session-a", "p_1a2b")).toMatchObject(entry);
    expect(request).toHaveBeenCalledExactlyOnceWith("fin-core.provenance.resolve", { sessionKey: "session-a", provenanceId: "p_1a2b" });
  });
  it("does not reuse an entry across sessions", async () => {
    request.mockResolvedValue(entry);
    await resolveProvenance("session-a", "p_1a2b");
    await resolveProvenance("session-b", "p_1a2b");
    expect(request).toHaveBeenLastCalledWith("fin-core.provenance.resolve", { sessionKey: "session-b", provenanceId: "p_1a2b" });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed or mismatched entries instead of manufacturing details", async () => {
    request.mockResolvedValue({ entry });
    await expect(resolveProvenance("session-a", "p_1a2b")).rejects.toThrow("格式不完整");
    request.mockResolvedValue({ ...entry, provenanceId: "p_5c6d" });
    await expect(resolveProvenance("session-a", "p_1a2b")).rejects.toThrow("格式不完整");
  });
  it("rejects invalid references before making a request", async () => {
    await expect(resolveProvenance("", "p_1a2b")).rejects.toThrow("有效");
    await expect(resolveProvenance("session-a", "p_abcd")).rejects.toThrow("有效");
    expect(request).not.toHaveBeenCalled();
  });
  it("reads persisted records and the backend raw-text fallback", async () => {
    request.mockResolvedValue({ records: [{ value: 7 }], totalRows: 1, filename: "source.json" });
    expect(await fetchProvenanceData("session-a", "p_1a2b")).toEqual({ records: [{ value: 7 }], totalRows: 1, filename: "source.json" });
    expect(request).toHaveBeenLastCalledWith("fin-core.provenance.fetchData", { sessionKey: "session-a", provenanceId: "p_1a2b" });
    request.mockResolvedValue({ raw: "source text", records: null, totalRows: 0 });
    expect(await fetchProvenanceData("session-a", "p_1a2b")).toEqual({ raw: "source text", records: null, totalRows: 0 });
  });
  it("propagates real lookup errors and rejects malformed records", async () => {
    request.mockRejectedValue(new Error("provenance p_1a2b not found"));
    await expect(resolveProvenance("session-a", "p_1a2b")).rejects.toThrow("not found");
    request.mockResolvedValue({ records: "not an array" });
    await expect(fetchProvenanceData("session-a", "p_1a2b")).rejects.toThrow("格式不正确");
  });
});
