import { useState } from "react";
import {
  ChevronDown,
  Folder,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pin,
  Plus,
  Search,
} from "lucide-react";
import { useWorkspace } from "../state";
import { selectResearch, updateResearchSession } from "../state/research";
import { CompanyLogo, Field, IconButton, Modal } from "../components/ui";
import { Wordmark } from "../components/brand";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { ProjectEditor } from "../components/projects";
import type { SettingsTab } from "../components/ConnectionDialog";
import type { Page, Session } from "../types";
export const pageNames: Record<Page, string> = {
  research: "研究",
  projects: "项目",
  files: "文件",
  reports: "报告",
  watchlist: "自选",
  reminders: "提醒",
};
export function Sidebar({ openSettings }: { openSettings: (tab?: SettingsTab) => void }) {
  const s = useWorkspace();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menu, setMenu] = useState<Session | null>(null);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [archived, setArchived] = useState(false);
  const [closedProjects, setClosedProjects] = useState<string[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);
  const sessions = s.sessions
    .filter(
      (t) =>
        (t.origin === "live" ||
          t.messages.length > 0 ||
          s.drafts[t.id]?.text.trim() ||
          s.drafts[t.id]?.attachments.length) &&
        !!t.archived === archived &&
        t.title.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
  const row = (t: Session, showLogo = true) => (
    <div
      className={`thread-row ${showLogo ? "" : "text-thread"} ${s.currentSessionId === t.id && s.page === "research" ? "active" : ""}`}
      key={t.id}
    >
      <button className="thread-main" onClick={() => void selectResearch(t.id)}>
        {showLogo && <CompanyLogo company={t.company} size={32} />}
        <span>
          {t.title}
          {showLogo && t.company && (
            <small>
              {t.company.ticker} · {t.origin === "demo" ? "研究示例" : "研究会话"}
            </small>
          )}
        </span>
        {t.pinned && <Pin size={11} className="pin-mark" />}
        {t.messages.some((m) => m.phase === "running") && <i className="running-dot" />}
      </button>
      <IconButton
        className="thread-more"
        label={`管理 ${t.title}`}
        onClick={() => {
          setMenu(t);
          setTitle(t.title);
          setProject(t.projectId || "");
        }}
      >
        <MoreHorizontal size={15} />
      </IconButton>
    </div>
  );
  return (
    <aside className="sidebar" aria-label="主导航">
      <header className="sidebar-top">
        <button className="brand" onClick={() => s.newSession()}>
          <Wordmark />
        </button>
        <IconButton
          label="收起导航"
          onClick={() => useWorkspace.setState({ leftOpen: false, mobilePanel: null })}
        >
          <PanelLeftClose size={17} />
        </IconButton>
      </header>
      <div className="sidebar-scroll">
        <button className="new-research" onClick={() => s.newSession()}>
          <Plus size={18} />
          <span>新建研究</span>
          <span className="key-hint">N</span>
        </button>
        {searchOpen && (
          <label className="session-search">
            <Search size={14} />
            <input
              autoFocus
              type="search"
              aria-label="搜索会话"
              placeholder="搜索会话"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        )}
        <section className="sidebar-projects-group" aria-label="项目列表">
          <div className="sidebar-group-heading">
            <h2>
              <button
                className="group-collapse"
                aria-label={projectsOpen ? "收起项目列表" : "展开项目列表"}
                aria-expanded={projectsOpen}
                onClick={() => setProjectsOpen((v) => !v)}
              >
                项目
                <ChevronDown
                  size={13}
                  style={{ transform: projectsOpen ? undefined : "rotate(-90deg)" }}
                />
              </button>
            </h2>
            <div>
              <IconButton label="新建项目" onClick={() => setCreatingProject(true)}>
                <Plus size={15} />
              </IconButton>
              <IconButton label="管理项目" data-navigation onClick={() => s.navigate("projects")}>
                <MoreHorizontal size={16} />
              </IconButton>
            </div>
          </div>
          {projectsOpen &&
            s.projects.map((p) => {
              const list = sessions.filter((t) => t.projectId === p.id);
              if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !list.length)
                return null;
              const closed = closedProjects.includes(p.id);
              return (
                <section key={p.id} className="sidebar-project">
                  <button
                    className="project-label"
                    title={p.name}
                    aria-label={p.name}
                    aria-expanded={!closed}
                    onClick={() =>
                      setClosedProjects((a) =>
                        closed ? a.filter((id) => id !== p.id) : [...a, p.id],
                      )
                    }
                  >
                    <Folder size={19} />
                    <span>{p.name}</span>
                    <small>{list.length}</small>
                    <ChevronDown
                      size={13}
                      style={{ transform: closed ? "rotate(-90deg)" : undefined }}
                    />
                  </button>
                  {!closed && (
                    <div className="project-children">
                      {list.length ? (
                        list.map((t) => row(t))
                      ) : (
                        <button
                          data-navigation
                          className="project-empty-new"
                          onClick={() => s.newSession(p.id)}
                        >
                          <Plus size={13} />
                          开始项目研究
                        </button>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          {projectsOpen && !s.projects.length && <p className="sidebar-empty">暂无项目</p>}
        </section>
        <section className="sidebar-chats-group" aria-label="独立聊天">
          <div className="sidebar-group-heading">
            <h2>{archived ? "归档聊天" : "聊天"}</h2>
            <div>
              <IconButton label="搜索会话" onClick={() => setSearchOpen((v) => !v)}>
                <Search size={15} />
              </IconButton>
              <IconButton
                label={archived ? "查看近期研究" : "查看归档研究"}
                onClick={() => setArchived((v) => !v)}
              >
                <MessageSquare size={15} />
              </IconButton>
            </div>
          </div>
          {sessions
            .filter((t) => !t.projectId || !s.projects.some((p) => p.id === t.projectId))
            .map((t) => row(t, !!t.company))}
          {!sessions.some((t) => !t.projectId || !s.projects.some((p) => p.id === t.projectId)) && (
            <p className="sidebar-empty">
              {search ? "没有找到相关聊天" : archived ? "暂无归档聊天" : "暂无独立聊天"}
            </p>
          )}
        </section>
      </div>
      <footer className="sidebar-footer">
        <WorkspaceMenu openSettings={openSettings} />
      </footer>
      {creatingProject && (
        <ProjectEditor
          existingNames={s.projects.map((p) => p.name)}
          onClose={() => setCreatingProject(false)}
          onSave={(name, description) => {
            s.addProject(name, description);
            setProjectsOpen(true);
            setCreatingProject(false);
          }}
        />
      )}
      {menu && (
        <Modal title="管理研究会话" onClose={() => setMenu(null)}>
          <form
            className="page-form"
            onSubmit={(e) => {
              e.preventDefault();
              void updateResearchSession(menu.id, { title });
              s.assignProject(menu.id, project || undefined);
              setMenu(null);
            }}
          >
            <Field label="名称">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                required
              />
            </Field>
            <Field label="归入项目">
              <select value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">未归入项目</option>
                {s.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="session-menu-actions">
              <button
                type="button"
                className="page-button"
                onClick={() => {
                  s.togglePinned(menu.id);
                  setMenu(null);
                }}
              >
                {menu.pinned ? "取消置顶" : "置顶会话"}
              </button>
              <button
                type="button"
                className="page-button"
                onClick={() => {
                  void updateResearchSession(menu.id, { archived: !menu.archived });
                  setMenu(null);
                }}
              >
                {menu.archived ? "恢复会话" : "归档会话"}
              </button>
              <button className="page-button page-button-primary">保存</button>
            </div>
          </form>
        </Modal>
      )}
    </aside>
  );
}
