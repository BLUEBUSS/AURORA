import { useId, useState, type FormEvent } from "react";
import { Cable, Loader2 } from "lucide-react";
import { connectResearch, logoutResearch, switchToDemo, useConnection } from "../../state/research";
import { useWorkspace } from "../../state";
import { Field } from "../ui";

const statusLabels = {
  idle: "尚未连接",
  connecting: "连接中",
  connected: "已连接",
  disconnected: "已断开",
  error: "连接失败",
};

export function ConnectionSettings({ onClose }: { onClose: () => void }) {
  const connection = useConnection();
  const mode = useWorkspace((state) => state.mode);
  const projects = useWorkspace((state) => state.projects);
  const liveScope = useWorkspace((state) => state.liveScope);
  const legacyProjectCount = mode === "live" && liveScope && projects
    ? useWorkspace.getState().getLegacyProjectImportCount() : 0;
  const running = useWorkspace((state) => state.sessions.some((session) => session.messages.some((message) => message.phase === "running")));
  const [loginOpen, setLoginOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const id = useId();
  const busy = connection.busy || logoutBusy;
  const disabled = busy || running;
  const error = formError || connection.error;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    if (!username.trim() || !password) {
      setFormError("请输入账号和密码。");
      return;
    }
    setFormError("");
    if (await connectResearch({ username: username.trim(), password })) {
      setPassword("");
      onClose();
    }
  }

  async function connect() {
    if (disabled) return;
    setFormError("");
    if (await connectResearch()) onClose();
  }

  async function logout() {
    if (disabled) return;
    setFormError("");
    setLogoutBusy(true);
    try {
      await logoutResearch();
      // The service records failures in connection state instead of rejecting.
      if (!useConnection.getState().error) onClose();
    } finally {
      setLogoutBusy(false);
    }
  }

  return <>
    <h3 className="settings-title">账户与连接</h3>
    <p className="settings-description">
      {mode === "demo" ? "本地演示不会调用真实 AI 或定时服务。" : "使用原有账户与后端研究会话。"}
    </p>
    <div className="settings-account-row">
      <div className="settings-account-copy">
        <strong>{mode === "live" ? connection.user?.username || connection.user?.id || "现有研究账户" : "本地演示"}</strong>
        <span>{mode === "live" ? "研究账户" : "可连接现有研究账户"}</span>
      </div>
      <span className={`settings-connection-status ${connection.status === "connected" ? "is-connected" : ""}`} role="status">
        {busy && <Loader2 size={13} className="spin" aria-hidden="true" />}
        {logoutBusy ? "正在退出" : statusLabels[connection.status]}
      </span>
    </div>
    {error && <p className="settings-error" role="alert">{error}</p>}
    {running && <p className="settings-running-note" role="status">请先停止正在执行的研究，再切换连接。</p>}
    {legacyProjectCount > 0 && <div className="settings-account-actions">
      <p className="settings-description">有 {legacyProjectCount} 个未关联会话的旧版本机项目。确认属于当前账户后可导入。</p>
      <button type="button" className="page-button" disabled={disabled} onClick={() => {
        if (useWorkspace.getState().importLegacyProjects())
          useWorkspace.getState().notify("旧版本机项目已导入当前账户。");
      }}>导入旧版本机项目</button>
    </div>}
    <div className="settings-connection-actions">
      <button type="button" className="page-button page-button-primary" disabled={disabled} onClick={() => void connect()}>
        {connection.busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Cable size={15} aria-hidden="true" />}
        连接现有后端
      </button>
      <button type="button" className="page-button" disabled={disabled} aria-expanded={loginOpen} aria-controls={`${id}-login`}
        onClick={() => { setLoginOpen((open) => !open); setFormError(""); }}>
        {loginOpen ? "收起登录" : "账号登录"}
      </button>
    </div>
    {loginOpen && <form id={`${id}-login`} className="settings-login-form" onSubmit={submit}>
      <div className="settings-login-fields">
        <Field label="原有账号"><input name="username" autoComplete="username" required disabled={disabled} value={username} onChange={(event) => { setUsername(event.target.value); setFormError(""); }} /></Field>
        <Field label="密码"><input name="password" type="password" autoComplete="current-password" required disabled={disabled} value={password} onChange={(event) => { setPassword(event.target.value); setFormError(""); }} /></Field>
      </div>
      <button type="submit" className="page-button page-button-primary" disabled={disabled}>
        {connection.busy && <Loader2 size={14} className="spin" aria-hidden="true" />}登录并连接
      </button>
    </form>}
    {mode === "live" && <div className="settings-account-actions">
      <button type="button" className="page-button" disabled={disabled} onClick={() => { if (!disabled) { switchToDemo(); onClose(); } }}>返回本地演示</button>
      <button type="button" className="page-button settings-logout" disabled={disabled} onClick={() => void logout()}>退出账号</button>
    </div>}
  </>;
}
