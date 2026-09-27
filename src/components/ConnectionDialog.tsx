import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Cable, FlaskConical, SlidersHorizontal, Cpu, Database } from "lucide-react";
import { useMedia } from "../hooks";
import { useWorkspace } from "../state";
import { Modal } from "./ui";
import { ConnectionSettings, DemoSettings, GeneralSettings, ModelSettings, DataSourceSettings } from "./settings";
import "../styles/settings.css";

export type SettingsTab = "general" | "connection" | "models" | "data" | "demo";

const categories = [
  { id: "general", label: "常规", Icon: SlidersHorizontal },
  { id: "connection", label: "账户与连接", Icon: Cable },
  { id: "models", label: "模型", Icon: Cpu },
  { id: "data", label: "数据源", Icon: Database },
  { id: "demo", label: "演示检查", Icon: FlaskConical },
] as const;

export function ConnectionDialog({
  onClose,
  resetLayout,
  initialTab = "general",
}: {
  onClose: () => void;
  resetLayout: () => void;
  initialTab?: SettingsTab;
}) {
  const mode = useWorkspace((state) => state.mode);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const id = useId();
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const compact = useMedia("(max-width: 600px)");
  const available = categories.filter((category) => category.id !== "demo" || mode === "demo");
  const activeTab = mode !== "demo" && tab === "demo" ? "general" : tab;

  useEffect(() => setTab(initialTab), [initialTab]);

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, current: SettingsTab) {
    const previous = compact ? "ArrowLeft" : "ArrowUp";
    const next = compact ? "ArrowRight" : "ArrowDown";
    if (![previous, next, "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = available.findIndex((category) => category.id === current);
    const target = event.key === "Home"
      ? available[0]
      : event.key === "End"
        ? available[available.length - 1]
        : available[(index + (event.key === next ? 1 : -1) + available.length) % available.length];
    setTab(target.id);
    tabRefs.current[target.id]?.focus();
  }

  return (
    <Modal title="工作台设置" className="settings-dialog" onClose={onClose}>
      <div className="settings-body">
        <div className="settings-nav" role="tablist" aria-label="设置分类" aria-orientation={compact ? "horizontal" : "vertical"}>
          {available.map(({ id: category, label, Icon }) => (
            <button
              key={category}
              ref={(node) => { tabRefs.current[category] = node; }}
              id={`${id}-tab-${category}`}
              type="button"
              role="tab"
              className="settings-tab"
              aria-selected={activeTab === category}
              aria-controls={`${id}-panel-${category}`}
              tabIndex={activeTab === category ? 0 : -1}
              onClick={() => setTab(category)}
              onKeyDown={(event) => handleTabKey(event, category)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="settings-content">
          <section id={`${id}-panel-general`} role="tabpanel" aria-labelledby={`${id}-tab-general`} hidden={activeTab !== "general"} tabIndex={0}>
            <GeneralSettings resetLayout={resetLayout} />
          </section>
          <section id={`${id}-panel-connection`} role="tabpanel" aria-labelledby={`${id}-tab-connection`} hidden={activeTab !== "connection"} tabIndex={0}>
            <ConnectionSettings onClose={onClose} />
          </section>
          <section id={`${id}-panel-models`} role="tabpanel" aria-labelledby={`${id}-tab-models`} hidden={activeTab !== "models"} tabIndex={0}>
            <ModelSettings openDataSources={() => setTab("data")} />
          </section>
          <section id={`${id}-panel-data`} role="tabpanel" aria-labelledby={`${id}-tab-data`} hidden={activeTab !== "data"} tabIndex={0}>
            <DataSourceSettings active={activeTab === "data"} />
          </section>
          {mode === "demo" && <section id={`${id}-panel-demo`} role="tabpanel" aria-labelledby={`${id}-tab-demo`} hidden={activeTab !== "demo"} tabIndex={0}>
            <DemoSettings onClose={onClose} />
          </section>}
        </div>
      </div>
    </Modal>
  );
}
