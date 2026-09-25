import { useState, type FormEvent } from "react";
import { ArrowUpRight, Bell, Plus, Star, Trash2, Pencil, Pause, Play } from "lucide-react";
import { useWorkspace } from "../state";
import { CompanyLogo, EmptyState, Field, IconButton, Modal } from "../components/ui";
import { PageHeading, LivePageNotice, PageSearch, FormError, ConfirmRemoval } from "./page-utils";
import { companies } from "../data/demo";
import type { Reminder, WatchItem } from "../types";
export function WatchlistPage() {
  const s = useWorkspace();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("全部");
  const [adding, setAdding] = useState(false);
  const [remove, setRemove] = useState<WatchItem | null>(null);
  if (s.mode === "live") return <LivePageNotice title="自选" />;
  const groups = ["全部", ...new Set(s.watchlist.map((w) => w.group))];
  const items = s.watchlist.filter(
    (w) =>
      (group === "全部" || w.group === group) &&
      `${w.company.ticker} ${w.company.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="page-content">
      <PageHeading
        title="自选"
        description="从公司出发，持续跟踪你的研究判断。"
        actions={
          <button className="page-button page-button-primary" onClick={() => setAdding(true)}>
            <Plus size={17} />
            添加标的
          </button>
        }
      />
      <div className="page-toolbar">
        <div className="filter-tabs">
          {groups.map((g) => (
            <button key={g} aria-pressed={group === g} onClick={() => setGroup(g)}>
              {g}
            </button>
          ))}
        </div>
        <PageSearch value={query} onChange={setQuery} label="搜索标的" />
      </div>
      <p className="subtle-note">本地研究列表 · 不提供实时行情。公司股票与交易合约独立记录。</p>
      {items.length ? (
        <div className="watch-table">
          <div className="watch-head">
            <span>研究标的</span>
            <span>标的类型 / 市场</span>
            <span>研究关注</span>
            <span />
          </div>
          {items.map((w) => (
            <div key={w.id} className="watch-row">
              <div className="watch-company">
                <CompanyLogo company={w.company} size={34} />
                <span>
                  <strong>{w.company.ticker}</strong>
                  <small>{w.company.name}</small>
                </span>
              </div>
              <div>
                <span className={`type-tag ${w.type}`}>
                  {w.type === "equity" ? "公司 / 股票" : "交易合约"}
                </span>
                <small>{w.venue}</small>
              </div>
              <p>{w.note || "尚未添加研究关注"}</p>
              <div className="page-row-actions">
                <IconButton
                  label={`研究 ${w.company.ticker}`}
                  onClick={() =>
                    s.newSession(
                      undefined,
                      w.company,
                      `研究 ${w.company.name}（${w.company.ticker}）${w.type === "contract" ? "，请将公司基本面与交易合约特征分开分析" : ""}`,
                    )
                  }
                >
                  <ArrowUpRight size={17} />
                </IconButton>
                <IconButton label={`移除 ${w.company.ticker}`} onClick={() => setRemove(w)}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Star size={25} />}
          title="暂无匹配的标的"
          action={
            <button className="page-button" onClick={() => setAdding(true)}>
              添加标的
            </button>
          }
        />
      )}
      {adding && <AddWatch onClose={() => setAdding(false)} />}{" "}
      {remove && (
        <ConfirmRemoval
          title="移除自选"
          confirmLabel="移除"
          onClose={() => setRemove(null)}
          onConfirm={() => {
            s.removeWatch(remove.id);
            setRemove(null);
            if (s.watchlist.filter((w) => w.group === group).length === 1) setGroup("全部");
          }}
        >
          <p>将 {remove.company.ticker} 从自选中移除？研究会话仍保留。</p>
        </ConfirmRemoval>
      )}
    </div>
  );
}
function AddWatch({ onClose }: { onClose: () => void }) {
  const s = useWorkspace();
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"equity" | "contract">("equity");
  const [venue, setVenue] = useState("NASDAQ");
  const [group, setGroup] = useState("我的关注");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[A-Z0-9.-]{1,20}$/.test(ticker.trim().toUpperCase()) || !venue.trim())
      return setError("请输入有效的代码与交易市场。");
    const company = companies.find((c) => c.ticker === ticker.trim().toUpperCase()) || {
      ticker: ticker.trim().toUpperCase(),
      name: name.trim() || ticker.toUpperCase(),
    };
    s.addWatch({
      company,
      type,
      venue: venue.trim(),
      group: group.trim() || "我的关注",
      note: note.trim(),
    });
    onClose();
  }
  return (
    <Modal title="添加研究标的" onClose={onClose}>
      <form className="page-form" onSubmit={submit}>
        <div className="form-columns">
          <Field label="代码">
            <input
              autoFocus
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="NVDA"
              maxLength={20}
            />
          </Field>
          <Field label="公司名称">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="NVIDIA" />
          </Field>
        </div>
        <div className="form-columns">
          <Field label="标的类型">
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as "equity" | "contract");
                setVenue(e.target.value === "contract" ? "Binance" : "NASDAQ");
              }}
            >
              <option value="equity">公司 / 股票</option>
              <option value="contract">交易合约</option>
            </select>
          </Field>
          <Field label="交易市场">
            <input value={venue} onChange={(e) => setVenue(e.target.value)} />
          </Field>
        </div>
        <Field label="分组">
          <input value={group} onChange={(e) => setGroup(e.target.value)} />
        </Field>
        <Field label="研究关注（可选）">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        <FormError message={error} />
        <div className="page-form-actions">
          <button type="button" className="page-button" onClick={onClose}>
            取消
          </button>
          <button className="page-button page-button-primary">添加自选</button>
        </div>
      </form>
    </Modal>
  );
}
export function RemindersPage() {
  const s = useWorkspace();
  const [editor, setEditor] = useState<Reminder | "new" | null>(null);
  const [remove, setRemove] = useState<Reminder | null>(null);
  if (s.mode === "live") return <LivePageNotice title="提醒" />;
  return (
    <div className="page-content">
      <PageHeading
        title="提醒"
        description="把研究节奏，变成持续的验证。"
        actions={
          <button className="page-button page-button-primary" onClick={() => setEditor("new")}>
            <Plus size={17} />
            新建提醒
          </button>
        }
      />
      <div className="demo-callout">
        <Bell size={17} />
        <span>本地演示 · 可编辑提醒规则，尚不执行定时任务或发送通知。</span>
      </div>
      {s.reminders.length ? (
        <div className="reminder-list">
          {s.reminders.map((r) => (
            <article className="reminder-card" key={r.id}>
              <div className="reminder-icon">
                <Bell size={20} />
              </div>
              <div className="reminder-copy">
                <div>
                  <h2>{r.name}</h2>
                  <span className="type-tag">{r.enabled ? "已启用 · 演示" : "已暂停"}</span>
                </div>
                <p>{r.prompt}</p>
                <small>{r.schedule}</small>
              </div>
              <div className="page-row-actions">
                <IconButton
                  label={`${r.enabled ? "暂停" : "启用"} ${r.name}`}
                  onClick={() => s.saveReminder({ ...r, enabled: !r.enabled })}
                >
                  {r.enabled ? <Pause size={16} /> : <Play size={16} />}
                </IconButton>
                <IconButton label={`编辑 ${r.name}`} onClick={() => setEditor(r)}>
                  <Pencil size={16} />
                </IconButton>
                <IconButton label={`删除 ${r.name}`} onClick={() => setRemove(r)}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Bell size={26} />}
          title="暂无提醒"
          action={
            <button className="page-button" onClick={() => setEditor("new")}>
              新建提醒
            </button>
          }
        />
      )}
      {editor && (
        <ReminderEditor
          item={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}{" "}
      {remove && (
        <ConfirmRemoval
          title="删除提醒"
          onClose={() => setRemove(null)}
          onConfirm={() => {
            s.removeReminder(remove.id);
            setRemove(null);
          }}
        >
          <p>删除本地提醒「{remove.name}」？</p>
        </ConfirmRemoval>
      )}
    </div>
  );
}
function ReminderEditor({ item, onClose }: { item?: Reminder; onClose: () => void }) {
  const save = useWorkspace((s) => s.saveReminder);
  const [name, setName] = useState(item?.name || "");
  const [prompt, setPrompt] = useState(item?.prompt || "");
  const [schedule, setSchedule] = useState(item?.schedule || "每周五 18:00");
  const [error, setError] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !prompt.trim() || !schedule.trim())
      return setError("请填写提醒名称、内容和时间。");
    save({
      id: item?.id || crypto.randomUUID(),
      name: name.trim(),
      prompt: prompt.trim(),
      schedule: schedule.trim(),
      enabled: item?.enabled ?? false,
      createdAt: item?.createdAt || Date.now(),
    });
    onClose();
  }
  return (
    <Modal title={item ? "编辑提醒" : "新建提醒"} onClose={onClose}>
      <form className="page-form" onSubmit={submit}>
        <Field label="提醒名称">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="研究任务">
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} />
        </Field>
        <Field label="执行时间">
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="每周五 18:00"
          />
        </Field>
        <p className="subtle-note">此规则保存在本地演示中，不会触发真实通知。</p>
        <FormError message={error} />
        <div className="page-form-actions">
          <button type="button" className="page-button" onClick={onClose}>
            取消
          </button>
          <button className="page-button page-button-primary">保存提醒</button>
        </div>
      </form>
    </Modal>
  );
}
