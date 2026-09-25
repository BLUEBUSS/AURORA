import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  ListChecks,
  PanelRightClose,
} from "lucide-react";
import { useWorkspace } from "../../state";
import { IconButton } from "../ui";
import { useResearchCore } from "../../state/research-core";
import { ExecutionTimeline } from "../research";
export function EvidencePanel() {
  const state = useWorkspace();
  const session = state.sessions.find((s) => s.id === state.currentSessionId);
  const answer = session?.messages.findLast((m) => m.role === "assistant");
  const core = useResearchCore((s) =>
    state.currentSessionId ? s.sessions[state.currentSessionId] : undefined,
  );
  const round = core?.rounds.find((r) => r.id === answer?.engineRoundId);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [answer?.id, answer?.phase]);
  const running = answer?.phase === "running";
  const sources = answer?.sources || [];
  const files = (answer?.fileIds || []).flatMap((id) => {
    const file = state.files.find((f) => f.id === id);
    return file ? [file] : [];
  });
  const process = (
    <section className="evidence-section process-section">
      <button
        className="section-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <ListChecks size={16} />
        <strong>研究过程</strong>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {!expanded && (
        <p className="process-summary">
          {running ? (
            <>
              <Loader2 className="spin" size={13} />
              {answer?.steps?.find((s) => s.status === "running")?.title || "正在研究"}
            </>
          ) : answer?.phase === "completed" ? (
            <>
              <Check size={13} />
              本轮研究已完成
            </>
          ) : answer?.phase === "stopped" ? (
            "本轮研究已停止"
          ) : answer?.phase === "failed" ? (
            "研究遇到问题"
          ) : (
            "等待开始研究"
          )}
        </p>
      )}
      {expanded &&
        (round && core ? (
          <ExecutionTimeline round={round} toolCalls={core.toolCalls} subagents={core.subagents} />
        ) : (
          <ol className="process-list">
            {answer?.steps?.map((step) => (
              <li key={step.id}>
                <span className={`step-status ${step.status}`}>
                  {step.status === "done" ? (
                    <Check size={12} />
                  ) : step.status === "running" ? (
                    <Loader2 className="spin" size={12} />
                  ) : (
                    <span>·</span>
                  )}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        ))}
      {answer?.error && <p className="process-error">{answer.error}</p>}
    </section>
  );
  return (
    <aside className="evidence-panel" aria-label="研究资料">
      <header className="panel-heading">
        <span>研究资料</span>
        <IconButton
          label="收起研究资料"
          onClick={() => useWorkspace.setState({ rightOpen: false, mobilePanel: null })}
        >
          <PanelRightClose size={17} />
        </IconButton>
      </header>
      <div className="evidence-scroll">
        {running && process}
        <section className="evidence-section">
          <div className="section-label">
            <strong>{state.mode === "demo" ? "参考入口" : "引用来源"}</strong>
            <span>{sources.length.toString().padStart(2, "0")}</span>
          </div>
          {sources.length ? (
            sources.map((source, i) => (
              <a
                key={source.id}
                className="source-row"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="source-number">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{source.title}</strong>
                  <small>
                    <Globe size={11} />
                    {source.publisher}
                  </small>
                </div>
                <ExternalLink size={12} />
              </a>
            ))
          ) : (
            <p className="panel-empty">{running ? "来源将在研究过程中出现" : "暂无引用来源"}</p>
          )}
          {state.mode === "demo" && sources.length > 0 && (
            <p className="subtle-note">官方资料入口示例，未在本轮检索。</p>
          )}
        </section>
        <section className="evidence-section">
          <div className="section-label">
            <strong>生成文件</strong>
            <span>{files.length.toString().padStart(2, "0")}</span>
          </div>
          {files.length ? (
            files.map((file) => (
              <button
                key={file.id}
                className="evidence-file"
                onClick={() => state.openFile(file.id)}
              >
                <FileText size={19} />
                <span>
                  {file.name}
                  <small>Markdown · 阅读</small>
                </span>
                <ChevronRight size={13} />
              </button>
            ))
          ) : (
            <p className="panel-empty">{running ? "完成后将在此展示研究文件" : "暂无生成文件"}</p>
          )}
        </section>
        {!running && process}
        {session?.company && (
          <div className="instrument-note">
            <span className="overline">研究对象</span>
            <strong>
              {session.company.name} <span>{session.company.ticker}</span>
            </strong>
            <p>公司 / 股票</p>
            <div>交易合约的报价、杠杆与资金费率需单独核对。</div>
          </div>
        )}
      </div>
    </aside>
  );
}
