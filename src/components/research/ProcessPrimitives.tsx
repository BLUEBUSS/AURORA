// Adapted from ANLYST/OpenClaw TypingIndicator, ReasonHeader and ShimmerText (MIT).
// Copyright (c) 2025 Peter Steinberger. See docs/licenses/OpenClaw-MIT.txt.
import {
  Brain,
  Check,
  ChevronDown,
  Circle,
  Loader2,
  SkipForward,
  Square,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ProcessStatus } from "./process-view";

export function TypingIndicator({ label = "正在准备回复" }: { label?: string }) {
  return (
    <div className="research-waiting" role="status" aria-label={label} aria-live="polite">
      <span className="research-waiting-dots" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span key={index} />
        ))}
      </span>
      <span>{label}</span>
    </div>
  );
}

export function ShimmerText({ children }: { children: ReactNode }) {
  return <span className="research-shimmer">{children}</span>;
}

export function ProcessStatusIcon({ status }: { status: ProcessStatus }) {
  if (status === "running")
    return <Loader2 size={14} className="research-process-spin" aria-hidden="true" />;
  const Icon =
    status === "done"
      ? Check
      : status === "failed"
        ? XCircle
        : status === "skipped"
          ? SkipForward
          : status === "aborted"
            ? Square
            : Circle;
  return <Icon size={14} aria-hidden="true" />;
}

export interface ReasonHeaderProps {
  title: string;
  status: ProcessStatus;
  expanded: boolean;
  controls: string;
  canToggle: boolean;
  onToggle: () => void;
}

export function ReasonHeader({
  title,
  status,
  expanded,
  controls,
  canToggle,
  onToggle,
}: ReasonHeaderProps) {
  const active = status === "running" || status === "pending";
  const content = (
    <>
      <Brain size={15} aria-hidden="true" />
      {active ? <ShimmerText>{title}</ShimmerText> : <span>{title}</span>}
      {canToggle && (
        <ChevronDown
          size={14}
          className={expanded ? "research-chevron is-open" : "research-chevron"}
          aria-hidden="true"
        />
      )}
    </>
  );
  return canToggle ? (
    <button
      type="button"
      className="research-process-header"
      data-status={status}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
    >
      {content}
    </button>
  ) : (
    <div
      className="research-process-header"
      data-status={status}
      role={active ? "status" : undefined}
    >
      {content}
    </div>
  );
}
