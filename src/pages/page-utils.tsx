import { Search, Unplug } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState, Modal } from "../components/ui";
import { useWorkspace } from "../state";

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  );
}

export function PageSearch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className="page-search">
      <Search size={17} aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function LivePageNotice({ title }: { title: string }) {
  const navigate = useWorkspace((state) => state.navigate);
  return (
    <div className="page-content">
      <PageHeading title={title} />
      <EmptyState
        icon={<Unplug size={26} />}
        title="此页面尚未连接后端"
        description="实时模式下暂不展示本地演示数据。你可以返回研究对话，或切换到演示模式体验此页面。"
        action={
          <button className="page-button" onClick={() => navigate("research")}>
            返回研究
          </button>
        }
      />
    </div>
  );
}

export function ConfirmRemoval({
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel = "确认删除",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="page-confirm-copy">{children}</div>
      <div className="page-form-actions">
        <button type="button" className="page-button" onClick={onClose}>
          取消
        </button>
        <button type="button" className="page-button page-button-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function FormError({ message }: { message: string }) {
  return message ? (
    <p className="page-form-error" role="alert">
      {message}
    </p>
  ) : null;
}

export const createId = () => crypto.randomUUID();

export function formatDate(timestamp: number) {
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export function folderPath(value: string) {
  return value
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

export function validFolder(value: string) {
  return value
    .split("/")
    .every(
      (part) =>
        part !== "." &&
        part !== ".." &&
        !/[<>:"|?*]/.test(part) &&
        Array.from(part).every((character) => character.charCodeAt(0) >= 32),
    );
}
