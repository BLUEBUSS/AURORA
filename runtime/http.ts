import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./errors.js";

export function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
export function decodeHeader(req: IncomingMessage, name: string, fallback = "") {
  const value = req.headers[name];
  if (Array.isArray(value)) throw new HttpError(400, "INVALID_HEADER", "文件请求头无效。");
  try { return decodeURIComponent(value ?? fallback); }
  catch { throw new HttpError(400, "INVALID_ENCODING", "文件名编码无效。"); }
}
export async function bodyBytes(req: IncomingMessage, maximum: number) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maximum) throw new HttpError(413, "BODY_TOO_LARGE", "请求超过大小限制。");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximum) throw new HttpError(413, "BODY_TOO_LARGE", "请求超过大小限制。");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
export function method(req: IncomingMessage, allowed: string[]) {
  if (!allowed.includes(req.method || "")) throw new HttpError(405, "METHOD_NOT_ALLOWED", "不支持此请求方式。");
}
export function reportError(res: ServerResponse, error: unknown) {
  if (res.headersSent) { res.destroy(); return; }
  if (error instanceof HttpError) { json(res, error.status, { ok: false, code: error.code, error: error.message }); return; }
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") { json(res, 404, { ok: false, error: "文件不存在。" }); return; }
  json(res, 500, { ok: false, error: "本机服务未能完成请求。请检查状态目录的权限与可用空间。" });
}
