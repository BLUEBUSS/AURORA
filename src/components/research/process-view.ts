// Adapted from ANLYST/OpenClaw chat presentation helpers (MIT).
// Copyright (c) 2025 Peter Steinberger. See docs/licenses/OpenClaw-MIT.txt.
import type { Round, ToolCallData } from "../../engine";

export type ProcessStatus = "pending" | "running" | "done" | "failed" | "skipped" | "aborted";
export interface PhaseView {
  id: string;
  title: string;
  status: ProcessStatus;
  summary?: string;
}

export const processStatusLabels: Record<ProcessStatus, string> = {
  pending: "待执行",
  running: "执行中",
  done: "已完成",
  failed: "失败",
  skipped: "已跳过",
  aborted: "已停止",
};

export function cleanThinkingText(text: string): string {
  return text
    .replace(/<plan>([\s\S]*?)<\/plan>/gi, (_, inner: string) => inner.trim())
    .replace(/<\/?plan>/gi, "")
    .replace(/(?:_[^_\n]*_\s*)?Reasoning:\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function selectPhaseViews(round: Round): PhaseView[] {
  const plan = round.task;
  if (!plan) return [];
  if (Array.isArray(plan.phases) && plan.phases.length > 0) {
    return plan.phases.map((phase, index) => ({
      id: `phase-${index}`,
      title: phase.description || `阶段 ${index + 1}`,
      status: round.phaseStatuses?.[index] ?? "pending",
    }));
  }
  return (plan.groups ?? [])
    .flatMap((group) => group.steps ?? [])
    .map((step, index) => ({
      id: step.id || `phase-${index}`,
      title: step.title || step.name || step.description || `阶段 ${index + 1}`,
      status: round.phaseStatuses?.[index] ?? step.status ?? "pending",
      summary: step.outputSummary || step.output_summary,
    }));
}

export function thinkingStatus(round: Round, phase: "pre-plan" | "report"): ProcessStatus {
  if (round.status === "aborted") return "aborted";
  if (round.status === "failed") return "failed";
  const pending = [...round.pending.values()].some((message) => message.phaseAtStart === phase);
  return round.status === "streaming" && pending ? "running" : "done";
}

export function toolStatus(tool: ToolCallData, roundStatus: Round["status"]): ProcessStatus {
  if (tool.status === "success") return "done";
  if (tool.status === "error") return "failed";
  // A stopped round must not leave a tool spinning or claim an unreceived success.
  if (roundStatus !== "streaming") return "aborted";
  return tool.status;
}

export function formatDuration(start?: number, end?: number): string | undefined {
  if (start === undefined || end === undefined || end < start) return undefined;
  const seconds = (end - start) / 1000;
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.floor(seconds % 60)} s`;
}

export function readableResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) {
    return record.content
      .flatMap((part: unknown) => {
        if (!part || typeof part !== "object") return [];
        const text = (part as Record<string, unknown>).text;
        return typeof text === "string" ? [text] : [];
      })
      .join("\n\n");
  }
  if (typeof record.error === "string") return record.error;
  if (typeof record.message === "string") return record.message;
  return "";
}

export function formatPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "结果无法序列化。";
  }
}
