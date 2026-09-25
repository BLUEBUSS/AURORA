import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface RuntimeState { root: string; instanceId: string }

export function defaultStateDirectory(env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
  if (env.AURORA_STATE_DIR) return path.resolve(env.AURORA_STATE_DIR);
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Aurora");
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Aurora");
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "aurora");
}

export async function initializeState(directory = defaultStateDirectory()): Promise<RuntimeState> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("State directory must not be a symbolic link.");
  const root = await realpath(directory);
  const filename = path.join(root, "instance.json");
  const candidate = { schema: 1, instanceId: randomUUID() };
  try {
    await writeFile(filename, JSON.stringify(candidate, null, 2), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if ((await lstat(filename)).isSymbolicLink()) throw new Error("Instance file must not be a symbolic link.");
  const saved: unknown = JSON.parse(await readFile(filename, "utf8"));
  if (!saved || typeof saved !== "object" || !("schema" in saved) || saved.schema !== 1 ||
    !("instanceId" in saved) || typeof saved.instanceId !== "string" || !/^[a-f\d-]{36}$/i.test(saved.instanceId)) {
    throw new Error("Invalid instance state. Existing files were not overwritten.");
  }
  return { root, instanceId: saved.instanceId };
}
