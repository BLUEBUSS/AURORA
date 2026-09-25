import { useWorkspace } from "../../state";
import { failDemo } from "../../state/demo-runner";

export function DemoSettings({ onClose }: { onClose: () => void }) {
  const currentSessionId = useWorkspace((state) => state.currentSessionId);
  const session = useWorkspace((state) => state.sessions.find((item) => item.id === state.currentSessionId));
  const running = session?.origin === "demo" && session.messages.some((message) => message.phase === "running");

  return <>
    <h3 className="settings-title">演示检查</h3>
    <p className="settings-description">仅影响当前本地演示，用于检查中断后的内容保留与重试。</p>
    <div className="settings-row settings-demo-row">
      <div className="settings-row-copy"><strong>模拟研究失败</strong><p>保留已生成内容和下一条草稿。</p></div>
      <button type="button" className="page-button" disabled={!currentSessionId || !running} onClick={() => {
        if (!currentSessionId || !running) return;
        failDemo(currentSessionId);
        onClose();
      }}>模拟当前研究失败</button>
    </div>
    {!running && <p className="settings-description settings-demo-hint">当前没有正在执行的演示研究。</p>}
  </>;
}
