import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { safeSourceUrl } from "./citations";
import { stripProvenanceFromToolResultText } from "./strip-tool-header";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function valueText(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return "数据无法展示"; }
}

export function SourceLink({ url, label }: { url: unknown; label?: string }) {
  const safe = safeSourceUrl(url);
  if (!safe) return null;
  return <a className="provenance-source-link" href={safe} target="_blank" rel="noopener noreferrer">
    {label || safe}<ExternalLink size={13} aria-hidden="true" />
  </a>;
}

export function ProvenanceTable({ headers, rows, fields = [], keyMap = {} }: {
  headers: string[];
  rows: unknown[][];
  fields?: string[];
  keyMap?: Record<string, unknown>;
}) {
  const [limit, setLimit] = useState(50);
  const highlighted = (header: string) => fields.includes(header) || (typeof keyMap[header] === "string" && fields.includes(keyMap[header] as string));
  return <>
    <div className="provenance-table-scroll" tabIndex={0} aria-label="来源数据表，可横向滚动">
      <table className="provenance-table"><thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`} scope="col" className={highlighted(header) ? "is-cited-field" : undefined}>{header}</th>)}</tr></thead>
        <tbody>{rows.slice(0, limit).map((row, index) => <tr key={index}>{headers.map((header, column) => <td key={`${header}-${column}`} className={highlighted(header) ? "is-cited-field" : undefined}>{valueText(row[column])}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {rows.length > limit && <button type="button" className="page-button" onClick={() => setLimit((value) => value + 50)}>显示更多（已展示 {limit} / {rows.length} 行）</button>}
  </>;
}

export function ProvenanceSummary({ summary, fallback, fields }: { summary: unknown; fallback?: string; fields: string[] }) {
  if (isRecord(summary)) {
    if (summary.kind === "table" && Array.isArray(summary.headers) && summary.headers.every((item) => typeof item === "string") && Array.isArray(summary.rows) && summary.rows.every(Array.isArray)) {
      return <>
        <ProvenanceTable headers={summary.headers as string[]} rows={summary.rows as unknown[][]} fields={fields} keyMap={isRecord(summary.keyMap) ? summary.keyMap : undefined} />
        {typeof summary.totalRows === "number" && summary.totalRows > summary.rows.length && <p className="provenance-caption">当前为摘要 {summary.rows.length} 行，来源共 {summary.totalRows} 行。</p>}
      </>;
    }
    if (summary.kind === "search" && Array.isArray(summary.results)) {
      return <div className="provenance-results">{summary.results.map((value, index) => {
        if (!isRecord(value)) return <pre key={index} className="provenance-raw">{valueText(value)}</pre>;
        const title = typeof value.title === "string" ? value.title : "";
        const content = typeof value.snippet === "string" ? value.snippet : typeof value.content === "string" ? value.content : "";
        if (!title && !content && !safeSourceUrl(value.url)) return <pre key={index} className="provenance-raw">{valueText(value)}</pre>;
        return <article className="provenance-result" key={index}>
          {title && <h3>{title}</h3>}
          {content && <p>{stripProvenanceFromToolResultText(content)}</p>}
          <SourceLink url={value.url} />
        </article>;
      })}{summary.results.length === 0 && <p className="provenance-caption">这次工具调用没有返回搜索条目。</p>}</div>;
    }
    if (summary.kind === "page") {
      return <div className="provenance-page">
        {typeof summary.title === "string" && <h3>{summary.title}</h3>}
        {typeof summary.excerpt === "string" && <p>{stripProvenanceFromToolResultText(summary.excerpt)}</p>}
        <SourceLink url={summary.url} />
        {!summary.excerpt && fallback && <pre className="provenance-raw">{stripProvenanceFromToolResultText(fallback)}</pre>}
      </div>;
    }
    if (summary.kind === "metric" && (typeof summary.value === "number" || typeof summary.value === "string")) {
      return <div className="provenance-metric">
        {typeof summary.name === "string" && <h3>{summary.name}</h3>}
        <p><strong>{String(summary.value)}</strong>{typeof summary.unit === "string" && <span>{summary.unit}</span>}</p>
        {typeof summary.period === "string" && <small>{summary.period}</small>}
      </div>;
    }
  }
  const raw = fallback ? stripProvenanceFromToolResultText(fallback) : summary === undefined || summary === null ? "" : valueText(summary);
  return raw ? <pre className="provenance-raw">{raw}</pre> : <p className="provenance-caption">接口仅返回了来源元信息，没有返回摘要内容。</p>;
}

export function FullProvenanceRecords({ records, fields }: { records: unknown[]; fields: string[] }) {
  if (!records.length) return <p className="provenance-caption">来源文件没有数据记录。</p>;
  if (records.every(isRecord)) {
    const headers = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
    return <ProvenanceTable headers={headers} rows={records.map((record) => headers.map((key) => record[key]))} fields={fields} />;
  }
  return <ProvenanceTable headers={["记录"]} rows={records.map((record) => [record])} fields={fields} />;
}
