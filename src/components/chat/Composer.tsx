import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUp,
  BrainCircuit,
  Cpu,
  MessageCircle,
  Paperclip,
  Square,
  X,
  Loader2,
} from "lucide-react";
import { useWorkspace } from "../../state";
import { useConnection, sendResearch, stopResearch } from "../../state/research";
import { IconButton, SelectionMenu, type SelectionOption } from "../ui";
import { useAdaptiveComposer } from "../../hooks";

const researchModes: readonly SelectionOption[] = [
  {
    value: "深度研究",
    label: "深度研究",
    description: "适合多步分析与资料核验。",
    icon: <BrainCircuit />,
  },
  {
    value: "快速问答",
    label: "快速问答",
    description: "聚焦单一问题，直接交流和追问。",
    icon: <MessageCircle />,
  },
];
export function Composer() {
  const state = useWorkspace();
  const models = useConnection((s) => s.models);
  const session = state.sessions.find((s) => s.id === state.currentSessionId);
  const running = session?.messages.some((m) => m.phase === "running") || false;
  const draft = state.drafts[state.currentSessionId || "new"] || { text: "", attachments: [] };
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const { formRef, textareaRef, optionsRef, expanded } = useAdaptiveComposer(
    draft.text,
    state.currentSessionId || "new",
    draft.attachments.length > 0,
  );
  const modelLocked = !!session?.messages.length && state.mode === "live";
  const modelValue = state.mode === "demo" ? "demo" : session?.model || state.model;
  const modelOptions = useMemo<SelectionOption[]>(() => {
    if (state.mode === "demo")
      return [
        {
          value: "demo",
          label: "演示模型",
          description: "本地交互演示，不调用真实模型。",
          icon: <Cpu />,
        },
      ];
    const unique = new Map(models.map((model) => [`${model.provider}/${model.id}`, model]));
    return [
      { value: "", label: "后端默认模型", description: "使用后端配置的默认模型。", icon: <Cpu /> },
      ...Array.from(unique, ([value, model]) => ({
        value,
        label: model.name || model.id,
        description: model.provider,
        icon: <Cpu />,
      })),
    ];
  }, [state.mode, models]);
  function keyboard(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (!running && !reading) void sendResearch();
    }
  }
  async function attach(files: FileList | null) {
    if (!files) return;
    // Reading may finish after the user switches conversations.
    const draftKey = state.currentSessionId || "new";
    setReading(true);
    try {
      const out = [];
      for (const file of files) {
        if (!/\.(md|txt|csv|json|log)$/i.test(file.name)) {
          state.notify("当前原型支持 Markdown、TXT、CSV、JSON 文本附件。", "error");
          continue;
        }
        if (file.size > 500_000) {
          state.notify(`${file.name} 超过 500 KB，请选择较小的文本。`, "error");
          continue;
        }
        out.push({
          id: crypto.randomUUID(),
          name: file.name,
          content: await file.text(),
          mimeType: file.type,
        });
      }
      const current = useWorkspace.getState();
      if (
        current.mode !== state.mode ||
        current.liveScope?.userId !== state.liveScope?.userId ||
        current.liveScope?.agentId !== state.liveScope?.agentId
      ) {
        current.notify("研究账户已切换，请在当前账户重新选择附件。", "error");
        return;
      }
      state.addAttachments(out, draftKey);
    } catch {
      state.notify("附件读取失败，请重新选择文件。", "error");
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="composer-wrap">
      <form
        ref={formRef}
        className={`composer ${expanded ? "is-expanded" : ""} ${draft.attachments.length ? "has-attachments" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!running && !reading) void sendResearch();
        }}
      >
        {draft.attachments.length > 0 && (
          <div className="attachments">
            {draft.attachments.map((a) => (
              <span key={a.id}>
                <Paperclip size={13} />
                {a.name}
                <IconButton
                  label={`移除附件 ${a.name}`}
                  onClick={() => state.removeAttachment(a.id)}
                >
                  <X size={13} />
                </IconButton>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          aria-label="研究问题"
          value={draft.text}
          onChange={(e) => state.setDraft(e.target.value)}
          onKeyDown={keyboard}
          placeholder={running ? "输入下一条草稿…" : "输入研究问题…"}
          rows={1}
        />
        <div className="composer-controls">
          <input
            ref={input}
            type="file"
            multiple
            accept=".md,.txt,.csv,.json,.log"
            hidden
            onChange={(e) => void attach(e.target.files)}
          />
          <IconButton
            className="composer-attachment"
            label="添加附件"
            disabled={reading}
            onClick={() => input.current?.click()}
          >
            {reading ? <Loader2 size={18} className="spin" /> : <Paperclip size={18} />}
          </IconButton>
          <div ref={optionsRef} className="composer-options">
            <SelectionMenu
              key={`mode-${state.mode}-${state.currentSessionId || "new"}`}
              label="研究模式"
              value={state.researchMode}
              options={researchModes}
              onChange={(researchMode) => useWorkspace.setState({ researchMode })}
            />
            <span className="control-divider" />
            <SelectionMenu
              key={`model-${state.mode}-${state.currentSessionId || "new"}`}
              label="模型"
              disabled={modelLocked}
              disabledReason={
                modelLocked ? "本会话已发送消息，模型已锁定。新建研究可选择其他模型。" : undefined
              }
              value={modelValue}
              fallbackLabel={modelValue}
              options={modelOptions}
              icon={<Cpu />}
              width={320}
              onChange={(model) => useWorkspace.setState({ model })}
            />
          </div>
          {/* Keep a stable button type: a synchronous stop must not turn this click into form submission. */}
          <button
            className={`send-button ${running ? "is-running" : ""}`}
            type="button"
            aria-label={running ? (state.stopping ? "正在停止" : "停止研究") : "发送研究问题"}
            title={running ? "停止研究" : "发送 · Enter"}
            disabled={
              running
                ? state.stopping
                : reading || (!draft.text.trim() && !draft.attachments.length)
            }
            onClick={() => (running ? void stopResearch() : void sendResearch())}
          >
            {state.stopping ? (
              <Loader2 size={17} className="spin" />
            ) : running ? (
              <Square size={14} fill="currentColor" strokeWidth={0} />
            ) : (
              <ArrowUp size={20} strokeWidth={1.8} />
            )}
          </button>
        </div>
      </form>
      <div className="composer-caption">
        {running
          ? "草稿将在本轮结束后由你手动发送"
          : state.mode === "demo"
            ? "本地交互演示 · 未调用 AI 或实时数据"
            : "AURORA · 请结合原始来源核验研究结论"}
      </div>
    </div>
  );
}
