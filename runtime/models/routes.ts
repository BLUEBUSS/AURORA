import type { IncomingMessage, ServerResponse } from "node:http";
import { bodyBytes, json, method } from "../http.js";
import { HttpError } from "../errors.js";
import { ModelStore, validateModel } from "./store.js";

export async function modelRoutes(req: IncomingMessage, res: ServerResponse, url: URL, models: ModelStore, busy: () => boolean) {
  if (url.pathname !== "/fin-core/api/model") return false;
  method(req, ["GET", "POST", "DELETE"]);
  if (req.method === "GET") { json(res, 200, models.view()); return true; }
  if (busy()) throw new HttpError(409, "RESEARCH_ACTIVE", "请先停止正在执行的研究，再修改模型。");
  if (req.method === "DELETE") { const release = models.beginChange(); try { await models.remove(); json(res, 200, models.view()); } finally { release(); } return true; }
  let value: unknown;
  const body = await bodyBytes(req, 12000);
  try { value = JSON.parse(body.toString("utf8")); } catch { throw new HttpError(400, "INVALID_CONFIG", "配置格式无效。"); }
  const input = validateModel(value);
  if (busy()) throw new HttpError(409, "RESEARCH_ACTIVE", "研究刚刚启动，暂未保存模型，请稍后重试。");
  const release = models.beginChange();
  try {
    const probe = await models.probe(input);
    const view = await models.save(input);
    json(res, 200, { ...view, ...probe });
  } finally { release(); }
  return true;
}
