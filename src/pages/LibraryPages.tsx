import { useRef, useState, type FormEvent } from "react";
import {
  FileText,
  Folder,
  FolderOpen,
  Plus,
  Upload,
  Trash2,
  ArrowUpRight,
  Search,
} from "lucide-react";
import { useWorkspace } from "../state";
import { EmptyState, Field, IconButton, Modal } from "../components/ui";
import {
  ConfirmRemoval,
  PageHeading,
  LivePageNotice,
  PageSearch,
  formatDate,
  FormError,
  folderPath,
  validFolder,
} from "./page-utils";
import type { ResearchFile } from "../types";
export function FilesPage() {
  const s = useWorkspace();
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
  const [editing, setEditing] = useState(false);
  const [remove, setRemove] = useState<ResearchFile | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (s.mode === "live") return <LivePageNotice title="文件" />;
  const folders = [
    ...new Set(
      s.files.flatMap((f) => {
        const parts = f.folder.split("/");
        return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
      }),
    ),
  ]
    .filter(Boolean)
    .sort();
  const files = s.files.filter(
    (f) =>
      (!folder || f.folder === folder || f.folder.startsWith(`${folder}/`)) &&
      `${f.name} ${f.content}`.toLowerCase().includes(query.toLowerCase()),
  );
  async function upload(list: FileList | null) {
    if (!list) return;
    for (const file of list) {
      if (!/\.(md|txt|csv|json)$/i.test(file.name) || file.size > 500_000) {
        s.notify("请选择不超过 500 KB 的 Markdown、TXT、CSV 或 JSON 文件。", "error");
        continue;
      }
      try {
        const saved = s.saveFile({
          id: crypto.randomUUID(),
          name: file.name,
          folder: folder || "导入资料",
          content: await file.text(),
          kind: file.name.endsWith(".md") ? "markdown" : "text",
          updatedAt: Date.now(),
        });
        s.notify(
          saved
            ? "文件已导入本地演示工作区。"
            : "文件仅在当前页面保留，浏览器存储不足或不可用。请打开文件下载备份，避免刷新丢失。",
          saved ? "info" : "error",
        );
      } catch {
        s.notify("无法读取该文件。", "error");
      }
    }
    if (input.current) input.current.value = "";
  }
  return (
    <div className="page-content">
      <PageHeading
        title="文件"
        description="研究资料与工作笔记，按文件夹归档。"
        actions={
          <>
            <input
              type="file"
              ref={input}
              hidden
              multiple
              accept=".md,.txt,.csv,.json"
              onChange={(e) => void upload(e.target.files)}
            />
            <button className="page-button" onClick={() => input.current?.click()}>
              <Upload size={16} />
              导入文件
            </button>
            <button className="page-button page-button-primary" onClick={() => setEditing(true)}>
              <Plus size={16} />
              新建文件
            </button>
          </>
        }
      />
      <div className="page-toolbar">
        <PageSearch value={query} onChange={setQuery} label="搜索文件内容" />
        <span className="page-count">{files.length} 个文件</span>
      </div>
      <div className="file-workspace">
        <nav className="folder-tree" aria-label="文件夹">
          <button className={!folder ? "selected" : ""} onClick={() => setFolder("")}>
            <FolderOpen size={16} />
            所有文件
          </button>
          {folders.map((f) => (
            <button
              key={f}
              className={folder === f ? "selected" : ""}
              style={{ paddingLeft: 12 + (f.split("/").length - 1) * 14 }}
              onClick={() => setFolder(f)}
            >
              <Folder size={15} />
              <span>{f.split("/").at(-1)}</span>
            </button>
          ))}
        </nav>
        <section className="file-list">
          <div className="list-column-header">
            <span>名称</span>
            <span>最近修改</span>
            <span />
          </div>
          {files.length ? (
            files.map((f) => (
              <div className="file-row" key={f.id}>
                <button className="page-row-main" onClick={() => s.openFile(f.id)}>
                  <FileText size={19} />
                  <span className="page-row-copy">
                    <strong>{f.name}</strong>
                    <small>{f.folder || "根目录"}</small>
                  </span>
                </button>
                <time>{formatDate(f.updatedAt)}</time>
                <IconButton label={`删除 ${f.name}`} onClick={() => setRemove(f)}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            ))
          ) : (
            <EmptyState
              icon={<Search size={24} />}
              title="没有匹配的文件"
              description="清空搜索，或导入一份研究资料。"
            />
          )}
        </section>
      </div>
      {editing && <NewFile initialFolder={folder} onClose={() => setEditing(false)} />}{" "}
      {remove && (
        <ConfirmRemoval
          title="删除文件"
          onClose={() => setRemove(null)}
          onConfirm={() => {
            s.removeFile(remove.id);
            setRemove(null);
            s.notify("本地文件已删除。");
          }}
        >
          <p>确认删除「{remove.name}」？此操作仅影响本地演示数据。</p>
        </ConfirmRemoval>
      )}
    </div>
  );
}
function NewFile({ initialFolder, onClose }: { initialFolder: string; onClose: () => void }) {
  const s = useWorkspace();
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(initialFolder || "研究笔记");
  const [project, setProject] = useState("");
  const [error, setError] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || /[\\/:*?"<>|]/.test(name))
      return setError("请输入有效的文件名，不包含路径符号。");
    if (!validFolder(folderPath(folder))) return setError("文件夹路径无效。");
    const id = crypto.randomUUID();
    const filename = /\.md$/i.test(name) ? name.trim() : `${name.trim()}.md`;
    const saved = s.saveFile({
      id,
      name: filename,
      folder: folderPath(folder),
      projectId: project || undefined,
      kind: "markdown",
      content: `# ${name.replace(/\.md$/, "")}\n\n`,
      updatedAt: Date.now(),
    });
    onClose();
    s.openFile(id);
    if (!saved)
      s.notify("文件仅在当前页面保留，浏览器存储不足或不可用。请下载备份或腾出空间后重新保存。", "error");
  }
  return (
    <Modal title="新建研究文件" onClose={onClose}>
      <form className="page-form" onSubmit={submit}>
        <Field label="文件名">
          <input
            autoFocus
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder="研究笔记.md"
          />
        </Field>
        <Field label="文件夹">
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="AI 算力产业链/研究笔记"
          />
        </Field>
        <Field label="所属项目">
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">未归入项目</option>
            {s.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <FormError message={error} />
        <div className="page-form-actions">
          <button type="button" className="page-button" onClick={onClose}>
            取消
          </button>
          <button className="page-button page-button-primary">创建文件</button>
        </div>
      </form>
    </Modal>
  );
}
export function ReportsPage() {
  const s = useWorkspace();
  const [query, setQuery] = useState("");
  if (s.mode === "live") return <LivePageNotice title="报告" />;
  const files = s.files.filter(
    (f) => f.report && `${f.name} ${f.content}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="page-content">
      <PageHeading title="报告" description="让每一轮研究，沉淀为可回溯的判断。" />
      <div className="page-toolbar">
        <PageSearch value={query} onChange={setQuery} label="搜索研究报告" />
        <span className="page-count">{files.length} 份报告</span>
      </div>
      {files.length ? (
        <div className="report-list">
          {files.map((f) => (
            <button key={f.id} className="report-card" onClick={() => s.openFile(f.id)}>
              <div className="report-cover">
                <FileText size={28} strokeWidth={1} />
                <span>RESEARCH NOTE</span>
              </div>
              <div className="report-copy">
                <span className="overline">
                  {s.projects.find((p) => p.id === f.projectId)?.name || "研究报告"}
                </span>
                <h2>{f.name.replace(/\.md$/, "")}</h2>
                <p>{f.content.replace(/[#*>|\n]/g, " ").slice(0, 112)}</p>
                <small>{formatDate(f.updatedAt)} · Markdown</small>
              </div>
              <ArrowUpRight size={18} />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FileText size={28} />}
          title="暂无研究报告"
          description="完成研究后，生成的文件会出现在这里。"
          action={
            <button className="page-button" onClick={() => s.newSession()}>
              新建研究
            </button>
          }
        />
      )}
    </div>
  );
}
