// Adapted from ANLYST/OpenClaw (MIT). See docs/licenses/OpenClaw-MIT.txt.
import type { TaskPlan, TaskStep, TaskGroup, StoreScope, PlanStatus, StepStatus, TaskCheckpointRecord } from "./task-types.js";
import { isAllStepsTerminal } from "./task-helpers.js";
import { genGroupId, genStepId } from "./task-ids.js";
export type PlanCleanupCallback = (dataFiles: string[]) => void;

export class TaskStoreImpl {
  private plans = new Map<string, TaskPlan>();
  private currentPlanIds = new Map<string, string>();
  private phaseOverrides = new Map<string, string>();
  private static DEFAULT_AGENT = "__default__";
  private _navDirty = false;
  private _lastDirtyScope: StoreScope | undefined;
  // 内部路由错误时暂存的步骤，等 LLM 用正确工具重试时复用
  private pendingRetrySteps = new Map<string, string>(); // planId → stepId
  private _onCleanup: PlanCleanupCallback | undefined;

  onCleanup(cb: PlanCleanupCallback): void {
    this._onCleanup = cb;
  }

  /** 清理指定 plan 的临时数据文件 */
  cleanupDataFiles(plan: TaskPlan): void {
    if (!this._onCleanup) return;
    const files = plan.groups
      .flatMap((g) => g.steps)
      .map((s) => s.data_file_abs)
      .filter((f): f is string => !!f);
    if (files.length > 0) this._onCleanup(files);
  }

  /** sessionKey takes precedence so each query has its own plan scope. */
  private resolveKey(scope?: StoreScope): string {
    return scope?.sessionKey || scope?.agentId || TaskStoreImpl.DEFAULT_AGENT;
  }

  create(plan: TaskPlan, scope?: StoreScope): void {
    this.plans.set(plan.id, plan);
    this.currentPlanIds.set(this.resolveKey(scope), plan.id);
  }

  get(planId: string): TaskPlan | undefined {
    return this.plans.get(planId);
  }

  getCurrent(scope?: StoreScope): TaskPlan | undefined {
    const planId = this.currentPlanIds.get(this.resolveKey(scope));
    return planId ? this.plans.get(planId) : undefined;
  }

  autoStartStep(
    toolName: string,
    toolCallId?: string,
    scope?: StoreScope,
  ): { planId: string; stepId: string; stepTitle: string } | null {
    const planId = this.currentPlanIds.get(this.resolveKey(scope));
    const plan = planId ? this.plans.get(planId) : undefined;
    if (!plan || plan.status === "done" || plan.status === "failed") return null;
    for (const g of plan.groups) {
      for (const s of g.steps) {
        // Skip phase placeholder steps — their status is managed by task_update
        if (s.added_by === "initial" && !s.tool) continue;
        if (s.status === "pending" && s.tool === toolName) {
          s.status = "running";
          s.started_at = new Date().toISOString();
          if (toolCallId) s.tool_call_id = toolCallId;
          plan.updated_at = new Date().toISOString();
          this.refreshStatus(plan);
          return { planId: plan.id, stepId: s.id, stepTitle: s.title };
        }
      }
    }
    return null;
  }

  getStepContextData(scope?: StoreScope): {
    planDone: boolean;
    steps: Map<
      string,
      { summaryWithInsights?: string; compressedResult?: string; dataFile?: string }
    >;
  } {
    const steps = new Map<
      string,
      { summaryWithInsights?: string; compressedResult?: string; dataFile?: string }
    >();
    const planId = this.currentPlanIds.get(this.resolveKey(scope));
    const plan = planId ? this.plans.get(planId) : undefined;
    if (!plan) return { planDone: false, steps };

    const planDone = plan.status === "done" || plan.status === "failed" || isAllStepsTerminal(plan);

    for (const g of plan.groups) {
      for (const s of g.steps) {
        if (s.status !== "done" || !s.tool_call_id) continue;

        let summaryWithInsights: string | undefined;
        if (s.output_summary) {
          summaryWithInsights = s.output_summary;
          if (s.insights && s.insights.length > 0) {
            summaryWithInsights += `\n洞察: ${s.insights.join("; ")}`;
          }
        }

        steps.set(s.tool_call_id, {
          summaryWithInsights,
          compressedResult: s.compressed_result,
          dataFile: s.data_file,
        });
      }
    }

    return { planDone, steps };
  }

  setCompressedResult(planId: string, stepId: string, text: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;
    for (const g of plan.groups) {
      const step = g.steps.find((s) => s.id === stepId);
      if (step) {
        step.compressed_result = text;
        return true;
      }
    }
    return false;
  }

  setDataFile(planId: string, stepId: string, filePath: string, absPath?: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;
    for (const g of plan.groups) {
      const step = g.steps.find((s) => s.id === stepId);
      if (step) {
        step.data_file = filePath;
        if (absPath) step.data_file_abs = absPath;
        return true;
      }
    }
    return false;
  }

  /** Set data_file on a step identified by toolCallId (L1 persistence fallback). */
  setDataFileByToolCallId(toolCallId: string, filePath: string, scope?: StoreScope): boolean {
    const planId = this.currentPlanIds.get(this.resolveKey(scope));
    const plan = planId ? this.plans.get(planId) : undefined;
    if (!plan) return false;
    for (const g of plan.groups) {
      const step = g.steps.find((s) => s.tool_call_id === toolCallId);
      if (step) {
        if (!step.data_file) {
          step.data_file = filePath;
          step.data_file_abs = filePath;
        }
        return true;
      }
    }
    return false;
  }

  getCompressedResult(planId: string, stepId: string): string | undefined {
    const plan = this.plans.get(planId);
    if (!plan) return undefined;
    for (const g of plan.groups) {
      const step = g.steps.find((s) => s.id === stepId);
      if (step) return step.compressed_result;
    }
    return undefined;
  }

  updateStep(
    planId: string,
    stepId: string,
    update: Partial<Pick<TaskStep, "status" | "output_summary" | "data_source" | "insights">>,
  ): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;
    for (const g of plan.groups) {
      const step = g.steps.find((s) => s.id === stepId);
      if (step) {
        if (update.status === "running" && !step.started_at) {
          step.started_at = new Date().toISOString();
        }
        if (update.status === "done" || update.status === "failed" || update.status === "skipped") {
          step.completed_at = new Date().toISOString();
        }
        Object.assign(step, update);
        plan.updated_at = new Date().toISOString();
        this.refreshStatus(plan);
        return true;
      }
    }
    return false;
  }

  addSteps(planId: string, afterGroupId: string, newGroup: TaskGroup): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;
    const idx = plan.groups.findIndex((g) => g.id === afterGroupId);
    const insertAt = idx >= 0 ? idx + 1 : plan.groups.length;
    newGroup.order = insertAt;
    plan.groups.splice(insertAt, 0, newGroup);
    for (let i = 0; i < plan.groups.length; i++) plan.groups[i].order = i;
    plan.updated_at = new Date().toISOString();
    return true;
  }

  addCheckpoint(planId: string, cp: TaskCheckpointRecord): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;
    plan.checkpoints.push(cp);
    plan.status = "paused";
    plan.updated_at = new Date().toISOString();
    return true;
  }

  /** Mid-turn refresh: only promote to "executing" when steps are running.
   *  Terminal status (done/failed) is deferred to finalizePlan at agent_end
   *  so that dynamic tool calls are never blocked mid-turn. */
  private refreshStatus(plan: TaskPlan): void {
    if (plan.status === "paused") return;
    const all = plan.groups.flatMap((g) => g.steps);
    if (all.some((s) => s.status === "running")) {
      plan.status = "executing";
    }
  }

  /** Finalize plan status at agent_end. Sets plan to "done" or "failed"
   *  once all steps are terminal. Returns the resulting status. */
  finalizePlan(scope?: StoreScope): PlanStatus | null {
    const plan = this.getCurrent(scope);
    if (!plan || plan.status === "done" || plan.status === "failed" || plan.status === "paused") {
      return plan?.status ?? null;
    }
    const all = plan.groups.flatMap((g) => g.steps);
    const isTerminal = (s: TaskStep) =>
      s.status === "done" || s.status === "failed" || s.status === "skipped";
    if (all.length > 0 && all.every(isTerminal)) {
      const nonSkipped = all.filter((s) => s.status !== "skipped");
      plan.status =
        nonSkipped.length > 0 && nonSkipped.every((s) => s.status === "failed") ? "failed" : "done";
      if (!plan.completed_at) plan.completed_at = new Date().toISOString();
      plan.updated_at = new Date().toISOString();
    }
    return plan.status;
  }

  /** Register an external data file (e.g. from subagent announce persistence). */
  addExternalDataFile(scope: StoreScope, filePath: string): void {
    const plan = this.getCurrent(scope);
    if (!plan) return;
    if (!plan.externalDataFiles) plan.externalDataFiles = [];
    if (!plan.externalDataFiles.includes(filePath)) {
      plan.externalDataFiles.push(filePath);
    }
  }

  /** Compute total data file sizes (in bytes) for a plan. Uses stat on disk files. */
  getDataFileStats(planId: string): { totalBytes: number; fileCount: number; files: string[] } {
    const plan = this.plans.get(planId);
    if (!plan) return { totalBytes: 0, fileCount: 0, files: [] };
    const filePaths = new Set<string>();
    for (const g of plan.groups) {
      for (const s of g.steps) {
        if (s.data_file_abs) filePaths.add(s.data_file_abs);
      }
    }
    if (plan.externalDataFiles) {
      for (const f of plan.externalDataFiles) filePaths.add(f);
    }
    const files: string[] = [];
    let totalBytes = 0;
    for (const absPath of filePaths) {
      try {
        const { statSync } = require("fs") as typeof import("fs");
        const stat = statSync(absPath);
        totalBytes += stat.size;
        files.push(absPath);
      } catch {
        // File may have been cleaned up
      }
    }
    return { totalBytes, fileCount: files.length, files };
  }

  toSummaryText(planId: string): string {
    const plan = this.plans.get(planId);
    if (!plan) return "无活跃任务计划";
    const ic: Record<string, string> = {
      pending: "○",
      running: "▶",
      done: "✓",
      failed: "✗",
      skipped: "⊘",
    };
    const lines: string[] = [`任务: ${plan.query}`, `状态: ${plan.status}`, ""];
    for (const g of plan.groups) {
      lines.push(`[${g.type === "parallel" ? "并行" : "串行"}] ${g.title}`);
      for (const s of g.steps) {
        const tag = s.added_by === "replan" ? " [新增]" : "";
        const sum = s.output_summary ? ` — ${s.output_summary}` : "";
        lines.push(`  ${ic[s.status] || "?"} ${s.title}${tag}${sum}`);
      }
    }
    // Append data file stats when entering report phase
    if (isAllStepsTerminal(plan)) {
      const stats = this.getDataFileStats(planId);
      if (stats.fileCount > 0) {
        const totalKB = Math.round(stats.totalBytes / 1024);
        lines.push("");
        lines.push(`数据文件统计: ${stats.fileCount} 个文件, 共 ${totalKB}KB`);
      }
    }
    return lines.join("\n");
  }

  toJSON(planId: string): TaskPlan | null {
    return this.plans.get(planId) ?? null;
  }

  /** 精简序列化：剥离 compressed_result（原始工具返回），用于 LLM / 前端传输 */
  toJSONCompact(planId: string): TaskPlan | null {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    return {
      ...plan,
      groups: plan.groups.map((g) => ({
        ...g,
        steps: g.steps.map((s) => {
          const { compressed_result: _, data_file_abs: __, ...rest } = s;
          return rest;
        }),
      })),
    };
  }

  // ── Phase-level helpers (model-driven) ──────────────────────────

  /** Update a phase by index (0-based). Maps to the placeholder step in the corresponding group. */
  updatePhase(
    planId: string,
    phaseIndex: number,
    patch: { status: StepStatus; output_summary?: string },
  ): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;
    const initialGroups = plan.groups.filter((g) => g.steps.some((s) => s.added_by === "initial"));
    const group = initialGroups[phaseIndex];
    if (!group) return false;
    const step = group.steps.find((s) => s.added_by === "initial");
    if (!step) return false;
    step.status = patch.status;
    if (patch.output_summary) step.output_summary = patch.output_summary;
    if (patch.status === "done" || patch.status === "failed" || patch.status === "skipped") {
      step.completed_at = new Date().toISOString();
    }
    plan.updated_at = new Date().toISOString();
    this.refreshStatus(plan);
    return true;
  }

  /** Get the next pending phase (initial placeholder step). */
  getNextPendingPhase(planId: string): { index: number; description: string } | null {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    let idx = 0;
    for (const g of plan.groups) {
      const initial = g.steps.find((s) => s.added_by === "initial");
      if (initial && initial.status === "pending") {
        return { index: idx, description: initial.title };
      }
      if (initial) idx++;
    }
    return null;
  }

  getPendingPhaseCount(planId: string): number {
    const plan = this.plans.get(planId);
    if (!plan) return 0;
    let count = 0;
    for (const g of plan.groups) {
      const initial = g.steps.find((s) => s.added_by === "initial");
      if (initial && initial.status === "pending") count++;
    }
    return count;
  }

  /** Append new phases to the plan. */
  addPhases(planId: string, phases: Array<{ description: string }>): void {
    const plan = this.plans.get(planId);
    if (!plan) return;
    for (const phase of phases) {
      const groupId = genGroupId(planId);
      const step: TaskStep = {
        id: genStepId(planId),
        title: phase.description,
        description: phase.description,
        status: "pending" as const,
        added_by: "initial" as const,
      };
      plan.groups.push({
        id: groupId,
        title: phase.description,
        order: plan.groups.length,
        type: "serial" as const,
        steps: [step],
      });
    }
    if (!plan.phases) plan.phases = [];
    plan.phases.push(...phases);
    plan.updated_at = new Date().toISOString();
  }

  // ── System-driven automation helpers ──────────────────────────────

  autoCompleteStep(planId: string, stepId: string): boolean {
    return this.updateStep(planId, stepId, { status: "done" });
  }

  autoFailStep(planId: string, stepId: string, errorMessage?: string): boolean {
    const update: Partial<TaskStep> & { status: StepStatus } = { status: "failed" };
    if (errorMessage) update.error_message = errorMessage;
    return this.updateStep(planId, stepId, update);
  }

  /** Mark a step as pending retry (internal routing error). Step stays "running",
   *  next autoAddStep for this plan will reuse it instead of creating a new one. */
  markPendingRetry(planId: string, stepId: string): void {
    this.pendingRetrySteps.set(planId, stepId);
  }

  /** Consume a pending-retry step if one exists for this plan.
   *  Returns the step (updated with new tool info) or null. */
  consumePendingRetry(
    planId: string,
    toolName: string,
    toolCallId: string,
  ): { stepId: string; stepTitle: string } | null {
    const stepId = this.pendingRetrySteps.get(planId);
    if (!stepId) return null;
    this.pendingRetrySteps.delete(planId);
    const plan = this.plans.get(planId);
    if (!plan) return null;
    for (const g of plan.groups) {
      const step = g.steps.find((s) => s.id === stepId);
      if (step) {
        step.tool = toolName;
        step.tool_call_id = toolCallId;
        step.started_at = new Date().toISOString();
        plan.updated_at = new Date().toISOString();
        return { stepId: step.id, stepTitle: step.title };
      }
    }
    return null;
  }

  /** Create a dynamic step for tools not in the original plan. */
  autoAddStep(
    toolName: string,
    toolCallId: string,
    scope?: StoreScope,
  ): { planId: string; stepId: string; stepTitle: string } | null {
    const key = this.resolveKey(scope);
    const planId = this.currentPlanIds.get(key);
    const plan = planId ? this.plans.get(planId) : undefined;
    if (!plan || plan.status === "done" || plan.status === "failed") return null;

    // 复用因内部路由错误而等待重试的步骤（保留原标题）
    const reused = this.consumePendingRetry(plan.id, toolName, toolCallId);
    if (reused) return { planId: plan.id, ...reused };

    const stepId = genStepId(plan.id);
    const stepTitle = `${toolName} (自动追加)`;
    const step: TaskStep = {
      id: stepId,
      title: stepTitle,
      description: stepTitle,
      status: "running",
      tool: toolName,
      tool_call_id: toolCallId,
      added_by: "replan",
      started_at: new Date().toISOString(),
    };

    const lastGroup = plan.groups[plan.groups.length - 1];
    if (lastGroup) {
      lastGroup.steps.push(step);
    } else {
      const newGroup: TaskGroup = {
        id: genGroupId(plan.id),
        title: "自动追加步骤",
        order: 0,
        type: "serial",
        steps: [step],
      };
      plan.groups.push(newGroup);
    }
    plan.updated_at = new Date().toISOString();
    this.refreshStatus(plan);
    return { planId: plan.id, stepId, stepTitle };
  }

  /** Resolve all remaining pending steps on agent_end.
   *  - Phase placeholder steps (added_by=initial, no tool) are managed exclusively
   *    by task_update(complete_phase) and are NEVER auto-completed here.
   *  - Non-tool steps (tool is empty/N/A or not in registeredTools) whose
   *    data-gathering prerequisites all finished → "done" (synthesis was in model's text output).
   *  - Everything else → "skipped" (tool was never called). */
  autoSkipPendingSteps(
    scope?: StoreScope,
    registeredTools?: Set<string>,
  ): { skipped: number; completed: number } {
    const plan = this.getCurrent(scope);
    if (!plan) return { skipped: 0, completed: 0 };

    const isNonToolStep = (s: TaskStep) =>
      !s.tool || s.tool === "N/A" || (registeredTools ? !registeredTools.has(s.tool) : false);
    const hasRealToolStillPending = plan.groups.some((g) =>
      g.steps.some((s) => s.status === "pending" && !isNonToolStep(s)),
    );

    let skipped = 0;
    let completed = 0;
    const now = new Date().toISOString();
    for (const g of plan.groups) {
      for (const s of g.steps) {
        if (s.status !== "pending") continue;
        // Phase placeholder steps (added_by=initial, no tool) are managed by
        // task_update(complete_phase) — never auto-skip or auto-complete them.
        if (s.added_by === "initial" && !s.tool) continue;
        if (isNonToolStep(s) && !hasRealToolStillPending) {
          s.status = "done";
          completed++;
        } else {
          s.status = "skipped";
          skipped++;
        }
        s.completed_at = now;
      }
    }
    if (skipped + completed > 0) {
      plan.updated_at = now;
      this.refreshStatus(plan);
    }
    return { skipped, completed };
  }

  setPlanStatus(planId: string, status: PlanStatus): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;
    plan.status = status;
    plan.updated_at = new Date().toISOString();
    return true;
  }

  markNavDirty(scope?: StoreScope): void {
    this._navDirty = true;
    this._lastDirtyScope = scope;
  }

  isNavDirty(): boolean {
    return this._navDirty;
  }

  clearNavDirty(): void {
    this._navDirty = false;
  }

  /** Returns the scope that last triggered nav-dirty (for the global navProvider). */
  getLastDirtyScope(): StoreScope | undefined {
    return this._lastDirtyScope;
  }

  setPhaseOverride(scope: StoreScope, phase: string): void {
    this.phaseOverrides.set(this.resolveKey(scope), phase);
  }

  getPhaseOverride(scope: StoreScope): string | undefined {
    return this.phaseOverrides.get(this.resolveKey(scope));
  }

  clearPhaseOverride(scope: StoreScope): void {
    this.phaseOverrides.delete(this.resolveKey(scope));
  }

  clear(scope?: StoreScope): void {
    const key = scope ? this.resolveKey(scope) : undefined;
    if (key) {
      const planId = this.currentPlanIds.get(key);
      if (planId) this.plans.delete(planId);
      this.currentPlanIds.delete(key);
      this.phaseOverrides.delete(key);
    } else {
      this.plans.clear();
      this.currentPlanIds.clear();
      this.phaseOverrides.clear();
    }
  }
}
