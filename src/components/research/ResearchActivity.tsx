// Adapted from ANLYST/OpenClaw RoundBlock (MIT), with props replacing store access.
// Copyright (c) 2025 Peter Steinberger. See docs/licenses/OpenClaw-MIT.txt.
import {
  selectConclusionText,
  selectPreplanThinkingText,
  selectReportThinkingText,
} from "../../engine";
import { ExecutionTimeline, type ExecutionTimelineProps } from "./ExecutionTimeline";
import { TypingIndicator } from "./ProcessPrimitives";
import { TaskPlanDetails } from "./TaskPlanDetails";
import { ThinkingDetails } from "./ThinkingDetails";
import { thinkingStatus } from "./process-view";

export interface ResearchActivityProps extends Omit<ExecutionTimelineProps, "showEmpty"> {
  /** Set false when the surrounding evidence panel renders ExecutionTimeline. */
  showExecution?: boolean;
  onPhaseClick?: (phaseIndex: number) => void;
}

/** Renders backend-derived process only; the parent owns the answer and composer. */
export function ResearchActivity({
  round,
  toolCalls,
  subagents,
  showExecution = true,
  onPhaseClick,
}: ResearchActivityProps) {
  const preplanText = selectPreplanThinkingText(round);
  const reportText = selectReportThinkingText(round);
  const conclusionText = selectConclusionText(round);
  const hasExecution =
    round.segments.length > 0 ||
    [...(subagents?.values() ?? [])].some((agent) => agent.parentRoundId === round.id);
  const waiting =
    round.status === "streaming" &&
    !preplanText &&
    !reportText &&
    !round.task &&
    !conclusionText &&
    !hasExecution;
  const terminalNotice = round.status === "failed" || round.status === "aborted";
  if (
    !waiting &&
    !preplanText &&
    !reportText &&
    !round.task &&
    !(showExecution && hasExecution) &&
    !terminalNotice
  )
    return null;
  return (
    <div className="research-activity" data-round-id={round.id}>
      {waiting && <TypingIndicator />}
      {preplanText && (
        <ThinkingDetails
          key={`${round.id}:preplan`}
          text={preplanText}
          status={thinkingStatus(round, "pre-plan")}
        />
      )}
      {round.task && (
        <TaskPlanDetails key={`${round.id}:task`} round={round} onPhaseClick={onPhaseClick} />
      )}
      {showExecution && hasExecution && (
        <ExecutionTimeline
          round={round}
          toolCalls={toolCalls}
          subagents={subagents}
          showEmpty={false}
        />
      )}
      {reportText && (
        <ThinkingDetails
          key={`${round.id}:report`}
          text={reportText}
          status={thinkingStatus(round, "report")}
          phase="report"
        />
      )}
      {round.status === "failed" && (
        <p className="research-process-error" role="alert">
          {round.failureReason || "本轮研究未完成，请重试。"}
        </p>
      )}
      {round.status === "aborted" && <p className="research-process-note">本轮研究已停止。</p>}
    </div>
  );
}
