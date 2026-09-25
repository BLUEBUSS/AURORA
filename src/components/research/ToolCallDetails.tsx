// Adapted from ANLYST/OpenClaw ToolBatchSegmentView and ToolDetailModal (MIT).
// Copyright (c) 2025 Peter Steinberger. See docs/licenses/OpenClaw-MIT.txt.
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { Round, ToolCallData } from "../../engine";
import { Markdown } from "../chat/Markdown";
import { ProcessStatusIcon } from "./ProcessPrimitives";
import {
  formatDuration,
  formatPayload,
  processStatusLabels,
  readableResult,
  toolStatus,
} from "./process-view";

export interface ToolCallDetailsProps {
  tool: ToolCallData;
  roundStatus: Round["status"];
}

function RawPayload({ value, label }: { value: unknown; label: string }) {
  const [full, setFull] = useState(false);
  const text = formatPayload(value);
  const long = text.length > 20000;
  return (
    <div className="research-tool-payload">
      <span>{label}</span>
      <pre>{long && !full ? `${text.slice(0, 20000)}\n…` : text}</pre>
      {long && (
        <button
          type="button"
          className="research-process-link"
          onClick={() => setFull((value) => !value)}
        >
          {full ? "收起完整内容" : "显示完整内容"}
        </button>
      )}
    </div>
  );
}

export function ToolCallDetails({ tool, roundStatus }: ToolCallDetailsProps) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const status = toolStatus(tool, roundStatus);
  const duration = formatDuration(tool.startedAt, tool.completedAt);
  const resultText = readableResult(tool.result);
  const resultExists = tool.result !== undefined && tool.result !== null;
  const title = tool.title || tool.toolName;
  return (
    <section className="research-tool" data-status={status} data-tool-call-id={tool.callId}>
      <button
        type="button"
        className="research-tool-header"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        <ProcessStatusIcon status={status} />
        <span className="research-process-title">{title}</span>
        <span className="research-tool-state">
          {status === "aborted" ? "未收到结果" : processStatusLabels[status]}
        </span>
        {duration && <span className="research-process-duration">{duration}</span>}
        <ChevronDown
          size={13}
          className={expanded ? "research-chevron is-open" : "research-chevron"}
          aria-hidden="true"
        />
      </button>
      {status === "failed" && !expanded && (
        <p className="research-tool-error-summary" role="alert">
          {resultText ? resultText.slice(0, 180) : "工具执行失败，展开查看返回内容。"}
        </p>
      )}
      {expanded && (
        <div id={id} className="research-tool-body">
          {tool.title && tool.title !== tool.toolName && (
            <p className="research-process-note">{tool.toolName}</p>
          )}
          {tool.params && (
            <details className="research-tool-arguments">
              <summary>调用参数</summary>
              <RawPayload value={tool.params} label="参数" />
            </details>
          )}
          {resultExists ? (
            <>
              <span className="research-tool-result-label">
                {status === "failed" ? "错误详情" : "工具结果"}
              </span>
              {resultText ? (
                <Markdown text={resultText} />
              ) : (
                <RawPayload value={tool.result} label="返回数据" />
              )}
              {resultText && (
                <details className="research-tool-arguments">
                  <summary>原始返回</summary>
                  <RawPayload value={tool.result} label="原始数据" />
                </details>
              )}
            </>
          ) : (
            <p className="research-process-note">
              {status === "running" || status === "pending"
                ? "等待工具返回结果…"
                : status === "done"
                  ? "工具已完成，未提供可展示的结果。"
                  : status === "failed"
                    ? "工具执行失败，后端未提供错误详情。"
                    : "本轮已结束，未收到该工具的完成结果。"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
