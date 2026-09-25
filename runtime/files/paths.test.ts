import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertFilename, pathSegments, resolveSafePath } from "./paths.js";
import { WorkspaceFiles, MAX_UPLOAD_BYTES } from "./workspace.js";

let temporary: string;
let root: string;
beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "aurora-path-test-"));
  root = path.join(temporary, "workspace");
  await mkdir(root);
});
afterEach(async () => {
  if (!path.resolve(temporary).startsWith(path.join(os.tmpdir(), "aurora-path-test-"))) throw new Error("Unsafe test cleanup target");
  await rm(temporary, { recursive: true, force: true });
});

describe("portable file boundaries", () => {
  it.each(["../secret.txt", "..\\secret.txt", "C:\\secret.txt", "/secret.txt", "a/../secret.txt", "a//b.txt", "a:file.txt", "NUL.txt", "lpt1", "file.txt.", "file.txt ", "bad\0.txt"])("rejects %s", (value) => {
    expect(() => pathSegments(value)).toThrow();
  });
  it("validates the complete upload filename, not only the containing directory", () => {
    expect(() => assertFilename("notes/report.md")).toThrow();
    expect(assertFilename("研究笔记.md")).toBe("研究笔记.md");
  });
  it("rejects a junction parent even if the final file does not exist", async () => {
    const outside = path.join(temporary, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(root, "jump"), process.platform === "win32" ? "junction" : "dir");
    await expect(resolveSafePath(root, "jump/new/report.txt", true)).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });
  it("creates legitimate nested parents inside the workarea", async () => {
    const target = await resolveSafePath(root, "company/quarter/report.md", true);
    expect(target).toBe(path.join(await realpath(root), "company", "quarter", "report.md"));
  });
});

describe("workspace files", () => {
  it("uploads, lists and reads real text without overwriting an existing same-name file", async () => {
    const files = new WorkspaceFiles(root);
    await files.initialize();
    const a = await files.upload("notes.md", Buffer.from("first"));
    const b = await files.upload("notes.md", Buffer.from("second"));
    expect(a.path).not.toBe(b.path);
    expect(await files.read(a.path)).toEqual(Buffer.from("first"));
    expect(await files.read(b.path)).toEqual(Buffer.from("second"));
    expect(await files.list()).toHaveLength(2);
  });
  it("rejects traversal uploads and does not create an outside file", async () => {
    const files = new WorkspaceFiles(root);
    await files.initialize();
    await expect(files.upload("../escaped.txt", Buffer.from("no"))).rejects.toThrow();
    await expect(files.upload("safe.txt", Buffer.from("no"), "../outside")).rejects.toThrow();
    expect(await readdir(temporary)).toEqual(["workspace"]);
  });
  it("rejects symlink reads and writes instead of following workspace aliases", async () => {
    const outside = path.join(temporary, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "outside-test-value");
    await symlink(outside, path.join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
    const files = new WorkspaceFiles(root);
    await files.initialize();
    await expect(files.read("alias/secret.txt")).rejects.toThrow();
    await expect(files.upload("notes.txt", Buffer.from("no"), "alias")).rejects.toThrow();
    expect(await readFile(path.join(outside, "secret.txt"), "utf8")).toBe("outside-test-value");
    expect(await files.list()).toEqual([]);
  });
  it("bounds uploads and rejects binary or executable content", async () => {
    const files = new WorkspaceFiles(root);
    await files.initialize();
    await expect(files.upload("large.txt", Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toMatchObject({ status: 413 });
    await expect(files.upload("binary.txt", Buffer.from([0xff, 0xfe]))).rejects.toMatchObject({ status: 415 });
    await expect(files.upload("exec.js", Buffer.from("alert(1)"))).rejects.toMatchObject({ status: 415 });
  });
});
