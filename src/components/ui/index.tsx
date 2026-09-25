import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { FileSearch, X } from "lucide-react";
import type { Company } from "../../types";
export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function CompanyLogo({ company, size = 28 }: { company?: Company; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [company?.logo]);
  return (
    <span
      className="company-logo"
      data-ticker={company?.ticker.toUpperCase()}
      style={{ width: size, height: size, color: company?.color }}
      aria-hidden="true"
    >
      {company?.logo && !failed ? (
        <img src={company.logo} alt="" onError={() => setFailed(true)} />
      ) : company ? (
        <span>{company.ticker.slice(0, 2)}</span>
      ) : (
        <FileSearch size={size * 0.6} />
      )}
    </span>
  );
}
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const d = ref.current;
    const before = document.activeElement as HTMLElement | null;
    d?.showModal();
    return () => {
      d?.close();
      before?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={id}
      className={`modal ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <IconButton label="关闭对话框" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function downloadText(name: string, content: string, mime = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
export { SelectionMenu, type SelectionOption } from "./SelectionMenu";
