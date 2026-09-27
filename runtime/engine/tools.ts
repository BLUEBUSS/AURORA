import { Type, type TSchema } from "typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createTaskCreateTool } from "./tools/task-create.js";
import { createTaskUpdateTool } from "./tools/task-update.js";
import { taskStore, pushTaskUpdateEvent } from "./task-store.js";
import type { WorkspaceFiles } from "../files/index.js";
import { financialTools, type SaveEvidence } from "./financial-tools.js";
import { searchEndpoint, webSearchTool } from "./web-search.js";
import type { DataEnvironment } from "../data-sources/index.js";
import type { RuntimeModel } from "../models/index.js";

const logger = { info: (_text: string) => {}, warn: (_text: string) => {}, error: (_text: string) => {} };
const result = (text: string, details: unknown = {}) => ({ content: [{ type: "text" as const, text }], details });
export interface ToolOptions { sessionKey: string; files: WorkspaceFiles; readSkill: (path: string) => string; spawn: (task: string, label: string, signal?: AbortSignal) => Promise<{ summary: string; childSessionKey: string; runId: string; status: string }>; child: boolean; saveEvidence: SaveEvidence; secUserAgent?: string; model?: RuntimeModel; dataEnvironment?: DataEnvironment }

export function researchTools(options: ToolOptions): AgentTool<TSchema, unknown>[] {
  const context = { agentId: "main", sessionKey: options.sessionKey };
  const taskTools = [createTaskCreateTool({ logger }, { "deep-research": "深度研究" })(context), createTaskUpdateTool({ logger })(context)];
  const migrated = taskTools.map((tool): AgentTool<TSchema, unknown> => ({
    name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters,
    execute: async (id, args) => {
      const invoke = tool.execute as (id: string, args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
      const value = await invoke(id, args);
      const plan = taskStore.getCurrent(context);
      if (plan) pushTaskUpdateEvent(plan.id);
      return { ...value, details: plan ? { plan: taskStore.toJSONCompact(plan.id) } : {} };
    },
  }));
  const basic: AgentTool<TSchema, unknown>[] = [
    {
      name: "read", label: "读取研究资料", description: "读取工作区的 UTF-8 文本附件或 skills/deep-research/ 下的研究方法文件。路径必须为工作区相对路径。",
      parameters: Type.Object({ path: Type.String() }),
      execute: async (_id, args) => {
        const file = (args as { path: string }).path;
        if (file.startsWith("skills/")) return result(options.readSkill(file));
        const body = await options.files.read(file);
        if (body.length > 2 * 1024 * 1024) throw new Error("Text file too large.");
        return result(new TextDecoder("utf-8", { fatal: true }).decode(body));
      },
    },
    { name: "list_files", label: "浏览研究文件", description: "列出当前工作区中真实存在的文件与相对路径。", parameters: Type.Object({}), execute: async () => result(JSON.stringify(await options.files.list())) },
    {
      name: "write_report", label: "保存研究报告", description: "把研究结果保存为 Markdown 文件；返回可下载的相对链接。只能写入当前工作区，不覆盖已有文件。",
      parameters: Type.Object({ name: Type.String(), content: Type.String() }),
      execute: async (_id, raw) => {
        const args = raw as { name: string; content: string };
        const file = await options.files.upload(args.name.endsWith(".md") ? args.name : args.name + ".md", Buffer.from(args.content), "reports");
        const url = `/fin-core/workspace-api/download?path=${encodeURIComponent(file.path)}`;
        return result(JSON.stringify({ ...file, url }), { artifact: { ...file, name: args.name.endsWith(".md") ? args.name : args.name + ".md", url, content: args.content } });
      },
    },
    { name: "data_capability_status", label: "检查数据能力", description: "查询当前数据能力及配置边界，不可把已注册工具当作已经在线验证的数据。", parameters: Type.Object({}), execute: async () => result(JSON.stringify({ workspace: "available", researchPlan: "available", cryptoAndBinanceEquityPerpetual: "public_endpoints_registered_unverified", secFilingsAndFundamentals: (options.dataEnvironment?.SEC_EDGAR_USER_AGENT ?? options.secUserAgent) ? "configured_unverified" : "user_contact_required_in_data_settings", usMarketQuotes: (options.dataEnvironment?.EODHD_API_TOKEN || options.dataEnvironment?.ALPHA_VANTAGE_API_KEY) ? "configured_unverified" : "not_configured", usMacro: options.dataEnvironment?.FRED_API_KEY ? "configured_unverified" : "not_configured", webSearch: searchEndpoint(options.model) ? "configured_unverified" : "not_configured", note: "部分结构化接口缺配置不等于无法研究；webSearch 已配置时先检索官方公开资料，并说明搜索摘要与结构化财务/行情的区别。股票与股票合约分别表达；数据工具返回成功前不声称已取得实时数据。付费及需认证的数据源不继承作者凭据。" })) },
  ];
  if (!options.child) basic.push({
    name: "sessions_spawn", label: "委派研究子任务", description: "把独立研究子问题交给子 Agent，使用同一个用户模型和工作区，等待其完成后返回结果。最多并行三个子任务，子任务不能继续派发。",
    parameters: Type.Object({ task: Type.String(), label: Type.Optional(Type.String()) }), executionMode: "parallel",
    execute: async (_id, raw, signal) => { const args = raw as { task: string; label?: string }; const child = await options.spawn(args.task, args.label || "研究子任务", signal); return result(JSON.stringify(child), child); },
  });
  const search = options.model ? webSearchTool(options.model, options.saveEvidence) : undefined;
  return [...migrated, ...basic, ...(search ? [search] : []), ...financialTools(options.sessionKey, options.saveEvidence, options.secUserAgent, options.dataEnvironment)];
}
