import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Download, FileText, Pencil, Printer, MessageSquare } from "lucide-react";
import { useWorkspace } from "../state";
import { Markdown } from "./chat";
import { Modal, downloadText } from "./ui";
export function FileReader() {
  const s = useWorkspace();
  const file = s.files.find((f) => f.id === s.selectedFileId)!;
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(file.content);
  const [confirmExit, setConfirmExit] = useState(false);
  const pendingNavigation = useRef<HTMLElement | null>(null);
  const allowNavigation = useRef(false);
  const dirty = content !== file.content || (!file.readOnly && !!s.persistenceError);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const captureNavigation = (event: MouseEvent) => {
      if (allowNavigation.current) return;
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        ".workspace-entry,.thread-main,.new-research,.brand,.evidence-file,[data-navigation]",
      );
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      pendingNavigation.current = button;
      setConfirmExit(true);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", captureNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", captureNavigation, true);
    };
  }, [dirty]);
  function leave() {
    allowNavigation.current = true;
    if (pendingNavigation.current) pendingNavigation.current.click();
    else s.closeFile();
  }
  function save() {
    if (file.readOnly) return false;
    if (!s.saveFile({ ...file, content, updatedAt: Date.now() })) {
      setEditing(true);
      s.notify("保存未成功，内容仍在当前页面。请下载备份或腾出浏览器存储空间后重试。", "error");
      return false;
    }
    setEditing(false);
    s.notify("文件已保存到本地工作区。");
    return true;
  }
  function reference() {
    s.addAttachments([{ id: crypto.randomUUID(), name: file.name, content }]);
    s.closeFile();
    s.navigate("research");
    s.notify("已加入当前研究的附件。");
  }
  return (
    <div className="reader">
      <header className="reader-toolbar">
        <button
          className="page-back"
          onClick={() => (dirty ? setConfirmExit(true) : s.closeFile())}
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <div className="reader-title">
          <FileText size={16} />
          <strong>{file.name}</strong>
          {dirty && <span>未保存</span>}
        </div>
        <div className="reader-actions">
          <button
            className="page-button"
            disabled={file.readOnly}
            title={file.readOnly ? "后端附件以只读方式打开" : undefined}
            onClick={() => (editing ? save() : setEditing(true))}
          >
            {editing ? <Check size={15} /> : <Pencil size={15} />}
            <span>{editing ? "保存" : "编辑"}</span>
          </button>
          <button className="page-button" onClick={() => downloadText(file.name, content)}>
            <Download size={15} />
            <span>下载</span>
          </button>
          <button
            className="page-button"
            onClick={() => {
              setEditing(false);
              setTimeout(() => window.print(), 100);
            }}
          >
            <Printer size={15} />
            <span>打印 / PDF</span>
          </button>
        </div>
      </header>
      <div className="reader-scroll">
        {editing ? (
          <textarea
            className="document-editor"
            aria-label="编辑文件内容"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <article className="document-body">
            <div className="document-meta">
              {file.folder} <span>·</span> {new Date(file.updatedAt).toLocaleDateString("zh-CN")}
            </div>
            <Markdown text={content} />
          </article>
        )}
      </div>
      <footer>
        <span>
          {content.length.toLocaleString()} 字符 ·{" "}
          {file.readOnly ? "只读附件" : dirty ? "有未保存修改" : "已保存"}
        </span>
        <button className="text-button" onClick={reference}>
          <MessageSquare size={15} />
          带入研究
        </button>
      </footer>
      {confirmExit && (
        <Modal
          title="保留文件修改？"
          onClose={() => {
            setConfirmExit(false);
            pendingNavigation.current = null;
          }}
        >
          <p>当前文件有未保存的修改。</p>
          <div className="page-form-actions">
            <button className="page-button" onClick={leave}>
              放弃修改
            </button>
            <button
              className="page-button page-button-primary"
              onClick={() => {
                if (save()) leave();
              }}
            >
              保存并返回
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
