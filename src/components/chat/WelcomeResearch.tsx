import { useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useWorkspace } from "../../state";
import { researchExamples } from "../../data/research-examples";
import { Wordmark } from "../brand";
import { IconButton, Modal } from "../ui";
import { Composer } from "./Composer";
type Example = (typeof researchExamples)[number];
export function WelcomeResearch() {
  const [group, setGroup] = useState(0);
  const [pending, setPending] = useState<Example | null>(null);
  const apply = (example: Example) => {
    useWorkspace.getState().setDraft(example.prompt);
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="研究问题"]')?.focus(),
    );
  };
  const choose = (example: Example) => {
    const s = useWorkspace.getState();
    const draft = s.drafts[s.currentSessionId || "new"];
    if (draft?.text.trim() && draft.text !== example.prompt) setPending(example);
    else apply(example);
  };
  return (
    <div className="welcome-page">
      <div className="welcome-content">
        <div className="welcome-identity">
          <Wordmark />
          <span className="wordmark-rule" aria-hidden="true" />
        </div>
        <Composer />
        <section className="research-examples" aria-label="精选研究案例">
          <header>
            <div>
              <h2>精选研究</h2>
              <span>从一个具体问题开始</span>
            </div>
            <div className="case-pager">
              <small>{group + 1} / 2</small>
              <IconButton label="上一组研究案例" onClick={() => setGroup((g) => (g === 0 ? 1 : 0))}>
                <ChevronLeft size={15} />
              </IconButton>
              <IconButton label="下一组研究案例" onClick={() => setGroup((g) => (g === 0 ? 1 : 0))}>
                <ChevronRight size={15} />
              </IconButton>
            </div>
          </header>
          <div className="research-case-grid">
            {researchExamples.slice(group * 3, group * 3 + 3).map((example) => (
              <button
                className="research-case"
                key={example.id}
                onClick={() => choose(example)}
                aria-label={`使用案例：${example.title}`}
              >
                <div className="case-category">
                  <span>{example.category}</span>
                  <ArrowUpRight size={15} />
                </div>
                <div className="case-subject">
                  <strong>{example.ticker}</strong>
                  <span>{example.company}</span>
                </div>
                <h3>{example.title}</h3>
                <p>{example.description}</p>
                <div className="case-tags">
                  {example.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
          <p className="case-footnote">预设研究问题 · 点击带入输入框，编辑后发送</p>
        </section>
      </div>
      {pending && (
        <Modal title="替换当前草稿？" onClose={() => setPending(null)}>
          <p>输入框已有内容。使用「{pending.title}」会替换当前草稿，附件会保留。</p>
          <div className="page-form-actions">
            <button className="page-button" onClick={() => setPending(null)}>
              保留草稿
            </button>
            <button
              className="page-button page-button-primary"
              onClick={() => {
                apply(pending);
                setPending(null);
              }}
            >
              使用案例问题
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
