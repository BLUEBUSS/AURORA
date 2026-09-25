import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectPublicFile } from "./check-public-source.mjs";

test("rejects private configuration and generated artifacts even if tracked", () => {
  for (const file of [".env", ".env.production", ".config.env", ".runtime/log.txt", "artifacts/a.png", "state/auth-profiles.json"]) {
    assert.equal(inspectPublicFile(file)[0]?.rule, "private-or-generated-file");
  }
  assert.deepEqual(inspectPublicFile(".env.example", "MODEL_KEY=your-key-here"), []);
});

test("returns secret location without the matched credential", () => {
  const secret = "ghp_" + "A".repeat(36);
  const findings = inspectPublicFile("src/example.ts", `// header\nconst token = '${secret}';`);
  assert.deepEqual(findings, [{ file: "src/example.ts", line: 2, rule: "github-token" }]);
  assert.equal(JSON.stringify(findings).includes(secret), false);
});

test("detects embedded model keys and PEM private keys", () => {
  assert.equal(inspectPublicFile("src/key.ts", "sk-" + "A".repeat(35))[0]?.rule, "model-api-key");
  assert.equal(inspectPublicFile("src/key.ts", "-----BEGIN " + "PRIVATE KEY-----")[0]?.rule, "private-key");
});

test("rejects machine-specific dependencies and paths", () => {
  assert.equal(inspectPublicFile("package.json", JSON.stringify({ dependencies: { backend: "file:../backend" } }))[0]?.rule, "local-dependency");
  const localPath = ["C:", "Users", "example", "project"].join("\\");
  assert.equal(inspectPublicFile("README.md", localPath)[0]?.rule, "personal-absolute-path");
  assert.deepEqual(inspectPublicFile("README.md", "Use a new user-owned state directory."), []);
});
