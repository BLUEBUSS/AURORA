import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelStore, modelDefinition, validateModel } from "./store.js";
import { sealSecret, unsealSecret } from "./secret.js";

it("maps K3 reasoning without applying Moonshot overrides to other endpoints", () => {
  const input = validateModel({ api: "openai-completions", baseUrl: "https://api.moonshot.cn/v1", modelId: "kimi-k3" });
  const model = modelDefinition(input);
  expect(model.reasoning).toBe(true);
  expect(model.thinkingLevelMap).toMatchObject({ off: "low", medium: "high", xhigh: "max" });
  expect(model.compat).toMatchObject({ supportsReasoningEffort: true, requiresReasoningContentOnAssistantMessages: true });
  expect(modelDefinition({ ...input, baseUrl: "https://example.com/v1" }).compat).toBeUndefined();
  expect(modelDefinition({ ...input, modelId: "kimi-k2.6" }).compat).toBeUndefined();
});

it("round-trips a synthetic credential through the local protector", async () => {
  const sealed = await sealSecret("fixture-own-key");
  expect(await unsealSecret(sealed)).toBe("fixture-own-key");
  if (process.platform === "win32") expect(sealed.value).not.toContain("fixture-own-key");
});
it("persists and reloads model metadata and the user-owned credential", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "aurora-model-test-"));
  try {
    const store = new ModelStore(temp); await store.initialize();
    await store.save(validateModel({ api: "openai-completions", baseUrl: "https://model.invalid/v1", modelId: "fixture-model", apiKey: "fixture-own-key" }));
    const restored = new ModelStore(temp); await restored.initialize();
    expect((await restored.resolve()).apiKey).toBe("fixture-own-key");
    expect(JSON.stringify(restored.view())).not.toContain("fixture-own-key");
  } finally {
    expect(path.resolve(temp).startsWith(path.join(os.tmpdir(), "aurora-model-test-"))).toBe(true);
    await rm(temp, { recursive: true, force: true });
  }
});
