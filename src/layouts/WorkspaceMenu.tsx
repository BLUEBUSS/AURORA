import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Bell, BookOpen, ChevronUp, FileText, Folder, LogOut, Settings2, Star } from "lucide-react";
import { useWorkspace } from "../state";
import { useConnection, logoutResearch } from "../state/research";
import type { SettingsTab } from "../components/ConnectionDialog";
export function WorkspaceMenu({ openSettings }: { openSettings: (tab?: SettingsTab) => void }) {
  const s = useWorkspace();
  const user = useConnection((c) => c.user);
  const busy = useConnection((c) => c.busy);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, bottom: 76 });
  const id = useId();
  const running = s.sessions.some((t) => t.messages.some((m) => m.phase === "running"));
  const name = s.mode === "demo" ? "本地工作区" : user?.username || "研究账户";
  const close = () => menu.current?.hidePopover();
  useEffect(() => {
    const el = menu.current;
    if (!el) return;
    el.setAttribute("popover", "auto");
    function toggle() {
      const visible = !!el?.matches(":popover-open");
      setOpen(visible);
    }
    el.addEventListener("toggle", toggle);
    return () => el.removeEventListener("toggle", toggle);
  }, []);
  useEffect(() => {
    const dismiss = () => menu.current?.hidePopover();
    window.addEventListener("resize", dismiss);
    return () => window.removeEventListener("resize", dismiss);
  }, []);
  function show() {
    if (menu.current?.matches(":popover-open")) {
      close();
      return;
    }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(8, Math.min(rect.left, innerWidth - 284)),
      bottom: Math.max(8, innerHeight - rect.top + 9),
    });
    menu.current?.showPopover();
    requestAnimationFrame(() =>
      menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(),
    );
  }
  function keyboard(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || [],
    );
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      trigger.current?.focus();
    }
    if (e.key === "Tab") {
      close();
    }
  }
  return (
    <>
      <button
        ref={trigger}
        className="profile-button"
        aria-label="打开工作区菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={show}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            show();
          }
        }}
      >
        <span className="profile-avatar">A</span>
        <span>
          {name}
          <small>{s.mode === "demo" ? "交互演示" : "现有账户"}</small>
        </span>
        <ChevronUp size={16} />
      </button>
      <div
        ref={menu}
        id={id}
        role="menu"
        aria-label="工作区菜单"
        className="workspace-menu"
        style={{ left: position.left, bottom: position.bottom }}
        onKeyDown={keyboard}
      >
        <div className="workspace-menu-account">
          <span className="profile-avatar">A</span>
          <div>
            <strong>{name}</strong>
            <small>{s.mode === "demo" ? "本地交互演示" : "已连接研究账户"}</small>
          </div>
        </div>
        <div className="workspace-menu-group" role="group" aria-label="研究工具">
          {(
            [
              { page: "projects", label: "项目", Icon: Folder },
              { page: "files", label: "文件", Icon: FileText },
              { page: "reports", label: "报告", Icon: BookOpen },
              { page: "watchlist", label: "自选", Icon: Star },
              { page: "reminders", label: "提醒", Icon: Bell },
            ] as const
          ).map(({ page, label, Icon }) => (
            <button
              role="menuitem"
              key={page}
              className="workspace-entry"
              onClick={() => {
                close();
                s.navigate(page);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="workspace-menu-group">
          <button
            role="menuitem"
            onClick={() => {
              close();
              trigger.current?.focus();
              openSettings("general");
            }}
          >
            <Settings2 size={18} />
            <span>设置</span>
          </button>
          {s.mode === "live" && (
            <button
              role="menuitem"
              disabled={busy || running}
              onClick={() => {
                close();
                void logoutResearch();
              }}
            >
              <LogOut size={18} />
              <span>退出账号</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
