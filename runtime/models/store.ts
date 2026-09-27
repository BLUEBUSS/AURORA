import { completeSimple, type Api, type Model } from "@mariozechner/pi-ai";
import { mkdir, rm } from "node:fs/promises";
import { HttpError } from "../errors.js";
import { resolveSafePath } from "../files/index.js";
import { readJsonFile, writeJsonFile } from "../private-storage.js";
import { sealSecret, unsealSecret, type StoredSecret } from "./secret.js";
import type { DataEnvironment } from "../data-sources/catalog.js";

export const MODEL_APIS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;
export interface ModelInput { api: typeof MODEL_APIS[number]; baseUrl: string; modelId: string; apiKey?: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number; secUserAgent?: string }
type SavedModel = Omit<ModelInput, "apiKey"> & { secret: StoredSecret; testedAt?: string };
export interface RuntimeModel { model: Model<Api>; apiKey: string; secUserAgent?: string; dataEnvironment?: DataEnvironment }

export function validateModel(input: unknown): ModelInput {
  if (!input || typeof input !== "object") throw new HttpError(400, "INVALID_MODEL", "请填写模型配置。");
  const value = input as Record<string, unknown>;
  if (!MODEL_APIS.includes(value.api as ModelInput["api"]) || typeof value.modelId !== "string" || !value.modelId.trim() || value.modelId.length > 160 || typeof value.baseUrl !== "string") throw new HttpError(400, "INVALID_MODEL", "模型协议、服务地址或模型名称无效。");
  let url: URL;
  try { url = new URL(value.baseUrl); } catch { throw new HttpError(400, "INVALID_URL", "请输入完整的模型服务地址。"); }
  if (url.username || url.password || url.hash || url.search || !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new HttpError(400, "INVALID_URL", "远程模型服务需要 HTTPS；本机模型可以使用 HTTP。");
  if (value.apiKey !== undefined && (typeof value.apiKey !== "string" || value.apiKey.length > 4096 || /[\r\n]/.test(value.apiKey))) throw new HttpError(400, "INVALID_KEY", "API Key 格式无效。");
  if (value.secUserAgent !== undefined && (typeof value.secUserAgent !== "string" || value.secUserAgent.length > 200 || /[\r\n]/.test(value.secUserAgent))) throw new HttpError(400, "INVALID_CONTACT", "SEC 联系标识格式无效。");
  const contextWindow = typeof value.contextWindow === "number" ? value.contextWindow : 128000;
  const maxTokens = typeof value.maxTokens === "number" ? value.maxTokens : 8192;
  if (!Number.isInteger(contextWindow) || contextWindow < 4096 || contextWindow > 2000000 || !Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > contextWindow) throw new HttpError(400, "INVALID_LIMIT", "上下文或输出长度配置无效。");
  return { api: value.api as ModelInput["api"], baseUrl: url.toString().replace(/\/$/, ""), modelId: value.modelId.trim(), apiKey: typeof value.apiKey === "string" ? value.apiKey.trim() : undefined, reasoning: value.reasoning === true, contextWindow, maxTokens, secUserAgent: typeof value.secUserAgent === "string" ? value.secUserAgent.trim() : undefined };
}
export function modelDefinition(value: Omit<ModelInput, "apiKey">): Model<Api> {
  const model: Model<Api> = { id: value.modelId, name: value.modelId, api: value.api, provider: "aurora-user", baseUrl: value.baseUrl, reasoning: !!value.reasoning, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: value.contextWindow || 128000, maxTokens: value.maxTokens || 8192 };
  // K3 always reasons and accepts low/high/max, unlike the older Moonshot defaults in Pi.
  if (value.api === "openai-completions" && ["api.moonshot.cn", "api.moonshot.ai"].includes(new URL(value.baseUrl).hostname) && value.modelId === "kimi-k3") {
    model.reasoning = true;
    model.compat = { supportsReasoningEffort: true, requiresReasoningContentOnAssistantMessages: true };
    model.thinkingLevelMap = { off: "low", minimal: "low", low: "low", medium: "high", high: "high", xhigh: "max" };
  }
  return model;
}

export class ModelStore {
  private directory = "";
  private saved: SavedModel | undefined;
  private changing = false;
  get updating() { return this.changing; }
  beginChange() {
    if (this.changing) throw new HttpError(409, "MODEL_UPDATING", "另一个模型设置操作正在进行，请稍后重试。");
    this.changing = true;
    return () => { this.changing = false; };
  }
  constructor(private readonly root: string) {}
  async initialize() {
    this.directory = await resolveSafePath(this.root, "private", true);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.saved = await readJsonFile<SavedModel>(this.directory, "model.json");
    if (this.saved) {
      const { apiKey: _discard, ...settings } = validateModel(this.saved);
      this.saved = { ...settings, secret: this.saved.secret, testedAt: this.saved.testedAt };
    }
  }
  view() {
    if (!this.saved) return { configured: false, model: null, auxiliary: "inherit-main" };
    const { secret: _secret, ...model } = this.saved;
    return { configured: true, model, auxiliary: "inherit-main" };
  }
  async resolve(input?: ModelInput): Promise<RuntimeModel> {
    const config = input || this.saved;
    if (!config) throw new HttpError(409, "MODEL_REQUIRED", "请先在设置的「模型」中接入自己的 API。");
    const same = !input || (this.saved && input.baseUrl === this.saved.baseUrl && input.api === this.saved.api && input.modelId === this.saved.modelId);
    const apiKey = input?.apiKey || (same && this.saved ? await unsealSecret(this.saved.secret) : "");
    if (!apiKey) throw new HttpError(400, "KEY_REQUIRED", "请填写你自己的 API Key。");
    return { model: modelDefinition(config), apiKey, secUserAgent: config.secUserAgent };
  }
  async probe(input: ModelInput, signal?: AbortSignal) {
    const resolved = await this.resolve(input);
    const started = Date.now();
    try {
      const result = await completeSimple(resolved.model, { messages: [{ role: "user", content: "Reply only OK.", timestamp: Date.now() }] }, { apiKey: resolved.apiKey, maxTokens: resolved.model.reasoning ? 1024 : 32, reasoning: "low", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000), maxRetries: 0 });
      if (result.stopReason === "error" || result.stopReason === "aborted" || !result.content.some((part) => part.type === "text" && part.text.trim())) throw new Error("provider rejected or returned no answer");
      return { ok: true, latencyMs: Date.now() - started };
    } catch { throw new HttpError(400, "MODEL_PROBE_FAILED", "模型连接测试失败。请检查协议、地址、模型名称和 Key；未保存本次配置。"); }
  }
  async save(input: ModelInput) {
    const { apiKey } = await this.resolve(input);
    const { apiKey: _key, ...settings } = input;
    const next: SavedModel = { ...settings, secret: await sealSecret(apiKey), testedAt: new Date().toISOString() };
    await writeJsonFile(this.directory, "model.json", next);
    this.saved = next;
    return this.view();
  }
  async remove() {
    await rm(await resolveSafePath(this.directory, "model.json"), { force: true });
    this.saved = undefined;
  }
}
