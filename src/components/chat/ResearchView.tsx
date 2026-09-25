import { useEffect, useLayoutEffect, useRef } from "react";
import { Check, Copy, FileText, Loader2, RotateCcw, ArrowDown, Paperclip } from "lucide-react";
import { useWorkspace } from "../../state";
import { retryResearch, selectResearch } from "../../state/research";
import { useResearchCore } from "../../state/research-core";
import { ResearchActivity } from "../research";
import { IconButton, copyText } from "../ui";
import { Markdown } from "./Markdown";
import { Composer } from "./Composer";
import { WelcomeResearch } from "./WelcomeResearch";
// Scroll offsets are transient UI state; avoid rerendering the workbench on each scroll event.
const scrollPositions = new Map<string, number>();
export function ResearchView() {
  const { sessions, currentSessionId, notify, openFile } = useWorkspace();
  const session = sessions.find((s) => s.id === currentSessionId);
  const core = useResearchCore((s) =>
    currentSessionId ? s.sessions[currentSessionId] : undefined,
  );
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const id = currentSessionId || "new";
  useLayoutEffect(() => {
    const node = scroll.current;
    if (node) node.scrollTop = scrollPositions.get(id) || 0;
    follow.current = !node || node.scrollHeight - node.scrollTop - node.clientHeight < 100;
  }, [id]);
  const last = session?.messages.at(-1);
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [last?.text, session?.messages.length]);
  const empty = !session?.messages.length;
  if (session?.loadingHistory)
    return (
      <div className="empty-state" role="status">
        <Loader2 size={22} className="spin" />
        <p>正在恢复研究记录…</p>
      </div>
    );
  if (session?.historyError)
    return (
      <div className="empty-state">
        <p role="alert">{session.historyError}</p>
        <button className="page-button" onClick={() => void selectResearch(session.id, true)}>
          重新读取历史
        </button>
      </div>
    );
  if (empty) return <WelcomeResearch />;
  return (
    <div className={`research-view ${empty ? "is-welcome" : ""}`}>
      {session?.recoveryPending && (
        <div className="research-recovery-note" role="status">
          已恢复研究记录，正在等待后端状态。
          <button className="text-button" onClick={() => void selectResearch(session.id, true)}>
            刷新状态
          </button>
        </div>
      )}
      <div
        className="conversation-scroll"
        ref={scroll}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          scrollPositions.set(id, el.scrollTop);
        }}
      >
        <div className="conversation">
          {!empty &&
            session.messages.map((message) =>
              message.role === "user" ? (
                <div className="user-message" key={message.id}>
                  <div>{message.text}</div>
                  {message.attachments?.length ? (
                    <div className="message-attachments">
                      {message.attachments.map((a) => (
                        <span key={a.id}>
                          <Paperclip size={13} />
                          {a.fileId ? (
                            <button className="attachment-link" onClick={() => openFile(a.fileId!)}>
                              {a.name}
                            </button>
                          ) : (
                            a.name
                          )}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <article className="assistant-message" key={message.id}>
                  <div className="answer-byline">
                    <span className="agent-mark">A</span>
                    <strong>AURORA</strong>
                    <span className="answer-status">
                      {message.phase === "running" ? (
                        <>
                          <Loader2 size={12} className="spin" />
                          {session?.recoveryPending ? "状态待确认" : "研究中"}
                        </>
                      ) : message.phase === "completed" ? (
                        <>
                          <Check size={12} />
                          研究完成
                        </>
                      ) : message.phase === "stopped" ? (
                        "已停止"
                      ) : message.phase === "failed" ? (
                        "未完成"
                      ) : (
                        ""
                      )}
                    </span>
                  </div>
                  {message.engineRoundId &&
                    core &&
                    (() => {
                      const round = core.rounds.find((r) => r.id === message.engineRoundId);
                      return round ? (
                        <ResearchActivity
                          round={round}
                          toolCalls={core.toolCalls}
                          subagents={core.subagents}
                          showExecution={false}
                        />
                      ) : null;
                    })()}
                  {message.text ? (
                    <Markdown text={message.text} streaming={message.phase === "running"} />
                  ) : message.phase === "running" &&
                    (!message.engineRoundId ||
                      !core?.rounds.some((r) => r.id === message.engineRoundId)) ? (
                    <div className="thinking-placeholder">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : null}
                  {message.error &&
                    (!message.engineRoundId ||
                      !core?.rounds.some((r) => r.id === message.engineRoundId)) && (
                      <div className="inline-error" role="alert">
                        {message.error}
                      </div>
                    )}
                  {!!message.fileIds?.length && (
                    <div className="answer-files">
                      {message.fileIds.map((fileId) => {
                        const file = useWorkspace.getState().files.find((f) => f.id === fileId);
                        return file ? (
                          <button key={fileId} onClick={() => openFile(fileId)}>
                            <FileText size={19} />
                            <span>
                              <strong>{file.name}</strong>
                              <small>研究文件 · 点击阅读</small>
                            </span>
                          </button>
                        ) : null;
                      })}
                    </div>
                  )}
                  {message.phase !== "running" && (
                    <div className="answer-actions">
                      <IconButton
                        label="复制回答"
                        onClick={() =>
                          void copyText(message.text).then((ok) =>
                            notify(
                              ok ? "回答已复制" : "复制失败，请手动选择文字。",
                              ok ? "info" : "error",
                            ),
                          )
                        }
                      >
                        <Copy size={15} />
                      </IconButton>
                      {message === last &&
                        (message.phase === "failed" || message.phase === "stopped") && (
                          <button className="text-button" onClick={retryResearch}>
                            <RotateCcw size={14} />
                            重试上一条
                          </button>
                        )}
                    </div>
                  )}
                </article>
              ),
            )}
        </div>
      </div>
      <div className="composer-dock">
        {!empty && (
          <button
            className="scroll-latest"
            aria-label="滚动到最新内容"
            onClick={() => {
              follow.current = true;
              if (scroll.current)
                scroll.current.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" });
            }}
          >
            <ArrowDown size={15} />
          </button>
        )}
        <Composer />
      </div>
    </div>
  );
}
