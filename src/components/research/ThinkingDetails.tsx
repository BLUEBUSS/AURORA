// Adapted from ANLYST/OpenClaw ThinkingCard and RoundBlock (MIT).
// Copyright (c) 2025 Peter Steinberger. See docs/licenses/OpenClaw-MIT.txt.
import { useEffect, useId, useMemo, useState } from "react";
import { Markdown } from "../chat/Markdown";
import { ReasonHeader } from "./ProcessPrimitives";
import { cleanThinkingText, type ProcessStatus } from "./process-view";

export interface ThinkingDetailsProps {
  text: string;
  status: ProcessStatus;
  phase?: "pre-plan" | "report";
  errorReason?: string;
}

export function ThinkingDetails({
  text,
  status,
  phase = "pre-plan",
  errorReason,
}: ThinkingDetailsProps) {
  const id = useId();
  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const active = status === "running" || status === "pending";
  const content = useMemo(() => cleanThinkingText(text), [text]);
  // AURORA's approved default is concise; details open on demand and fold at terminal.
  useEffect(() => setTerminalExpanded(false), [active, phase]);
  const expanded = terminalExpanded;
  const prefix = phase === "report" ? "报告思考" : "思考";
  const title = active
    ? `${prefix}中…`
    : status === "failed"
      ? `${prefix}中断`
      : status === "aborted"
        ? `${prefix}已停止`
        : `${prefix}完成`;
  if (!content && !active && !errorReason) return null;
  return (
    <section className="research-thinking" data-status={status}>
      <ReasonHeader
        title={title}
        status={status}
        expanded={expanded}
        controls={id}
        canToggle={!!content}
        onToggle={() => setTerminalExpanded((value) => !value)}
      />
      {errorReason && (
        <p className="research-process-error" role="alert">
          {errorReason}
        </p>
      )}
      {expanded && content && (
        <div id={id} className="research-thinking-body">
          <Markdown text={content} streaming={active} />
        </div>
      )}
    </section>
  );
}
