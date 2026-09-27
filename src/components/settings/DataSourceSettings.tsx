import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink, Loader2, PlugZap, ShieldCheck } from "lucide-react";
import { useConnection } from "../../state/research";
import { requestDataSources, type SourceAction, type SourceId, type SourceView } from "../../services/data-sources";
import { Field } from "../ui";

const label = (source: SourceView) => !source.configured ? "未配置" : !source.enabled ? "已停用" : !source.lastTest ? "已配置 · 待测试" : source.lastTest.ok ? "上次测试通过" : "上次测试失败";
export function DataSourceSettings({ active }: { active: boolean }) {
  const runtime = useConnection(state => state.runtime);
  const [sources, setSources] = useState<SourceView[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<SourceId, string>>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ id: SourceId; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!active || runtime?.kind !== "aurora") return;
    let current = true; setLoading(true); setError("");
    void requestDataSources().then(data => { if (current) setSources(data.sources); }).catch(e => { if (current) { setSources([]); setError(e instanceof Error ? e.message : "加载失败"); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, runtime?.kind, reload]);
  const busy = loading || pending !== null;
  async function act(source: SourceView, action: SourceAction) {
    setPending(`${source.id}:${action}`); setError(""); setNotice(null);
    try {
      const data = await requestDataSources({ id: source.id, action, ...(action === "save" ? { credential: drafts[source.id] || "" } : {}) });
      setSources(data.sources);
      if (action === "save" || action === "remove") setDrafts(previous => ({ ...previous, [source.id]: "" }));
      setNotice({ id: source.id, text: data.test?.message || (action === "save" ? "已保存，尚未发起网络请求。" : action === "remove" ? "凭据已移除。" : action === "enable" ? "已启用，下一轮研究生效。" : "已停用，凭据仍保留在本机。") });
    } catch (e) { setError(e instanceof Error ? e.message : "操作未完成，请重试。"); }
    finally { setPending(null); }
  }
  return <>
    <h2>数据源</h2>
    <p className="settings-description">按研究需要连接。凭据只保存在本机，费用和数据权限由你的供应商账户承担。</p>
    {runtime?.kind !== "aurora" ? <p className="settings-running-note">请先连接 AURORA 本机服务，再管理数据源。</p> : <>
      <div className="data-source-assurance"><ShieldCheck size={17} /><span>保存不发起请求 · 测试可能消耗 API 额度 · Key 保存后不回显</span></div>
      {loading && <p role="status"><Loader2 size={15} className="spin" /> 正在读取配置…</p>}
      {error && <div className="settings-error" role="alert">{error}<button type="button" className="page-button" disabled={busy} onClick={() => setReload(v => v + 1)}>重新读取</button></div>}
      <div className="data-source-list">
        {sources.map(source => <details className="data-source-card" key={source.id}>
          <summary><span className="data-source-heading"><strong>{source.name}</strong><span>{source.description}</span></span><span className={`data-source-status ${source.enabled && source.lastTest?.ok ? "verified" : ""}`}>{label(source)}</span><ChevronDown size={15} /></summary>
          <div className="data-source-content">
            <a className="data-source-link" href={source.url} target="_blank" rel="noreferrer">{source.id === "sec" ? "查看 SEC 访问要求" : "申请凭据与查看说明"}<ExternalLink size={13} /></a>
            <form onSubmit={event => { event.preventDefault(); void act(source, "save"); }}>
              <Field label={`${source.name} · ${source.credentialLabel}`}><input type={source.id === "sec" ? "text" : "password"} autoComplete="off" spellCheck={false} value={drafts[source.id] || ""} disabled={busy} required={!source.configured} placeholder={source.configured ? "已保存；留空保留，填写则替换" : source.id === "sec" ? "MyApp name@example.com" : "填写你自己的 API Key"} onChange={event => setDrafts(previous => ({ ...previous, [source.id]: event.target.value }))} /></Field>
              {source.id === "sec" && <p className="settings-description">SEC 公开财务接口不需要 API Key；请填写应用名称和真实联系邮箱，该标识会随请求发给 SEC。</p>}
              <div className="data-source-actions">
                <button type="submit" className="page-button page-button-primary" disabled={busy}>{pending === `${source.id}:save` && <Loader2 size={14} className="spin" />}保存配置</button>
                <button type="button" className="page-button" disabled={busy || !source.configured || !!drafts[source.id]?.trim()} onClick={() => void act(source, "test")}>{pending === `${source.id}:test` ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}测试已保存配置</button>
                {source.configured && <><button type="button" className="page-button" disabled={busy} onClick={() => void act(source, source.enabled ? "disable" : "enable")}>{source.enabled ? "停用" : "启用"}</button><button type="button" className="page-button" disabled={busy} onClick={() => void act(source, "remove")}>移除凭据</button></>}
              </div>
              {!!drafts[source.id]?.trim() && source.configured && <p className="settings-description">输入内容尚未保存；保存后再测试。</p>}
            </form>
            {source.lastTest && <p className="data-source-test-note">{new Date(source.lastTest.checkedAt).toLocaleString()} · {source.lastTest.message}</p>}
            {notice?.id === source.id && <p role="status" className="data-source-feedback">{notice.text}</p>}
          </div>
        </details>)}
      </div>
      <div className="data-source-footnote"><strong>联网搜索与公开接口</strong><p>官方 Kimi 联网搜索沿用「模型」中的用户账户，无需重复填写。加密行情等无需 Key 的公开接口保留直接使用；能否取得数据仍取决于网络、地区和接口限制。</p><p>连接测试仅验证一个样本接口。美股行情目前支持历史日／周／月数据，测试成功不代表实时行情或所有付费权限已开通。</p></div>
    </>}
  </>;
}
