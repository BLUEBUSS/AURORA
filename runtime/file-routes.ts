import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./errors.js";
import { WorkspaceFiles, MAX_UPLOAD_BYTES, assertFilename } from "./files/index.js";
import { bodyBytes, decodeHeader, json, method } from "./http.js";

export async function fileRoutes(req: IncomingMessage, res: ServerResponse, url: URL, files: WorkspaceFiles): Promise<boolean> {
  const agent = url.searchParams.get("agent");
  if (agent && agent !== "main") throw new HttpError(403, "UNKNOWN_AGENT", "当前本机实例不支持此工作区。");
  if (url.pathname === "/fin-core/backend/files") {
    method(req, ["GET"]);
    json(res, 200, { files: (await files.list()).map((file) => ({ ...file, url: `/fin-core/workspace-api/download?path=${encodeURIComponent(file.path)}` })) });
    return true;
  }
  if (url.pathname === "/fin-core/backend/upload" || url.pathname === "/fin-core/workspace-api/upload") {
    method(req, ["POST"]);
    // Validate filename before reading the request body or creating any directory.
    const filename = assertFilename(decodeHeader(req, "x-filename"));
    const directory = url.pathname === "/fin-core/backend/upload" ? "imports" : decodeHeader(req, "x-dir-path", "imports");
    const body = await bodyBytes(req, MAX_UPLOAD_BYTES);
    const saved = await files.upload(filename, body, directory);
    const fileUrl = `/fin-core/workspace-api/preview?path=${encodeURIComponent(saved.path)}`;
    if (url.pathname === "/fin-core/backend/upload") json(res, 200, { ok: true, file: saved.name, path: saved.path, url: fileUrl });
    else json(res, 200, { ok: true, file: { ...saved, url: fileUrl } });
    return true;
  }
  if (["/fin-core/workspace-api/preview", "/fin-core/workspace-api/download"].includes(url.pathname)) {
    method(req, ["GET", "HEAD"]);
    const relative = url.searchParams.get("path") || "";
    if (!relative) throw new HttpError(400, "PATH_REQUIRED", "请选择文件。");
    const body = await files.read(relative);
    const download = url.pathname.endsWith("/download");
    res.writeHead(200, {
      "Content-Type": download ? "application/octet-stream" : "text/plain; charset=utf-8",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(relative.split("/").at(-1)!)}`,
      "Content-Length": body.length,
      "Content-Security-Policy": "sandbox; default-src 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  }
  return false;
}
