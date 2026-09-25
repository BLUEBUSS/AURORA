import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_TEXT_MAX_BYTES,
  listLiveFiles,
  readLiveTextFile,
  uploadLiveTextAttachment,
} from "./live-files";

function mockFetch(response: Response) {
  const mock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("live file access", () => {
  it("lists real backend descriptors and excludes off-origin file links", async () => {
    const fetchMock = mockFetch(new Response(JSON.stringify({ files: [
      { name: "research.md", url: "/fin-core/backend/files/research.md?agent=main", size: 14, modified: "2026-09-24" },
      { name: "remote.md", url: "https://untrusted.example/research.md" },
    ] }), { headers: { "Content-Type": "application/json" } }));
    await expect(listLiveFiles("main")).resolves.toEqual([
      { name: "research.md", url: "/fin-core/backend/files/research.md?agent=main", size: 14, modified: "2026-09-24" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/fin-core/backend/files?agent=main", expect.objectContaining({ credentials: "same-origin", redirect: "error" }));
  });

  it("previews a generated Markdown file without executing its contents", async () => {
    const fetchMock = mockFetch(new Response("# Evidence\n\nSource-backed text", { headers: { "Content-Type": "text/markdown; charset=utf-8" } }));
    const result = await readLiveTextFile("/fin-core/backend/files/research.md?agent=main");
    expect(result).toMatchObject({ name: "research.md", content: "# Evidence\n\nSource-backed text", mimeType: "text/markdown" });
    expect(result.size).toBe(new TextEncoder().encode(result.content).byteLength);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps safe workspace paths to the authenticated workspace preview endpoint", async () => {
    const fetchMock = mockFetch(new Response("Current thesis", { headers: { "Content-Type": "text/plain" } }));
    await expect(readLiveTextFile("research/BTC/THESIS.md")).resolves.toMatchObject({ name: "THESIS.md", content: "Current thesis" });
    expect(fetchMock).toHaveBeenCalledWith("/fin-core/workspace-api/preview?path=research%2FBTC%2FTHESIS.md", expect.objectContaining({ credentials: "same-origin" }));
  });

  it.each([
    "https://untrusted.example/fin-core/files/report.md",
    "//untrusted.example/fin-core/files/report.md",
    "/fin-core/api/bootstrap",
    "/fin-core/files/%2e%2e%2fsecret.md",
    "/fin-core/workspace-api/preview?path=..%2Fsecret.md",
    "../secret.md",
    "C:\\private\\secret.md",
    "research/report.pdf",
  ])("rejects unsafe or non-text preview targets before fetching: %s", async (target) => {
    const fetchMock = mockFetch(new Response("never used"));
    await expect(readLiveTextFile(target)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized responses before consuming their contents", async () => {
    mockFetch(new Response("small body", { headers: { "Content-Type": "text/plain", "Content-Length": String(LIVE_TEXT_MAX_BYTES + 1) } }));
    await expect(readLiveTextFile("/fin-core/files/report.md")).rejects.toThrow("2 MiB");
  });

  it("enforces the size limit even when a response omits Content-Length", async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(LIVE_TEXT_MAX_BYTES + 1)); },
      cancel: cancelled,
    });
    mockFetch(new Response(stream, { headers: { "Content-Type": "text/plain" } }));
    await expect(readLiveTextFile("/fin-core/files/report.md")).rejects.toThrow("2 MiB");
    expect(cancelled).toHaveBeenCalled();
  });

  it("rejects an HTML app fallback rather than showing it as a research file", async () => {
    mockFetch(new Response("<html>App</html>", { headers: { "Content-Type": "text/html" } }));
    await expect(readLiveTextFile("/fin-core/files/report.md")).rejects.toThrow("文本文件");
  });

  it("reports authentication failures clearly", async () => {
    mockFetch(new Response("{}", { status: 401 }));
    await expect(listLiveFiles()).rejects.toThrow("登录");
  });
});

describe("live text attachment upload", () => {
  it("posts UTF-8 bytes with a unique stored name and preserves the server path", async () => {
    const fetchMock = mockFetch(new Response(JSON.stringify({ ok: true, file: "stored-note.md", path: "/workspace/imports/stored-note.md", size: 16 })));
    const result = await uploadLiveTextAttachment({ name: "笔记.md", content: "研究观察", mimeType: "text/markdown" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/fin-core/backend/upload");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream" } });
    const headers = init?.headers as Record<string, string>;
    expect(decodeURIComponent(headers["X-Filename"])).toMatch(/^aurora-.*-笔记\.md$/);
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe("研究观察");
    expect(result).toEqual({ name: "笔记.md", path: "/workspace/imports/stored-note.md", url: "/fin-core/uploads/stored-note.md" });
  });

  it("rejects unsafe names and unsupported types without uploading", async () => {
    const fetchMock = mockFetch(new Response("{}"));
    await expect(uploadLiveTextAttachment({ name: "../note.md", content: "text" })).rejects.toThrow();
    await expect(uploadLiveTextAttachment({ name: "report.pdf", content: "text" })).rejects.toThrow();
    await expect(uploadLiveTextAttachment({ name: "note.md", content: "text", mimeType: "application/pdf" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("limits bytes rather than JavaScript character count", async () => {
    const fetchMock = mockFetch(new Response("{}"));
    await expect(uploadLiveTextAttachment({ name: "note.md", content: "研".repeat(Math.ceil(LIVE_TEXT_MAX_BYTES / 3)) })).rejects.toThrow("2 MiB");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not invent a path when the backend omits it", async () => {
    mockFetch(new Response(JSON.stringify({ ok: true, file: "stored-note.md" })));
    await expect(uploadLiveTextAttachment({ name: "note.md", content: "text" })).rejects.toThrow("路径");
  });
});
