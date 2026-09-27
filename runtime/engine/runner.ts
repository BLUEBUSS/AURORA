import { randomUUID } from "node:crypto";
import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { HttpError } from "../errors.js";
import type { WorkspaceFiles } from "../files/index.js";
import type { ModelStore, RuntimeModel } from "../models/index.js";
import { SessionStore } from "./sessions.js";
import { researchTools } from "./tools.js";
import { RunEvents, messageText, type Publish } from "./events.js";
import { researchContext } from "./context.js";
import { taskStore } from "./task-store.js";
import { buildProgressSummary } from "./task-nav.js";
import { readSkill, entrySkill } from "./skills.js";
import type { DataSourceStore } from "../data-sources/index.js";

interface ActiveRun { id: string; sessionKey: string; agent?: Agent; children: Set<Agent>; done: Promise<void>; cancelled: boolean; deepResearch: boolean; limitReason?: string }
const GENERIC_ERROR = "研究执行未完成。请检查模型配置、服务可用性或上下文长度后重试。";
export class ResearchEngine {
  readonly sessions: SessionStore;
  private readonly active = new Map<string, ActiveRun>();
  private starting = 0;
  private sequence = new Map<string, Promise<unknown>>();
  private publish: Publish = () => {};
  constructor(private root: string, instanceId: string, readonly models: ModelStore, private files: WorkspaceFiles, private sources: DataSourceStore) { this.sessions = new SessionStore(root, instanceId); }
  async initialize() { await this.sessions.initialize(); }
  setPublish(fn: Publish) { this.publish = fn; }
  get busy() { return this.active.size > 0 || this.starting > 0; }
  sessionBusy(key: string) { return [...this.active.values()].some((run) => run.sessionKey === key); }
  private serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const result = (this.sequence.get(key) || Promise.resolve()).then(fn);
    this.sequence.set(key, result.catch(() => undefined));
    return result;
  }
  async send(params: Record<string, unknown>) {
    this.sessions.validate(params.sessionKey);
    const key = params.sessionKey;
    if (this.models.updating) throw new HttpError(409, "MODEL_UPDATING", "模型配置正在更新，请稍后发送研究。");
    this.starting++;
    try { return await this.serialized(key, async () => {
      if (typeof params.message !== "string" || !params.message.trim() || params.message.length > 200000 || typeof params.idempotencyKey !== "string" || !/^[\w-]{1,160}$/.test(params.idempotencyKey)) throw new HttpError(400, "INVALID_MESSAGE", "研究请求格式无效。");
      const id = params.idempotencyKey;
      const session = this.sessions.get(key);
      if (session.runs[id]) return { runId: id, status: session.runs[id] === "running" ? "in_flight" : "ok" };
      if ([...this.active.values()].some((run) => run.sessionKey === key)) throw new HttpError(409, "RUN_ACTIVE", "本会话仍有研究在运行。");
      if (this.active.size >= 4) throw new HttpError(429, "RUN_LIMIT", "同时运行的研究已达到上限。");
      const model = await this.models.resolve();
      model.dataEnvironment = await this.sources.environment();
      const modelRef = `${model.model.provider}/${model.model.id}`;
      if (session.model && session.model !== modelRef) throw new HttpError(409, "MODEL_CHANGED", "此会话绑定的模型与当前配置不同，请新建会话。");
      session.model = modelRef;
      session.title = session.messages.length ? session.title : params.message.replace(/<!--[\s\S]*?-->/g, "").replace(/\[指定技能[^\]]*\]/g, "").trim().slice(0, 80);
      const user: AgentMessage & { auroraRunId: string } = { role: "user", content: params.message, timestamp: Date.now(), auroraRunId: id };
      session.runs[id] = "running";
      session.updatedAt = Date.now();
      const previous = [...session.messages];
      session.messages.push(user);
      await this.sessions.persist(session); // Persist the submitted question before returning its ACK.
      let resolveDone!: () => void;
      const run: ActiveRun = { id, sessionKey: key, children: new Set(), done: new Promise<void>((resolve) => { resolveDone = resolve; }), cancelled: false, deepResearch: params.message.includes("FINCLAW_SELECTED_SKILL:deep-research") };
      this.active.set(id, run);
      setImmediate(() => { void this.execute(run, model, previous, user).finally(resolveDone); });
      return { runId: id, status: "started" };
    }); } finally { this.starting--; }
  }
  private async execute(run: ActiveRun, model: RuntimeModel, previous: AgentMessage[], user: AgentMessage) {
    const row = this.sessions.get(run.sessionKey);
    const events = new RunEvents(run.id, run.sessionKey, this.publish);
    const scope = { agentId: "main", sessionKey: run.sessionKey };
    taskStore.clear(scope);
    const timer = setTimeout(() => { run.cancelled = true; run.agent?.abort(); for (const child of run.children) child.abort(); }, 20 * 60 * 1000);
    try {
      await researchContext.run({ runId: run.id, emit: (event) => events.task((event.data || {}) as Record<string, unknown>), childEnded: (id) => ![...run.children].some((agent) => agent.sessionId === id) }, async () => {
        const agent = this.createAgent(run, model, previous, false, events, run.sessionKey);
        run.agent = agent;
        if (run.cancelled) throw new Error("cancelled");
        agent.subscribe(async (event) => {
          events.accept(event);
          if (event.type === "message_end") {
            if (event.message.role === "assistant" && event.message.errorMessage) event.message.errorMessage = GENERIC_ERROR;
            row.messages = [...agent.state.messages];
            row.updatedAt = Date.now();
            await this.sessions.persist(row);
          }
        });
        await agent.prompt(user);
        row.messages = [...agent.state.messages];
        const last = [...row.messages].reverse().find((message) => message.role === "assistant");
        const failed = last?.role === "assistant" && ["error", "aborted"].includes(last.stopReason);
        row.runs[run.id] = run.cancelled ? "aborted" : failed ? "error" : "ok";
        await this.sessions.persist(row);
        events.terminal(run.cancelled ? "aborted" : failed ? "error" : "final", last, failed && !run.cancelled ? run.limitReason || GENERIC_ERROR : undefined);
      });
    } catch {
      row.runs[run.id] = run.cancelled ? "aborted" : "error";
      await this.sessions.persist(row).catch(() => undefined);
      events.terminal(run.cancelled ? "aborted" : "error", undefined, run.cancelled ? undefined : GENERIC_ERROR);
    } finally { clearTimeout(timer); taskStore.clear(scope); this.active.delete(run.id); }
  }
  private createAgent(run: ActiveRun, model: RuntimeModel, messages: AgentMessage[], child: boolean, events: RunEvents, key: string): Agent {
    let turns = 0;
    const prompt = `你是 AURORA 投研助手。区分事实、推断和待验证事项；不要编造行情、引用、工具或文件。只能使用注册的工具。先用 data_capability_status 核对本轮实际能力，不沿用历史中的不可用结论。联网搜索已配置时，应通过 web_search 检索公司官方披露和新闻，不能因结构化行情或 SEC 未配置就停止研究；但不得把搜索摘要伪装为完整财报或实时报价。股票与交易合约分开表达。附件路径为工作区相对路径，read 可直接读取；方法文件路径以 skills/deep-research/ 开头。需要认证而未配置的数据源应说明限制，不得伪装已联网。研究报告用 write_report 保存 Markdown，当前不提供 PDF 渲染或 shell。复杂研究使用 task_create/task_update；简单对话直接回答。引用真实工具返回的 [[p_xxxx]] 标识，不得自行生成。\n${run.deepResearch ? entrySkill : ""}`;
    const agent = new Agent({
      initialState: { systemPrompt: prompt, model: model.model, thinkingLevel: model.model.reasoning ? "medium" : "off", messages },
      getApiKey: () => model.apiKey, maxRetryDelayMs: 5000, toolExecution: "sequential", sessionId: child ? key : run.id,
      beforeToolCall: async ({ toolCall }) => {
        if (++turns > 80) return { block: true, reason: "工具调用达到本轮上限，请根据已有证据总结。" };
        if (/^(write_report|crypto_|us_|tradfi_)/.test(toolCall.name) && !taskStore.getCurrent({ sessionKey: key })) return { block: true, reason: "数据分析和报告生成前请先使用 task_create 创建研究计划。" };
        return undefined;
      },
      transformContext: async (history) => {
        const plan = taskStore.getCurrent({ sessionKey: key });
        agent.state.systemPrompt = prompt + (plan ? `\n当前任务进度：\n${buildProgressSummary(plan)}` : "");
        return history;
      },
    });
    let modelTurns = 0;
    agent.subscribe((event) => { if (event.type === "turn_start" && ++modelTurns > 40) { run.limitReason = "本轮研究达到模型调用上限，请缩小研究范围后继续。"; agent.abort(); } });
    agent.state.tools = researchTools({ sessionKey: key, files: this.files, readSkill, child, model, dataEnvironment: model.dataEnvironment,
      saveEvidence: async (toolName, callId, args, records, meta) => {
        const row = this.sessions.get(run.sessionKey);
        const provenanceId = `p_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
        const bounded = records.slice(0, 3000);
        row.evidence ||= {};
        row.evidence[provenanceId] = { provenanceId, sessionKey: row.key, toolName, toolCallId: callId, timestamp: Date.now(), dataSource: typeof meta?.provider === "string" ? meta.provider : toolName, toolArgs: args, summary: { kind: "table", headers: Object.keys(bounded[0] || {}), rows: bounded.slice(0, 20).map((record) => Object.keys(bounded[0] || {}).map((key) => record[key])), totalRows: records.length }, records: bounded };
        await this.sessions.persist(row);
        return provenanceId;
      }, spawn: async (task, label, signal) => {
      if (signal?.aborted || run.cancelled) throw new Error("Research was stopped.");
      if (run.children.size >= 3) throw new Error("最多同时运行三个研究子任务。");
      const childId = randomUUID();
      const childKey = `${run.sessionKey}:child:${childId}`;
      const childEvents = new RunEvents(run.id, run.sessionKey, this.publish, { id: childId, label });
      const subagent = this.createAgent(run, model, [], true, childEvents, childKey);
      const childRow = this.sessions.get(childKey);
      childRow.parentKey = run.sessionKey; childRow.title = label; childRow.runs[childId] = "running"; childRow.model = `${model.model.provider}/${model.model.id}`;
      subagent.sessionId = childId;
      run.children.add(subagent);
      const abort = () => subagent.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const plan = taskStore.getCurrent({ sessionKey: key });
      if (plan) { plan.subagents ||= []; plan.subagents.push({ id: childId, label, status: "running", stepIds: [], startedAt: Date.now() }); }
      subagent.subscribe(async (event) => {
        childEvents.accept(event);
        if (event.type === "message_end") {
          if (event.message.role === "assistant" && event.message.errorMessage) event.message.errorMessage = GENERIC_ERROR;
          childRow.messages = [...subagent.state.messages];
          await this.sessions.persist(childRow);
        }
      });
      try {
        await researchContext.run({ runId: run.id, emit: (event) => childEvents.task((event.data || {}) as Record<string, unknown>), childEnded: () => true }, async () => { await subagent.prompt(task); });
        const last = [...subagent.state.messages].reverse().find((message) => message.role === "assistant");
        if (last?.role === "assistant" && ["error", "aborted"].includes(last.stopReason)) throw new Error(GENERIC_ERROR);
        childEvents.terminal("final", last);
        if (plan?.subagents) { const entry = plan.subagents.find((entry) => entry.id === childId); if (entry) { entry.status = "done"; entry.completedAt = Date.now(); } }
        childRow.messages = [...subagent.state.messages]; childRow.runs[childId] = "ok";
        await this.sessions.persist(childRow);
        return { summary: messageText(last), childSessionKey: childKey, runId: childId, status: "completed" };
      } catch {
        childRow.runs[childId] = signal?.aborted || run.cancelled ? "aborted" : "error";
        await this.sessions.persist(childRow).catch(() => undefined);
        childEvents.terminal("error", undefined, GENERIC_ERROR);
        if (plan?.subagents) { const entry = plan.subagents.find((entry) => entry.id === childId); if (entry) entry.status = "failed"; }
        throw new Error(GENERIC_ERROR);
      } finally { signal?.removeEventListener("abort", abort); run.children.delete(subagent); taskStore.clear({ sessionKey: childKey }); }
    } });
    return agent;
  }
  async abort(key: string, runId?: string) {
    this.sessions.validate(key);
    const run = [...this.active.values()].find((run) => run.sessionKey === key && (!runId || run.id === runId));
    if (!run) return { ok: true, aborted: false, runIds: [] };
    run.cancelled = true; run.agent?.abort(); for (const child of run.children) child.abort();
    await run.done;
    return { ok: true, aborted: true, runIds: [run.id] };
  }
  wait(runId: string) { const status = this.sessions.findRun(runId); return { status: status === "running" ? "timeout" : status === "ok" ? "ok" : "error" }; }
  async close() { await Promise.all([...this.active.values()].map((run) => this.abort(run.sessionKey, run.id))); }
}
