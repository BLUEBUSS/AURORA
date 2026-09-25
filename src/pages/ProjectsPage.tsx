import { ProjectEditor } from "../components/projects";
import {
  ArrowLeft,
  ArrowUpRight,
  FileText,
  Folder,
  FolderPlus,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { CompanyLogo, EmptyState, IconButton } from "../components/ui";
import { useWorkspace } from "../state";
import { selectResearch } from "../state/research";
import type { Project } from "../types";
import { ConfirmRemoval, PageHeading, PageSearch, formatDate } from "./page-utils";

export function ProjectsPage() {
  const {
    projects,
    sessions,
    files,
    mode,
    newSession,
    openFile,
    addProject,
    renameProject,
    removeProject,
    assignProject,
    notify,
  } = useWorkspace();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Project | "new" | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [attachSessionId, setAttachSessionId] = useState("");
  const selected = projects.find((project) => project.id === selectedId);
  const demoSessions = sessions.filter((session) => session.origin === mode && !session.archived);
  const visible = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return projects.filter((project) =>
      `${project.name} ${project.description}`.toLocaleLowerCase().includes(text),
    );
  }, [projects, query]);

  const saveProject = (name: string, description: string) => {
    if (editor && editor !== "new") renameProject(editor.id, name);
    else addProject(name, description);
    setEditor(null);
    notify(editor === "new" ? "项目已创建" : "项目名称已更新");
  };

  if (selected) {
    const projectSessions = demoSessions.filter((session) => session.projectId === selected.id);
    const projectFiles = files.filter((file) => file.projectId === selected.id);
    const otherSessions = demoSessions.filter((session) => session.projectId !== selected.id);
    return (
      <div className="page-content">
        <button
          className="page-back"
          onClick={() => {
            setSelectedId(null);
            setAttachSessionId("");
          }}
        >
          <ArrowLeft size={16} />
          全部项目
        </button>
        <PageHeading
          title={selected.name}
          description={selected.description || "集中整理相关会话与研究文件。"}
          actions={
            <>
              <IconButton label="重命名项目" onClick={() => setEditor(selected)}>
                <Pencil size={17} />
              </IconButton>
              <IconButton label="删除项目" onClick={() => setDeleting(selected)}>
                <Trash2 size={17} />
              </IconButton>
              <button
                className="page-button page-button-primary"
                onClick={() => newSession(selected.id)}
              >
                <Plus size={17} />
                新建研究
              </button>
            </>
          }
        />
        <div className="project-detail-grid">
          <section className="page-section" aria-labelledby="project-sessions-title">
            <div className="page-section-heading">
              <h2 id="project-sessions-title">研究会话</h2>
              <span>{projectSessions.length}</span>
            </div>
            {otherSessions.length > 0 && (
              <form
                className="project-attach"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!attachSessionId) return;
                  assignProject(attachSessionId, selected.id);
                  setAttachSessionId("");
                  notify("会话已归入项目");
                }}
              >
                <select
                  aria-label="选择归入项目的会话"
                  value={attachSessionId}
                  onChange={(event) => setAttachSessionId(event.target.value)}
                >
                  <option value="">归入已有会话…</option>
                  {otherSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title}
                    </option>
                  ))}
                </select>
                <button type="submit" className="page-button" disabled={!attachSessionId}>
                  归入
                </button>
              </form>
            )}
            {projectSessions.length ? (
              <div className="project-session-list">
                {projectSessions.map((session) => (
                  <div className="project-session-row" key={session.id}>
                    <button className="page-row-main" onClick={() => void selectResearch(session.id)}>
                      <CompanyLogo company={session.company} size={28} />
                      <span className="page-row-copy">
                        <strong>{session.title}</strong>
                        <small>{formatDate(session.updatedAt)}</small>
                      </span>
                      <ArrowUpRight size={16} className="page-muted" />
                    </button>
                    <IconButton
                      label={`从项目移出 ${session.title}`}
                      onClick={() => {
                        assignProject(session.id, undefined);
                        notify("会话已移出项目，内容仍然保留");
                      }}
                    >
                      <ArrowLeft size={15} />
                    </IconButton>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<MessageSquare size={23} />}
                title="还没有研究会话"
                description="发起一项研究，或将已有会话归入此项目。"
              />
            )}
          </section>
          <section className="page-section" aria-labelledby="project-files-title">
            <div className="page-section-heading">
              <h2 id="project-files-title">研究文件</h2>
              <span>{projectFiles.length}</span>
            </div>
            {projectFiles.length ? (
              projectFiles.map((file) => (
                <button
                  className="project-file-row"
                  key={file.id}
                  onClick={() => openFile(file.id)}
                >
                  <FileText size={18} />
                  <span className="page-row-copy">
                    <strong>{file.name}</strong>
                    <small>{file.folder || "根目录"}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))
            ) : (
              <EmptyState
                icon={<FileText size={23} />}
                title="暂无关联文件"
                description="在文件页新建文件时，可以选择所属项目。"
              />
            )}
          </section>
        </div>
        {editor && (
          <ProjectEditor
            project={editor === "new" ? undefined : editor}
            existingNames={projects
              .filter((project) => project.id !== (editor === "new" ? "" : editor.id))
              .map((project) => project.name)}
            onClose={() => setEditor(null)}
            onSave={saveProject}
          />
        )}
        {deleting && (
          <ConfirmRemoval
            title="删除项目"
            onClose={() => setDeleting(null)}
            onConfirm={() => {
              removeProject(deleting.id);
              setDeleting(null);
              setSelectedId(null);
              notify("项目已删除，研究会话仍然保留");
            }}
          >
            <p>删除「{deleting.name}」？项目中的会话会解除归属，已有研究内容和文件将保留。</p>
          </ConfirmRemoval>
        )}
      </div>
    );
  }

  return (
    <div className="page-content">
      <PageHeading
        title="项目"
        description="按主题组织研究，保留每一步判断与资料。"
        actions={
          <button className="page-button page-button-primary" onClick={() => setEditor("new")}>
            <FolderPlus size={17} />
            新建项目
          </button>
        }
      />
      <div className="page-toolbar">
        <PageSearch value={query} onChange={setQuery} label="搜索项目" />
        <span className="page-count">{visible.length} 个项目</span>
      </div>
      {visible.length ? (
        <div className="project-grid">
          {visible.map((project) => {
            const count = demoSessions.filter((session) => session.projectId === project.id).length;
            const fileCount = files.filter((file) => file.projectId === project.id).length;
            return (
              <article className="project-card" key={project.id}>
                <div className="project-card-top">
                  <Folder size={23} className="page-accent" />
                  <div className="page-row-actions">
                    <IconButton label={`重命名 ${project.name}`} onClick={() => setEditor(project)}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton label={`删除 ${project.name}`} onClick={() => setDeleting(project)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </div>
                <button className="project-title" onClick={() => setSelectedId(project.id)}>
                  <h2>{project.name}</h2>
                  <ArrowUpRight size={17} />
                </button>
                <p>{project.description || "尚未添加项目说明"}</p>
                <div className="project-card-footer">
                  <span>
                    {count} 个会话 · {fileCount} 个文件
                  </span>
                  <button
                    onClick={() => newSession(project.id)}
                    aria-label={`在 ${project.name} 新建研究`}
                  >
                    <Plus size={15} />
                    研究
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Folder size={27} />}
          title={query ? "未找到匹配项目" : "创建第一个研究项目"}
          description={query ? "试试其他名称，或清空搜索。" : "把同一主题的会话和资料放在一起。"}
          action={
            <button
              className="page-button"
              onClick={() => (query ? setQuery("") : setEditor("new"))}
            >
              {query ? "清空搜索" : "新建项目"}
            </button>
          }
        />
      )}
      {editor && (
        <ProjectEditor
          project={editor === "new" ? undefined : editor}
          existingNames={projects
            .filter((project) => project.id !== (editor === "new" ? "" : editor.id))
            .map((project) => project.name)}
          onClose={() => setEditor(null)}
          onSave={saveProject}
        />
      )}
      {deleting && (
        <ConfirmRemoval
          title="删除项目"
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            removeProject(deleting.id);
            setDeleting(null);
            notify("项目已删除，研究会话仍然保留");
          }}
        >
          <p>删除「{deleting.name}」？会话将解除项目归属，已有研究内容和文件仍会保留。</p>
        </ConfirmRemoval>
      )}
    </div>
  );
}
