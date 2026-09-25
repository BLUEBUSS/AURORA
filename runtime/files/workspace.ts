// Workarea contracts and layout adapted from ANLYST/OpenClaw workspace-files.ts.
// MIT: see docs/licenses/OpenClaw-MIT.txt. Path handling is replaced for AURORA.
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError, invalidPath } from "../errors.js";
import { assertFilename, resolveSafePath } from "./paths.js";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_READ_BYTES = 50 * 1024 * 1024;
const MAX_WORKSPACE_BYTES = 1024 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".csv", ".json", ".xml", ".log"]);
export interface WorkspaceNode { name: string; path: string; size: number; modified: string }

export class WorkspaceFiles {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {}

  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.root)).isSymbolicLink()) throw invalidPath();
    await resolveSafePath(this.root, "imports/.keep", true);
  }

  async list(relative = "", depth = 0): Promise<WorkspaceNode[]> {
    if (depth > 20) throw new HttpError(413, "DIRECTORY_DEPTH", "工作区目录层级过深。");
    const directory = await resolveSafePath(this.root, relative);
    const result: WorkspaceNode[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      const filename = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) result.push(...await this.list(filename, depth + 1));
      else if (entry.isFile()) {
        const file = await resolveSafePath(this.root, filename);
        const info = await stat(file);
        result.push({ name: entry.name, path: filename, size: info.size, modified: info.mtime.toISOString() });
      }
      if (result.length > 10_000) throw new HttpError(413, "DIRECTORY_LIMIT", "工作区文件数量超过当前上限。");
    }
    return result;
  }

  async read(relative: string): Promise<Buffer> {
    const filename = await resolveSafePath(this.root, relative);
    const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw invalidPath();
      if (info.size > MAX_READ_BYTES) throw new HttpError(413, "FILE_TOO_LARGE", "文件超过读取大小限制。");
      await resolveSafePath(this.root, relative);
      const chunks: Buffer[] = [];
      let total = 0;
      while (true) {
        const chunk = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > MAX_READ_BYTES) throw new HttpError(413, "FILE_TOO_LARGE", "文件超过读取大小限制。");
        chunks.push(chunk.subarray(0, bytesRead));
      }
      return Buffer.concat(chunks);
    } finally { await handle.close(); }
  }

  async upload(name: string, body: Buffer, directory = "imports"): Promise<WorkspaceNode> {
    assertFilename(name);
    if (!TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())) throw new HttpError(415, "TEXT_ONLY", "目前支持文本研究附件。");
    if (body.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "UPLOAD_TOO_LARGE", "附件超过 2 MiB。");
    try {
      if (new TextDecoder("utf-8", { fatal: true }).decode(body).includes("\0")) throw new Error();
    } catch { throw new HttpError(415, "INVALID_TEXT", "附件必须是有效的 UTF-8 文本。"); }
    // Serialize quota checks and creation for this workspace. Never overwrite an existing file.
    const operation = this.queue.then(async () => {
      const used = (await this.list()).reduce((sum, file) => sum + file.size, 0);
      if (used + body.length > MAX_WORKSPACE_BYTES) throw new HttpError(413, "WORKSPACE_FULL", "工作区空间不足。");
      const extension = path.extname(name);
      let stem = "";
      for (const character of name.slice(0, -extension.length)) {
        if (Buffer.byteLength(stem + character) > 180) break;
        stem += character;
      }
      const filename = `aurora-${randomUUID()}-${stem}${extension}`;
      const relative = directory ? `${directory}/${filename}` : filename;
      const target = await resolveSafePath(this.root, relative, true);
      const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      try {
        await resolveSafePath(this.root, relative);
        await handle.writeFile(body);
        await handle.sync();
      } catch (error) {
        await handle.close();
        await unlink(target).catch(() => undefined);
        throw error;
      }
      await handle.close();
      const info = await stat(target);
      return { name: filename, path: relative, size: info.size, modified: info.mtime.toISOString() };
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
