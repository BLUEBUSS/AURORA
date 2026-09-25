import { useEffect, useState } from "react";
import { FileSearch, Loader2, RotateCcw } from "lucide-react";
import { resolveProvenance, fetchProvenanceData, type ProvenanceEntry, type ProvenanceData } from "../../services/provenance";
import { Modal } from "../ui";
import type { CitationReference } from "./citations";
import { FullProvenanceRecords, ProvenanceSummary } from "./ProvenanceSummary";
import { stripProvenanceFromToolResultText } from "./strip-tool-header";
import "./provenance.css";

const errorText = (error: unknown) => error instanceof Error ? error.message : "来源详情暂时无法加载。";

export function ProvenanceReference({ reference, sessionKey }: { reference: CitationReference; sessionKey: string }) {
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<ProvenanceEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [responseKey, setResponseKey] = useState("");
  const requestKey = `${sessionKey}:${reference.provenanceId}`;

  useEffect(() => {
    if (!open || !sessionKey) return;
    let cancelled = false;
    setLoading(true); setError(""); setEntry(null); setResponseKey(requestKey);
    void resolveProvenance(sessionKey, reference.provenanceId)
      .then((result) => { if (!cancelled) setEntry(result); })
      .catch((reason: unknown) => { if (!cancelled) setError(errorText(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, sessionKey, reference.provenanceId, requestKey, attempt]);

  return <>
    <sup className="provenance-reference"><button type="button" aria-label={`查看来源 ${reference.index}`} aria-haspopup="dialog" disabled={!sessionKey}
      title={sessionKey ? `查看来源 ${reference.index}` : "此内容没有关联研究会话"}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); setLoading(true); setError(""); setEntry(null); setOpen(true); }}>[{reference.index}]</button></sup>
    {open && <Modal title="来源详情" className="provenance-dialog" onClose={() => setOpen(false)}>
      {(loading || responseKey !== requestKey) && <p className="provenance-loading" role="status"><Loader2 size={16} className="spin" aria-hidden="true" />正在读取来源…</p>}
      {responseKey === requestKey && error && <div className="provenance-error"><p role="alert">{error}</p><button type="button" className="page-button" onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={14} />重试</button></div>}
      {responseKey === requestKey && !loading && !error && entry && <ProvenanceDetails key={requestKey} entry={entry} reference={reference} sessionKey={sessionKey} />}
    </Modal>}
  </>;
}

function ProvenanceDetails({ entry, reference, sessionKey }: { entry: ProvenanceEntry; reference: CitationReference; sessionKey: string }) {
  const [fullData, setFullData] = useState<ProvenanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadRequested, setLoadRequested] = useState(0);
  useEffect(() => {
    if (!loadRequested) return;
    let cancelled = false;
    setLoading(true); setError("");
    void fetchProvenanceData(sessionKey, entry.provenanceId)
      .then((data) => { if (!cancelled) setFullData(data); })
      .catch((reason: unknown) => { if (!cancelled) setError(errorText(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadRequested, sessionKey, entry.provenanceId]);

  const metadata = [
    ["来源", entry.dataSource], ["研究对象", entry.subject], ["资料类型", entry.dataType], ["数据期间", entry.timeRange],
    ["工具", entry.toolName], ["记录时间", entry.timestamp !== undefined ? new Date(entry.timestamp).toLocaleString("zh-CN") : undefined],
  ].filter((item): item is [string, string] => typeof item[1] === "string" && item[1].length > 0);

  return <div className="provenance-detail">
    <div className="provenance-entry-heading"><FileSearch size={19} aria-hidden="true" /><strong>{entry.label || entry.subject || entry.toolName}</strong><span>{entry.provenanceId}</span></div>
    <dl className="provenance-metadata">{metadata.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {!!reference.fields.length && <p className="provenance-fields">引用字段：{reference.fields.join("、")}</p>}
    <section className="provenance-summary" aria-label="来源摘要"><ProvenanceSummary summary={entry.summary} fallback={entry.toolResult} fields={reference.fields} /></section>
    {entry.toolResult && entry.summary !== undefined && <details className="provenance-original"><summary>查看工具返回文本</summary><pre className="provenance-raw">{stripProvenanceFromToolResultText(entry.toolResult)}</pre></details>}
    {entry.persistedFilePath && !fullData && <button type="button" className="page-button" disabled={loading} onClick={() => setLoadRequested((value) => value + 1)}>
      {loading && <Loader2 size={14} className="spin" aria-hidden="true" />}{loading ? "正在读取完整数据…" : error ? "重试加载完整数据" : "展开完整数据"}
    </button>}
    {error && <p className="provenance-fetch-error" role="alert">{error}</p>}
    {fullData && <section className="provenance-full-data" aria-label="完整来源数据"><h3>来源数据 <span>{fullData.records ? `${fullData.totalRows} 条` : "原始文本"}</span></h3>
      {fullData.records ? <FullProvenanceRecords records={fullData.records} fields={reference.fields} /> : <pre className="provenance-raw">{fullData.raw}</pre>}
    </section>}
  </div>;
}
