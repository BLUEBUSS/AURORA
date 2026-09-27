import { mkdir, readFile, rename, writeFile, rm, chmod } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveSafePath } from "./files/index.js";

export async function privateDirectory(root: string, name: string) {
  const directory = await resolveSafePath(root, name, true);
  await mkdir(directory, { mode: 0o700 });
  return directory;
}
export async function readJsonFile<T>(root: string, name: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(await resolveSafePath(root, name), "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function writeJsonFile(root: string, name: string, value: unknown) {
  const target = await resolveSafePath(root, name, true);
  const temporary = `${path.basename(name)}.${randomUUID()}.tmp`;
  const tempPath = await resolveSafePath(root, temporary);
  try {
    await writeFile(tempPath, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await resolveSafePath(root, name);
    await rename(tempPath, target);
    if (process.platform !== "win32") await chmod(target, 0o600);
  } finally { await rm(tempPath, { force: true }); }
}
