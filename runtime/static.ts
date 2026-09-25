import { open, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { resolveSafePath } from "./files/index.js";
import { HttpError } from "./errors.js";
import { method } from "./http.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};
export async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL, root: string) {
  method(req, ["GET", "HEAD"]);
  let relative;
  try { relative = decodeURIComponent(url.pathname).replace(/^\//, "") || "index.html"; }
  catch { throw new HttpError(400, "INVALID_ENCODING", "页面地址编码无效。"); }
  if (relative.split("/").some((part) => part.startsWith(".")) || !MIME[path.extname(relative)]) {
    throw new HttpError(404, "NOT_FOUND", "页面不存在。");
  }
  const target = await resolveSafePath(root, relative);
  if (!(await stat(target)).isFile()) throw new HttpError(404, "NOT_FOUND", "页面不存在。");
  const handle = await open(target, "r");
  const info = await handle.stat();
  res.writeHead(200, { "Content-Type": MIME[path.extname(relative)], "Content-Length": info.size });
  if (req.method === "HEAD") { await handle.close(); res.end(); return; }
  await pipeline(handle.createReadStream(), res);
}
