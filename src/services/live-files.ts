export interface LiveFile {
  name: string;
  url: string;
  modified?: string;
  size?: number;
}

export interface LiveTextFile {
  name: string;
  content: string;
  mimeType: string;
  size: number;
}

export interface LiveTextAttachmentInput {
  name: string;
  content: string;
  mimeType?: string;
}

export interface UploadedLiveTextAttachment {
  name: string;
  /** Exact backend path for the Agent; it is not a browser URL. */
  path: string;
  url?: string;
}

export const LIVE_TEXT_MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const PREVIEW_EXTENSIONS = new Set(["md", "markdown", "txt", "csv", "tsv", "json", "xml", "yaml", "yml", "log"]);
// This subset matches the existing backend upload extension allowlist.
const UPLOAD_EXTENSIONS = new Set(["md", "txt", "csv", "json", "xml"]);
const TEXT_MIMES = new Set([
  "text/plain", "text/markdown", "text/csv", "text/tab-separated-values",
  "text/xml", "application/xml", "application/json", "text/yaml", "application/yaml",
]);
const FILE_PREFIXES = ["/fin-core/backend/files/", "/fin-core/files/", "/fin-core/uploads/"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function decode(value: string): string {
  try { return decodeURIComponent(value); }
  catch { throw new Error("文件路径编码无效，请从文件列表重新选择"); }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function assertNoTraversal(value: string): void {
  if (value.includes("\\") || hasControlCharacter(value) || value.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("文件路径不安全，请选择工作区内的文件");
  }
}

function safeName(value: string): string {
  if (!value || value.includes("..") || /[/\\<>:"|?*]/.test(value) || hasControlCharacter(value)) {
    throw new Error("文件名无效，请只使用文件名和扩展名");
  }
  return value;
}

function extension(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

function assertTextName(name: string, upload = false): void {
  if (!(upload ? UPLOAD_EXTENSIONS : PREVIEW_EXTENSIONS).has(extension(name))) {
    throw new Error(upload
      ? "仅支持上传 Markdown、TXT、CSV、JSON 和 XML 文本附件"
      : "此格式不能按文本预览，请下载原文件查看");
  }
}

function workspacePath(value: string): string {
  const path = decode(value.trim());
  assertNoTraversal(path);
  if (!path || path.startsWith("/") || /[:?#]/.test(path)) {
    throw new Error("请使用工作区相对路径或文件列表中的链接");
  }
  path.split("/").forEach(safeName);
  return path;
}

function fileTarget(input: string): { url: string; name: string } {
  const value = input.trim();
  if (!value) throw new Error("缺少文件路径");
  assertNoTraversal(decode(value.split("?")[0]));
  const isUrl = value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (!isUrl) {
    const path = workspacePath(value);
    return { url: `/fin-core/workspace-api/preview?path=${encodeURIComponent(path)}`, name: path.split("/").at(-1)! };
  }
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("仅支持当前研究后端的文件链接");
  }
  if (["/fin-core/workspace-api/preview", "/fin-core/workspace-api/download"].includes(url.pathname)) {
    const path = workspacePath(url.searchParams.get("path") ?? "");
    return { url: `${url.pathname}${url.search}`, name: path.split("/").at(-1)! };
  }
  const prefix = FILE_PREFIXES.find((item) => url.pathname.startsWith(item));
  if (!prefix) throw new Error("该链接不是可读取的研究文件");
  const name = safeName(decode(url.pathname.slice(prefix.length)));
  return { url: `${url.pathname}${url.search}`, name };
}

function checkSize(size: number): void {
  if (size > LIVE_TEXT_MAX_BYTES) throw new Error("文本文件超过 2 MiB，请缩小文件或下载后查看");
}

async function readBytes(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > LIVE_TEXT_MAX_BYTES) {
    await response.body?.cancel();
    checkSize(declared);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > LIVE_TEXT_MAX_BYTES) {
        await reader.cancel();
        checkSize(total);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function decodeText(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("binary");
    return text;
  } catch { throw new Error("文件不是有效的 UTF-8 文本，请下载原文件查看"); }
}

async function request<T>(url: string, init: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init, credentials: "same-origin", mode: "same-origin", redirect: "error", signal: controller.signal,
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: "请先登录研究后端再访问文件", 403: "当前账户无权访问此文件",
        404: "文件不存在或已被移除", 413: "文件超过后端大小限制",
      };
      throw new Error(messages[response.status] ?? `文件请求失败（HTTP ${response.status}）`);
    }
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("文件请求超时，请重试");
    if (error instanceof TypeError) throw new Error("研究后端文件服务暂不可用，请检查连接");
    throw error;
  } finally { clearTimeout(timer); }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(decodeText(await readBytes(response)));
    const object = asRecord(value);
    if (!object) throw new Error("invalid");
    return object;
  } catch { throw new Error("文件服务返回了无效数据，请检查后端连接"); }
}

export async function listLiveFiles(agentId?: string): Promise<LiveFile[]> {
  const query = agentId ? `?agent=${encodeURIComponent(agentId)}` : "";
  return request(`/fin-core/backend/files${query}`, {}, async (response) => {
    const data = await readJson(response);
    if (!Array.isArray(data.files)) throw new Error("文件列表格式无效");
    return data.files.flatMap((value: unknown): LiveFile[] => {
      const item = asRecord(value);
      if (!item || typeof item.name !== "string" || typeof item.url !== "string") return [];
      try {
        const target = fileTarget(item.url);
        return [{
          name: safeName(item.name), url: target.url,
          ...(typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0 ? { size: item.size } : {}),
          ...(typeof item.modified === "string" ? { modified: item.modified } : {}),
        }];
      } catch { return []; }
    });
  });
}

export async function readLiveTextFile(fileURLOrPath: string): Promise<LiveTextFile> {
  const target = fileTarget(fileURLOrPath);
  assertTextName(target.name);
  return request(target.url, {}, async (response) => {
    const mimeType = (response.headers.get("Content-Type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (!TEXT_MIMES.has(mimeType) && mimeType !== "application/octet-stream") {
      throw new Error("后端返回的不是受支持的文本文件，请下载原文件查看");
    }
    const bytes = await readBytes(response);
    return { name: target.name, content: decodeText(bytes), mimeType, size: bytes.byteLength };
  });
}

export async function uploadLiveTextAttachment(input: LiveTextAttachmentInput): Promise<UploadedLiveTextAttachment> {
  const name = safeName(input.name.trim());
  assertTextName(name, true);
  if (new TextEncoder().encode(name).byteLength > 160) throw new Error("文件名过长，请缩短后重试");
  if (input.mimeType && !TEXT_MIMES.has(input.mimeType.split(";")[0].trim().toLowerCase())) {
    throw new Error("附件 MIME 类型不是受支持的文本格式");
  }
  if (input.content.includes("\0")) throw new Error("附件必须是文本内容");
  const bytes = new TextEncoder().encode(input.content);
  checkSize(bytes.byteLength);
  // The old backend overwrites equal names. A unique storage name protects existing imports.
  const storedName = `aurora-${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${name}`;
  return request("/fin-core/backend/upload", {
    method: "POST", body: bytes,
    headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(storedName) },
  }, async (response) => {
    const data = await readJson(response);
    if (data.ok !== true || typeof data.path !== "string" || !data.path.trim()) {
      throw new Error("上传结果没有有效的后端路径，附件尚不可用于研究");
    }
    let url: string | undefined;
    if (typeof data.url === "string") {
      try { url = fileTarget(data.url).url; } catch { /* Ignore non-local server URLs. */ }
    }
    if (!url && typeof data.file === "string") {
      try { url = `/fin-core/uploads/${encodeURIComponent(safeName(data.file))}`; } catch { /* The Agent path remains valid without a browser preview URL. */ }
    }
    return { name, path: data.path, ...(url ? { url } : {}) };
  });
}
