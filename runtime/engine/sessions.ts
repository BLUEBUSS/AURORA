import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { HttpError } from "../errors.js";
import { resolveSafePath } from "../files/index.js";
import { readJsonFile, writeJsonFile } from "../private-storage.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

export type RunStatus = "running" | "ok" | "error" | "aborted";
export interface StoredSession { key: string; title: string; updatedAt: number; model?: string; messages: AgentMessage[]; runs: Record<string, RunStatus>; archived?: boolean; parentKey?: string; evidence?: Record<string, Record<string, unknown>> }
export class SessionStore {
  private directory = "";
  private readonly rows = new Map<string, StoredSession>();
  private queues = new Map<string, Promise<unknown>>();
  constructor(private root: string, private instanceId: string) {}
  validate(key: unknown): asserts key is string {
    if (typeof key !== "string" || !key.startsWith(`agent:main:webuser:${this.instanceId}:`) || key.length > 500 || /[\r\n\0]/.test(key)) throw new HttpError(403, "SESSION_DENIED", "该会话不属于当前本机工作区。");
  }
  private filename(key: string) { return createHash("sha256").update(key).digest("hex") + ".json"; }
  async initialize() {
    this.directory = await resolveSafePath(this.root, "research", true);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(this.directory)) {
      if (!/^[a-f\d]{64}\.json$/.test(entry)) continue;
      const saved = await readJsonFile<StoredSession>(this.directory, entry);
      if (!saved) continue;
      this.validate(saved.key);
      if (this.filename(saved.key) !== entry || !Array.isArray(saved.messages) || !saved.runs) throw new Error("Invalid research record.");
      for (const runId of Object.keys(saved.runs)) if (saved.runs[runId] === "running") saved.runs[runId] = "aborted";
      this.rows.set(saved.key, saved);
      await this.persist(saved);
    }
  }
  list() { return [...this.rows.values()].filter((row) => !row.parentKey).sort((a, b) => b.updatedAt - a.updatedAt).map((row) => ({ key: row.key, derivedTitle: row.title, archived: !!row.archived, updatedAt: row.updatedAt, model: row.model?.split("/").slice(1).join("/"), modelProvider: "aurora-user", modelLocked: !!row.messages.length })); }
  get(key: string): StoredSession {
    this.validate(key);
    let row = this.rows.get(key);
    if (!row) { row = { key, title: "新研究", updatedAt: Date.now(), messages: [], runs: {} }; this.rows.set(key, row); }
    return row;
  }
  persist(row: StoredSession): Promise<void> {
    this.validate(row.key);
    const snapshot = structuredClone(row);
    const pending = (this.queues.get(row.key) || Promise.resolve()).then(() => writeJsonFile(this.directory, this.filename(row.key), snapshot));
    this.queues.set(row.key, pending.catch(() => undefined));
    return pending;
  }
  async patch(key: string, fields: Record<string, unknown>) {
    const row = this.get(key);
    if (typeof fields.model === "string") {
      if (row.messages.length && fields.model !== row.model) throw new HttpError(409, "MODEL_LOCKED", "已开始的研究不能更换模型，请新建会话。");
      row.model = fields.model;
    }
    if (typeof fields.label === "string") row.title = fields.label.trim().slice(0, 100) || row.title;
    if (typeof fields.archived === "boolean") row.archived = fields.archived;
    await this.persist(row);
    return { ok: true };
  }
  findRun(runId: string) { for (const row of this.rows.values()) if (row.runs[runId]) return row.runs[runId]; return undefined; }
}
