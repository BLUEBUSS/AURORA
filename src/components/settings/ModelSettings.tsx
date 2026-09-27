import { useEffect, useState, type FormEvent } from "react";
import { Loader2, PlugZap, Trash2 } from "lucide-react";
import { useConnection, connectResearch } from "../../state/research";
import { requestModelSettings, type ModelSettingsInput } from "../../services/model-settings";
import { Field } from "../ui";

const initial: ModelSettingsInput = { api: "openai-completions", baseUrl: "", modelId: "", apiKey: "", reasoning: false, contextWindow: 128000, maxTokens: 8192 };
export function ModelSettings({ openDataSources }: { openDataSources?: () => void } = {}) {
  const runtime = useConnection((state) => state.runtime);
  const [form, setForm] = useState(initial);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (runtime?.kind === "aurora") void requestModelSettings("GET").then((data) => {
      if (active) { setConfigured(data.configured); setForm({ ...initial, ...data.model, apiKey: "" }); }
    }).catch(() => { if (active) setError("模型配置暂不可读取，请重新连接本机服务。"); });
    return () => { active = false; };
  }, [runtime]);
  function update<K extends keyof ModelSettingsInput>(key: K, value: ModelSettingsInput[K]) { setForm((current) => ({ ...current, [key]: value })); setError(""); setNotice(""); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await requestModelSettings("POST", form);
      setForm((current) => ({ ...current, apiKey: "" })); setConfigured(true);
      if (await connectResearch()) setNotice("连接测试通过，模型已保存。主研究和子任务将使用你的模型。");
      else setError("模型已保存，但会话列表刷新失败，请重新连接。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "模型保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (busy) return; setBusy(true); setError("");
    try { await requestModelSettings("DELETE"); setConfigured(false); setForm(initial); await connectResearch(); setNotice("模型和保存的 Key 已移除。"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "模型移除失败。"); }
    finally { setBusy(false); }
  }
  return <>
    <h3 className="settings-title">模型</h3>
    <p className="settings-description">接入你自己的模型服务。Key 仅交由本机后端保管，调用费用由你的模型账户承担。</p>
    {runtime?.kind !== "aurora" ? <p className="settings-running-note">请先连接独立 AURORA 本机服务。旧后端的模型仍由其原有设置管理。</p> : <form className="settings-login-form model-settings-form" onSubmit={(event) => void save(event)}>
      <Field label="API 协议"><select value={form.api} disabled={busy} onChange={(event) => update("api", event.target.value as ModelSettingsInput["api"])}>
        <option value="openai-completions">OpenAI 兼容 Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option>
      </select></Field>
      <Field label="服务地址（Base URL）"><input required value={form.baseUrl} disabled={busy} placeholder="https://your-provider.example/v1" onChange={(event) => update("baseUrl", event.target.value)} /></Field>
      <Field label="模型名称"><input required value={form.modelId} disabled={busy} placeholder="填写服务商提供的模型 ID" onChange={(event) => update("modelId", event.target.value)} /></Field>
      <Field label="API Key"><input type="password" autoComplete="off" required={!configured} disabled={busy} value={form.apiKey} placeholder={configured ? "已保存；留空保留同一模型的 Key" : "填写你自己的 API Key"} onChange={(event) => update("apiKey", event.target.value)} /></Field>
      <details><summary>高级选项</summary>
        <Field label="上下文长度"><input type="number" min={4096} max={2000000} disabled={busy} value={form.contextWindow} onChange={(event) => update("contextWindow", Number(event.target.value))} /></Field>
        <Field label="最大输出 Token"><input type="number" min={256} max={form.contextWindow} disabled={busy} value={form.maxTokens} onChange={(event) => update("maxTokens", Number(event.target.value))} /></Field>
        <label><input type="checkbox" checked={form.reasoning} disabled={busy} onChange={(event) => update("reasoning", event.target.checked)} /> 此模型支持推理</label>
      </details>
      {openDataSources && <button className="page-button" type="button" onClick={openDataSources}>配置公告、行情与宏观数据 →</button>}
      <p className="settings-description">官方 Kimi 服务地址可使用同一 Key 进行联网检索，搜索费用计入你的 Kimi 账户。搜索提供公开网页线索，不等于已配置 SEC、行情或宏观数据接口。</p>
      <p className="settings-description">测试会发送一条简短请求，可能产生少量费用。更换模型后请新建研究会话。</p>
      {error && <p className="settings-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      <div className="settings-connection-actions">
        <button className="page-button page-button-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <PlugZap size={15} />}测试并保存</button>
        {configured && <button className="page-button" type="button" disabled={busy} onClick={() => void remove()}><Trash2 size={15} />移除模型与 Key</button>}
      </div>
    </form>}
  </>;
}
