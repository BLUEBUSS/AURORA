import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const forbiddenDirectories = new Set([
  "node_modules", "dist", "dist-runtime", ".aurora-state", ".runtime", "artifacts", "credentials", "sessions", "private",
]);
const forbiddenNames = new Set([
  ".config.env", "auth-profiles.json", "openclaw.json", "models.json", "model.json", "instance.json",
]);
const textExtensions = /\.(?:[cm]?[jt]sx?|json|ya?ml|md|txt|html|css|ps1|cmd|sh|svg|toml)$/i;
const secretPatterns = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ["model-api-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
];

/** Deliberately reports locations only; a scan must never echo a candidate secret. */
export function inspectPublicFile(filename, text = "") {
  const file = filename.replaceAll("\\", "/");
  const parts = file.split("/");
  const basename = parts.at(-1);
  const findings = [];
  if (parts.some((part) => forbiddenDirectories.has(part)) ||
      forbiddenNames.has(basename) || /(?:^|[-_.])(?:api[-_]?key|credentials|secrets)(?=[-_.]|$).*\.(?:txt|json|ya?ml|env)$/i.test(basename) ||
      (basename.startsWith(".env") && basename !== ".env.example") || /(?:^|\/)research\/[a-f\d]{64}\.json$/i.test(file)) {
    findings.push({ file, line: 0, rule: "private-or-generated-file" });
  }
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const [rule, pattern] of secretPatterns) {
      if (pattern.test(line)) findings.push({ file, line: index + 1, rule });
    }
    if (/\b[A-Za-z]:[\\/](?:Users|ANTLYST-BLUEBUSS)[\\/]/i.test(line)) {
      findings.push({ file, line: index + 1, rule: "personal-absolute-path" });
    }
  }
  if (file === "package.json") {
    const pkg = JSON.parse(text);
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const version of Object.values(pkg[section] || {})) {
        if (typeof version === "string" && /^(?:file:|link:)/.test(version)) {
          findings.push({ file, line: 0, rule: "local-dependency" });
        }
      }
    }
  }
  return findings;
}

export function checkPublicSource(root) {
  // Include ignored files if they are tracked. .gitignore cannot protect committed secrets.
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
  const files = [...new Set(output.split("\0").filter(Boolean))];
  const findings = [];
  for (const file of files) {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      findings.push({ file, line: 0, rule: "outside-project" });
      continue;
    }
    let stat;
    try { stat = lstatSync(absolute); } catch (error) {
      if (error.code === "ENOENT") continue; // A tracked deletion has no content to scan.
      throw error;
    }
    if (stat.isSymbolicLink()) {
      findings.push({ file, line: 0, rule: "symlink-requires-review" });
      continue;
    }
    if (!stat.isFile()) continue;
    const text = textExtensions.test(file) || path.basename(file).startsWith(".env")
      ? readFileSync(absolute, "utf8") : "";
    findings.push(...inspectPublicFile(file, text));
  }
  return { files: files.length, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const report = checkPublicSource(root);
    console.log(`Checked ${report.files} tracked/candidate files (not Git history or release binaries).`);
    for (const finding of report.findings) {
      console.error(`${finding.file}:${finding.line} [${finding.rule}]`);
    }
    if (report.findings.length) process.exitCode = 1;
    else console.log("No matches in the limited source hygiene checks. Manual release review is still required.");
  } catch {
    console.error("Source check could not complete; verify the Git checkout and readable files.");
    process.exitCode = 1;
  }
}
