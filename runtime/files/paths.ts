import path from "node:path";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { invalidPath } from "../errors.js";

export function pathSegments(relative: string, allowEmpty = false): string[] {
  if (!relative && allowEmpty) return [];
  if (!relative || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes("\\")) throw invalidPath();
  const segments = relative.split("/");
  for (const segment of segments) {
    const controls = [...segment].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    if (!segment || segment === "." || segment === ".." || /[<>:"|?*]/.test(segment) || controls ||
      /[. ]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) throw invalidPath();
  }
  return segments;
}

export function assertFilename(filename: string): string {
  if (pathSegments(filename).length !== 1 || Buffer.byteLength(filename) > 240) throw invalidPath();
  return filename;
}

export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Validate every existing component, including ancestors of a not-yet-created file. */
export async function resolveSafePath(root: string, relative: string, createParents = false): Promise<string> {
  const segments = pathSegments(relative, true);
  const canonicalRoot = await realpath(root);
  if ((await lstat(root)).isSymbolicLink()) throw invalidPath();
  let current = canonicalRoot;
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    let entry;
    try { entry = await lstat(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!createParents || index === segments.length - 1) continue;
      await mkdir(current, { mode: 0o700 });
      entry = await lstat(current);
    }
    if (entry.isSymbolicLink() || !isWithin(canonicalRoot, await realpath(current))) throw invalidPath();
    if (index < segments.length - 1 && !entry.isDirectory()) throw invalidPath();
  }
  if (!isWithin(canonicalRoot, current)) throw invalidPath();
  return current;
}
