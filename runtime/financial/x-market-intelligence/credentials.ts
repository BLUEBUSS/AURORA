import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveSecretPath(filePath: string): string {
  const trimmed = filePath.trim();
  const expanded = trimmed.startsWith("~/") ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
  return path.resolve(expanded);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Read a Bearer Token from a local, permission-restricted key file without logging its value. */
export function readXBearerTokenFile(filePath: string): string {
  const resolvedPath = resolveSecretPath(filePath);
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) throw new Error(`X API credential path is not a file: ${resolvedPath}`);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error(`X API credential file must be owner-only (chmod 600): ${resolvedPath}`);
  }

  const lines = fs
    .readFileSync(resolvedPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const envLine = lines.find((line) => /^X_API_BEARER_TOKEN\s*=/i.test(line));
  const envValue = envLine ? envLine.slice(envLine.indexOf("=") + 1) : "";
  const labelIndex = lines.findIndex((line) => /^bearer\s*token\s*[:=]?$/i.test(line));
  const labelValue = labelIndex >= 0 ? lines[labelIndex + 1] || "" : "";
  const inlineLabel = lines.find((line) => /^bearer\s*token\s*[:=]/i.test(line)) ?? "";
  const inlineValue = inlineLabel.slice(inlineLabel.search(/[:=]/) + 1);
  const candidate = unquote(
    envValue || labelValue || inlineValue || (lines.length === 1 ? lines[0] : ""),
  );

  if (!candidate)
    throw new Error(`No Bearer Token found in X API credential file: ${resolvedPath}`);
  return candidate;
}
