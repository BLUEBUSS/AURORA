import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProvenance, fetchProvenanceData, type ProvenanceEntry } from "../../services/provenance";
import { ProvenanceReference } from "./ProvenanceReference";

vi.mock("../../services/provenance", () => ({ resolveProvenance: vi.fn(), fetchProvenanceData: vi.fn() }));
vi.mock("../ui", () => ({ Modal: ({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) => <div role="dialog" aria-label={title}><button onClick={onClose}>关闭对话框</button>{children}</div> }));

const reference = { provenanceId: "p_1a2b", index: 1, fields: ["营收"] };
const entry: ProvenanceEntry = { provenanceId: "p_1a2b", sessionKey: "session-a", toolName: "financial_data", toolCallId: "call-a", label: "财务数据", subject: "QA company", dataSource: "公司公告", summary: { kind: "table", headers: ["期间", "营收"], rows: [["2026Q1", 100]], totalRows: 1 }, persistedFilePath: "private/source.json" };

beforeEach(() => { vi.mocked(resolveProvenance).mockReset(); vi.mocked(fetchProvenanceData).mockReset(); });
afterEach(cleanup);

describe("ProvenanceReference", () => {
  it("only loads on click, shows actual metadata, and fetches full data on demand", async () => {
    vi.mocked(resolveProvenance).mockResolvedValue(entry);
    vi.mocked(fetchProvenanceData).mockResolvedValue({ records: [{ period: "2026Q1", revenue: 100 }], totalRows: 1 });
    render(<ProvenanceReference reference={reference} sessionKey="session-a" />);
    expect(resolveProvenance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看来源 1" }));
    await screen.findByRole("dialog", { name: "来源详情" });
    await screen.findByText("公司公告");
    expect(screen.getByRole("columnheader", { name: "营收" }).className).toBe("is-cited-field");
    expect(screen.queryByText("private/source.json")).toBeNull();
    expect(fetchProvenanceData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "展开完整数据" }));
    await screen.findByRole("region", { name: "完整来源数据" });
    expect(fetchProvenanceData).toHaveBeenCalledExactlyOnceWith("session-a", "p_1a2b");
  });
  it("shows an error and retries without inventing a source", async () => {
    vi.mocked(resolveProvenance).mockRejectedValueOnce(new Error("来源记录未找到")).mockResolvedValueOnce(entry);
    render(<ProvenanceReference reference={reference} sessionKey="session-a" />);
    fireEvent.click(screen.getByRole("button", { name: "查看来源 1" }));
    expect((await screen.findByRole("alert")).textContent).toBe("来源记录未找到");
    expect(screen.queryByText("公司公告")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^重试$/ }));
    await screen.findByText("公司公告");
  });
  it("ignores a late lookup after the parent switches sessions", async () => {
    let finishFirst!: (value: ProvenanceEntry) => void;
    vi.mocked(resolveProvenance).mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; })).mockResolvedValueOnce({ ...entry, sessionKey: "session-b", subject: "Current company" });
    const view = render(<ProvenanceReference reference={reference} sessionKey="session-a" />);
    fireEvent.click(screen.getByRole("button", { name: "查看来源 1" }));
    view.rerender(<ProvenanceReference reference={reference} sessionKey="session-b" />);
    await screen.findByText("Current company");
    finishFirst(entry);
    await waitFor(() => expect(screen.queryByText("QA company")).toBeNull());
  });
  it("renders hostile source text inertly and does not expose unsafe links", async () => {
    vi.mocked(resolveProvenance).mockResolvedValue({ ...entry, persistedFilePath: undefined, summary: { kind: "search", results: [{ title: "<script>alert(1)</script>", url: "javascript:alert(1)", snippet: "<img src=x onerror=alert(1)>" }] } });
    const view = render(<ProvenanceReference reference={reference} sessionKey="session-a" />);
    fireEvent.click(screen.getByRole("button", { name: "查看来源 1" }));
    await screen.findByText("<script>alert(1)</script>");
    expect(view.container.querySelector("script, img, a")).toBeNull();
  });
});
