// Adapted from ANLYST/OpenClaw RightTimelinePanel and its segment views (MIT).
// Copyright (c) 2025 Peter Steinberger. See docs/licenses/OpenClaw-MIT.txt.
import { ChevronDown, GitBranch, ListChecks } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { Round, Segment, SubagentRecord, ToolCallData } from "../../engine";
import { Markdown } from "../chat/Markdown";
import { ProcessStatusIcon, TypingIndicator } from "./ProcessPrimitives";
import { ToolCallDetails } from "./ToolCallDetails";
import { processStatusLabels } from "./process-view";

export type ResearchToolCalls = ReadonlyMap<string, ToolCallData>;
export type ResearchSubagents = ReadonlyMap<string, SubagentRecord>;
const emptyTools: ResearchToolCalls = new Map();

export interface ExecutionTimelineProps {
  round: Round;
  toolCalls?: ResearchToolCalls;
  subagents?: ResearchSubagents;
  showEmpty?: boolean;
}

function markerTitle(segment: Extract<Segment, { kind: "phase-marker" }>): string {
  if (segment.action === "create")
    return `研究计划已生成${segment.planPhaseCount ? ` · ${segment.planPhaseCount} 个阶段` : ""}`;
  if (segment.action === "add") return `新增 ${segment.addedPhases?.length ?? 0} 个阶段`;
  const numbers = (
    Array.isArray(segment.phaseIndex)
      ? segment.phaseIndex
      : segment.phaseIndex === undefined
        ? []
        : [segment.phaseIndex]
  ).map((index) => index + 1);
  const label =
    segment.action === "complete" ? "完成" : segment.action === "fail" ? "失败" : "已跳过";
  return `阶段${numbers.length ? ` ${numbers.join("、")}` : ""}${label}`;
}

function PhaseMarker({ segment }: { segment: Extract<Segment, { kind: "phase-marker" }> }) {
  const summary = (segment.summaries ?? []).filter(Boolean).join("\n\n");
  return (
    <div
      className="research-phase-marker"
      data-status={segment.action === "fail" ? "failed" : undefined}
    >
      <div>
        <ListChecks size={13} aria-hidden="true" />
        <span>{markerTitle(segment)}</span>
      </div>
      {summary && (
        <details>
          <summary>阶段摘要</summary>
          <Markdown text={summary} />
        </details>
      )}
      {!!segment.addedPhases?.length && (
        <ul>
          {segment.addedPhases.map((title, index) => (
            <li key={index}>{title}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface SegmentListProps {
  segments: readonly Segment[];
  roundStatus: Round["status"];
  toolCalls: ResearchToolCalls;
  subagents?: ResearchSubagents;
  ancestorIds?: readonly string[];
}

function SubagentDetails({
  segment,
  roundStatus,
  toolCalls,
  subagents,
  ancestorIds = [],
}: Omit<SegmentListProps, "segments"> & {
  segment: Extract<Segment, { kind: "subagent-card" }>;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const agent = subagents?.get(segment.subagentId);
  const active = roundStatus === "streaming" && agent?.status === "running";
  useEffect(() => setExpanded(false), [active, segment.subagentId]);
  const status = agent?.status === "running" && !active ? "aborted" : (agent?.status ?? "pending");
  const children = agent?.segments ?? [];
  return (
    <section className="research-subagent" data-status={status}>
      <button
        type="button"
        className="research-tool-header"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        <GitBranch size={14} aria-hidden="true" />
        <span className="research-process-title">{agent?.label || segment.label}</span>
        <ProcessStatusIcon status={status} />
        <span className="research-tool-state">
          {agent ? processStatusLabels[status] : "等待状态"}
        </span>
        <ChevronDown
          size={13}
          className={expanded ? "research-chevron is-open" : "research-chevron"}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div id={id} className="research-subagent-body">
          {agent?.currentTool && active && (
            <p className="research-process-note">正在执行：{agent.currentTool}</p>
          )}
          {ancestorIds.includes(segment.subagentId) ? (
            <p className="research-process-note">该子任务已在上层展示。</p>
          ) : children.length ? (
            <SegmentList
              segments={children}
              roundStatus={active ? "streaming" : "done"}
              toolCalls={toolCalls}
              subagents={subagents}
              ancestorIds={[...ancestorIds, segment.subagentId]}
            />
          ) : (
            <p className="research-process-note">
              {active ? "等待子任务执行记录…" : "暂无子任务执行记录。"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function SegmentList({
  segments,
  roundStatus,
  toolCalls,
  subagents,
  ancestorIds,
}: SegmentListProps) {
  return (
    <div className="research-segments">
      {[...segments]
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((segment) => (
          <div
            className="research-segment"
            key={segment.id}
            data-segment-id={segment.id}
            data-phase-index={segment.context.phaseIndex}
          >
            {segment.kind === "narration" && segment.text && (
              <div className="research-narration">
                <Markdown text={segment.text} />
              </div>
            )}
            {segment.kind === "phase-marker" && <PhaseMarker segment={segment} />}
            {segment.kind === "tool-batch" && (
              <div className="research-tool-batch">
                {segment.toolCallIds.length > 1 && (
                  <p className="research-process-note">
                    本次调用 · {segment.toolCallIds.length} 个工具
                  </p>
                )}
                {segment.toolCallIds.map((callId) => {
                  const tool = toolCalls.get(callId);
                  return tool ? (
                    <ToolCallDetails key={callId} tool={tool} roundStatus={roundStatus} />
                  ) : (
                    <p key={callId} className="research-process-note">
                      {roundStatus === "streaming" ? "等待工具调用详情…" : "未收到工具调用详情。"}
                    </p>
                  );
                })}
              </div>
            )}
            {segment.kind === "subagent-card" && (
              <SubagentDetails
                segment={segment}
                roundStatus={roundStatus}
                toolCalls={toolCalls}
                subagents={subagents}
                ancestorIds={ancestorIds}
              />
            )}
          </div>
        ))}
    </div>
  );
}

export function ExecutionTimeline({
  round,
  toolCalls = emptyTools,
  subagents,
  showEmpty = true,
}: ExecutionTimelineProps) {
  const segments = [...round.segments];
  const representedAgents = new Set(
    segments.flatMap((segment) => (segment.kind === "subagent-card" ? [segment.subagentId] : [])),
  );
  for (const agent of subagents?.values() ?? []) {
    if (agent.parentRoundId !== round.id || representedAgents.has(agent.id)) continue;
    segments.push({
      kind: "subagent-card",
      id: `subagent-card:${agent.id}`,
      subagentId: agent.id,
      label: agent.label,
      startedAt: agent.startedAt,
      context: { subagentId: agent.id },
    });
  }
  if (!segments.length)
    return !showEmpty ? null : (
      <div className="research-execution-empty">
        {round.status === "streaming" ? (
          <TypingIndicator label="等待执行事件" />
        ) : (
          <p className="research-process-note">暂无执行记录</p>
        )}
      </div>
    );
  return (
    <div className="research-execution" aria-label="研究执行过程">
      <SegmentList
        segments={segments}
        roundStatus={round.status}
        toolCalls={toolCalls}
        subagents={subagents}
      />
    </div>
  );
}
