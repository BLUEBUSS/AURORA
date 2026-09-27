import { useEffect, useState } from "react";
import { Menu, Moon, PanelRight, Sun, X } from "lucide-react";
import { useWorkspace } from "./state";
import { useConnection, initializeResearch } from "./state/research";
import { useMedia, usePanelLayout, useTheme } from "./hooks";
import { changeTheme } from "./lib";
import { Sidebar, pageNames } from "./layouts";
import { ResearchView, EvidencePanel } from "./components/chat";
import { CompanyLogo, IconButton } from "./components/ui";
import { FileReader } from "./components/FileReader";
import { ConnectionDialog, type SettingsTab } from "./components/ConnectionDialog";
import { MobileDrawer } from "./components/MobileDrawer";
import { FilesPage, ProjectsPage, RemindersPage, ReportsPage, WatchlistPage } from "./pages";
export default function App() {
  const s = useWorkspace();
  const status = useConnection((c) => c.status);
  const setupRequired = useConnection((c) => c.runtime?.setupRequired);
  const resolved = useTheme();
  const compact = useMedia("(max-width: 1100px)");
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  const session = s.sessions.find((t) => t.id === s.currentSessionId);
  const showRight = s.page === "research" && !!session?.messages.length && s.rightOpen;
  const layout = usePanelLayout(s.leftOpen, showRight);
  useEffect(() => initializeResearch(), []);
  useEffect(() => { if (setupRequired && status === "connected") setSettings("models"); }, [setupRequired, status]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        !["INPUT", "TEXTAREA", "SELECT"].includes(tag) &&
        !document.querySelector("dialog[open]") &&
        !document.querySelector(":popover-open") &&
        e.key.toLowerCase() === "n" &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        useWorkspace.getState().newSession();
      }
      if (e.key === "Escape") useWorkspace.setState({ mobilePanel: null });
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    document.title = `${s.page === "research" && session?.title ? session.title : pageNames[s.page]} · AURORA`;
  }, [session?.title, s.page]);
  useEffect(() => {
    if (!s.notice) return;
    const id = s.notice.id;
    const timer = setTimeout(() => {
      if (useWorkspace.getState().notice?.id === id) useWorkspace.setState({ notice: null });
    }, 5000);
    return () => clearTimeout(timer);
  }, [s.notice]);
  const pages = {
    research: <ResearchView />,
    projects: <ProjectsPage />,
    files: <FilesPage />,
    reports: <ReportsPage />,
    watchlist: <WatchlistPage />,
    reminders: <RemindersPage />,
  };
  return (
    <div
      className={`app-shell ${layout.dragging ? "dragging" : ""}`}
      ref={layout.ref}
      style={layout.style}
    >
      {!compact && s.leftOpen && <Sidebar openSettings={(tab = "general") => setSettings(tab)} />}
      {!compact && s.leftOpen && <div className="panel-grip grip-left" {...layout.grip("left")} />}
      <main className="main-panel">
        <header className="main-header">
          <div className="main-heading">
            {(compact || !s.leftOpen) && (
              <IconButton
                label="展开导航"
                onClick={() =>
                  compact
                    ? useWorkspace.setState({ mobilePanel: "left" })
                    : useWorkspace.setState({ leftOpen: true })
                }
              >
                <Menu size={19} />
              </IconButton>
            )}
            {s.page === "research" && session?.company ? (
              <>
                <CompanyLogo company={session.company} size={28} />
                <strong>{session.company.name}</strong>
                <span className="ticker">{session.company.ticker}</span>
                <span className="header-caption">公司研究</span>
              </>
            ) : (
              <strong
                className={
                  !session?.messages.length && s.page === "research" ? "welcome-context" : ""
                }
              >
                {s.page === "research"
                  ? session?.messages.length
                    ? "研究会话"
                    : "新建研究"
                  : pageNames[s.page]}
              </strong>
            )}
          </div>
          <div className="header-actions">
            <button
              className={`connection-pill ${s.mode === "live" && status === "connected" ? "connected" : ""}`}
              onClick={() => setSettings("connection")}
            >
              <i />
              {s.mode === "demo" ? "本地演示" : status === "connected" ? "已连接" : "连接中断"}
            </button>
            <IconButton
              className="theme-toggle"
              label={resolved === "dark" ? "切换日间主题" : "切换夜间主题"}
              onClick={(event) =>
                changeTheme(resolved === "dark" ? "light" : "dark", event.currentTarget)
              }
            >
              <span className="theme-orbit" key={resolved}>
                {resolved === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              </span>
            </IconButton>
            {s.page === "research" && !!session?.messages.length && (
              <IconButton
                label={showRight && !compact ? "收起研究资料" : "展开研究资料"}
                onClick={() =>
                  compact
                    ? useWorkspace.setState({ mobilePanel: "right" })
                    : useWorkspace.setState({ rightOpen: !s.rightOpen })
                }
              >
                <PanelRight size={18} />
              </IconButton>
            )}
          </div>
        </header>
        {s.selectedFileId && s.files.some((f) => f.id === s.selectedFileId) ? (
          <FileReader key={s.selectedFileId} />
        ) : (
          pages[s.page]
        )}
      </main>
      {!compact && showRight && (
        <>
          <div className="panel-grip grip-right" {...layout.grip("right")} />
          <EvidencePanel />
        </>
      )}
      {compact && s.mobilePanel && (
        <MobileDrawer
          side={s.mobilePanel}
          onClose={() => useWorkspace.setState({ mobilePanel: null })}
        >
          {s.mobilePanel === "left" ? (
            <Sidebar
              openSettings={(tab = "general") => {
                useWorkspace.setState({ mobilePanel: null });
                setSettings(tab);
              }}
            />
          ) : (
            <EvidencePanel />
          )}
        </MobileDrawer>
      )}
      {settings && (
        <ConnectionDialog
          initialTab={settings}
          onClose={() => setSettings(null)}
          resetLayout={layout.reset}
        />
      )}
      {s.notice && (
        <div className={`toast ${s.notice.tone}`} role="status">
          <span>{s.notice.text}</span>
          <IconButton label="关闭通知" onClick={() => useWorkspace.setState({ notice: null })}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
