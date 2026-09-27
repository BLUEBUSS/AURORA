import type { IncomingMessage, ServerResponse } from "node:http";
import { bodyBytes, json, method } from "../http.js";
import { HttpError } from "../errors.js";
import type { ModelStore } from "../models/index.js";
import { isDataSourceId, type DataProbe } from "./catalog.js";
import type { DataSourceStore } from "./store.js";

export async function dataSourceRoutes(req: IncomingMessage, res: ServerResponse, url: URL, store: DataSourceStore, models: ModelStore, busy: () => boolean, probe: DataProbe) {
  if (url.pathname !== "/fin-core/api/data-sources") return false;
  method(req, ["GET", "POST"]);
  if (req.method === "GET") { json(res, 200, store.view()); return true; }
  let input: Record<string, unknown>;
  try { input = JSON.parse((await bodyBytes(req, 10000)).toString("utf8")); } catch { throw new HttpError(400, "INVALID_CONFIG", "数据源配置格式无效。"); }
  if (!input || typeof input !== "object" || !isDataSourceId(input.id) || !["save", "test", "enable", "disable", "remove"].includes(String(input.action))) throw new HttpError(400, "INVALID_CONFIG", "请选择有效的数据源和操作。");
  if (busy()) throw new HttpError(409, "RESEARCH_ACTIVE", "请先停止正在执行的研究，再修改或测试数据源。");
  // Share the model mutation lock so a new research run cannot start during a source update.
  const release = models.beginChange();
  try {
    if (input.action === "save") await store.save(input.id, input.credential ?? "");
    if (input.action === "remove") await store.remove(input.id);
    if (input.action === "enable" || input.action === "disable") await store.setEnabled(input.id, input.action === "enable");
    const test = input.action === "test" ? await store.test(input.id, probe) : undefined;
    json(res, 200, { ...store.view(), ...(test ? { test } : {}) });
  } finally { release(); }
  return true;
}
