import { mkdir } from "node:fs/promises";
import { HttpError } from "../errors.js";
import { resolveSafePath } from "../files/index.js";
import { readJsonFile, writeJsonFile } from "../private-storage.js";
import { sealSecret, unsealSecret, type StoredSecret } from "../models/secret.js";
import { DATA_SOURCES, type DataEnvironment, type DataProbe, type DataSourceId, type ProbeResult } from "./catalog.js";

interface SavedSource { enabled: boolean; secret: StoredSecret; lastTest?: ProbeResult }
type SavedSources = Partial<Record<DataSourceId, SavedSource>>;
export class DataSourceStore {
  private directory = "";
  private saved: SavedSources = {};
  constructor(private readonly root: string) {}
  async initialize(legacySecContact?: string) {
    this.directory = await resolveSafePath(this.root, "private", true);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const saved = await readJsonFile<SavedSources>(this.directory, "data-sources.json");
    this.saved = saved ?? {};
    // The file itself is the migration marker. Removing SEC must never restore legacy credentials.
    if (saved === undefined) {
      if (legacySecContact?.trim()) this.saved.sec = { enabled: true, secret: await sealSecret(legacySecContact.trim()) };
      await writeJsonFile(this.directory, "data-sources.json", this.saved);
    }
  }
  view() {
    return { sources: DATA_SOURCES.map(({ env: _env, ...source }) => ({ ...source, configured: !!this.saved[source.id], enabled: this.saved[source.id]?.enabled ?? false, lastTest: this.saved[source.id]?.lastTest })) };
  }
  private async persist(next: SavedSources) { await writeJsonFile(this.directory, "data-sources.json", next); this.saved = next; }
  async save(id: DataSourceId, credential: unknown) {
    if (typeof credential !== "string" || credential.length > 4096 || /[\r\n\0]/.test(credential)) throw new HttpError(400, "INVALID_CREDENTIAL", "凭据格式无效。");
    const value = credential.trim();
    const previous = this.saved[id];
    if (!value) {
      if (!previous) throw new HttpError(400, "CREDENTIAL_REQUIRED", "请填写你自己的凭据。");
      return;
    }
    if (id === "sec" && (value.length > 200 || !/^\S[^\r\n]*\s+[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new HttpError(400, "INVALID_CONTACT", "请填写应用名称和真实联系邮箱，例如 MyApp name@example.com。");
    await this.persist({ ...this.saved, [id]: { enabled: previous?.enabled ?? true, secret: await sealSecret(value) } });
  }
  async setEnabled(id: DataSourceId, enabled: boolean) {
    const row = this.saved[id];
    if (!row) throw new HttpError(409, "DATA_SOURCE_REQUIRED", "请先保存这个数据源的凭据。");
    await this.persist({ ...this.saved, [id]: { ...row, enabled } });
  }
  async remove(id: DataSourceId) { const next = { ...this.saved }; delete next[id]; await this.persist(next); }
  async test(id: DataSourceId, probe: DataProbe) {
    const row = this.saved[id];
    if (!row) throw new HttpError(409, "DATA_SOURCE_REQUIRED", "请先保存配置，再测试连接。");
    const result = await probe(id, await unsealSecret(row.secret));
    await this.persist({ ...this.saved, [id]: { ...row, lastTest: result } });
    return result;
  }
  async environment(): Promise<DataEnvironment> {
    const env: DataEnvironment = {};
    for (const source of DATA_SOURCES) {
      const row = this.saved[source.id];
      if (row?.enabled) env[source.env] = await unsealSecret(row.secret);
    }
    return env;
  }
}
