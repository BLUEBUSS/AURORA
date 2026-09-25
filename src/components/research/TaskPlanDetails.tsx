// Adapted from ANLYST/OpenClaw TaskPanel and RoundBlock (MIT).
// Copyright (c) 2025 Peter Steinberger. See docs/licenses/OpenClaw-MIT.txt.
import { ChevronDown, ListChecks } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { Round } from "../../engine";
import { Markdown } from "../chat/Markdown";
import { ProcessStatusIcon } from "./ProcessPrimitives";
import { processStatusLabels, selectPhaseViews } from "./process-view";

export interface TaskPlanDetailsProps {
  round: Round;
  onPhaseClick?: (phaseIndex: number) => void;
}

export function TaskPlanDetails({ round, onPhaseClick }: TaskPlanDetailsProps) {
  const id = useId();
  const active = round.status === "streaming";
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [active, round.id]);
  if (!round.task) return null;
  const phases = selectPhaseViews(round);
  const completed = phases.filter((phase) => phase.status === "done").length;
  const failed = phases.filter((phase) => phase.status === "failed").length;
  const skipped = phases.filter((phase) => phase.status === "skipped").length;
  const title =
    round.task.title || round.task.coreQuestion || round.task.core_question || "研究任务";
  const checkpoint = round.checkpointData?.message || round.task.checkpoint;
  return (
    <section className="research-task">
      <button
        type="button"
        className="research-process-header"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        <ListChecks size={15} aria-hidden="true" />
        <span className="research-process-title">{title}</span>
        {phases.length > 0 && (
          <span className="research-process-count">
            {completed}/{phases.length} 完成
          </span>
        )}
        <ChevronDown
          size={14}
          className={expanded ? "research-chevron is-open" : "research-chevron"}
          aria-hidden="true"
        />
      </button>
      {(failed > 0 || skipped > 0) && (
        <p className="research-process-note">
          {[failed > 0 && `${failed} 个阶段失败`, skipped > 0 && `${skipped} 个阶段跳过`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {expanded && (
        <div id={id} className="research-task-body">
          <ol className="research-phase-list">
            {phases.map((phase, index) => {
              const content = (
                <>
                  <span className="research-phase-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="research-phase-copy">
                    <span>{phase.title}</span>
                    {phase.summary && <small>{phase.summary}</small>}
                  </span>
                  <span className="research-phase-status">
                    <ProcessStatusIcon
                      status={phase.status === "running" && !active ? "aborted" : phase.status}
                    />
                    {phase.status === "running" && !active
                      ? "状态未更新"
                      : processStatusLabels[phase.status]}
                  </span>
                </>
              );
              return (
                <li key={phase.id} data-status={phase.status}>
                  {onPhaseClick ? (
                    <button
                      type="button"
                      className="research-phase-row"
                      onClick={() => onPhaseClick(index)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="research-phase-row">{content}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {checkpoint && (
        <div className="research-checkpoint">
          <span>研究检查点</span>
          <Markdown text={checkpoint} />
        </div>
      )}
    </section>
  );
}
