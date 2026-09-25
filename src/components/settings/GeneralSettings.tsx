import { useId } from "react";
import { useWorkspace } from "../../state";
import type { Theme } from "../../types";
import { changeTheme } from "../../lib";

export function GeneralSettings({ resetLayout }: { resetLayout: () => void }) {
  const theme = useWorkspace((state) => state.theme);
  const notify = useWorkspace((state) => state.notify);
  const id = useId();

  return (
    <>
      <h3 className="settings-title">常规</h3>
      <div className="settings-row">
        <div className="settings-row-copy">
          <label htmlFor={`${id}-theme`}>外观</label>
          <p id={`${id}-theme-help`}>选择工作台的显示主题。</p>
        </div>
        <select
          id={`${id}-theme`}
          className="settings-theme-select"
          aria-describedby={`${id}-theme-help`}
          value={theme}
          onChange={(event) => changeTheme(event.target.value as Theme, event.currentTarget)}
        >
          <option value="system">跟随系统</option>
          <option value="light">明晰</option>
          <option value="dark">曜黑</option>
        </select>
      </div>
      <div className="settings-row">
        <div className="settings-row-copy">
          <strong>布局</strong>
          <p>恢复左右侧栏的默认宽度。</p>
        </div>
        <button
          type="button"
          className="page-button"
          onClick={() => {
            resetLayout();
            notify("栏宽已恢复默认。");
          }}
        >
          恢复默认栏宽
        </button>
      </div>
    </>
  );
}
