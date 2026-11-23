// 2026-11-21：使用独立的设置页配置本机文本模型连接。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { desktop, desktopAvailable, errorText } from "../services/desktop";

const modelsKey = ["ai-model-connections"] as const;

export function AiModelSettings() {
  const cache = useQueryClient();
  const enabled = desktopAvailable();
  const models = useQuery({ queryKey: modelsKey, queryFn: desktop.aiModels, enabled });
  const [editing, setEditing] = useState<number | "new">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // 2026-11-21：连接测试单独反馈，等待服务时仍可切换当前模型。
  const [test, setTest] = useState<{ id: number; pending?: boolean; message?: string; error?: boolean }>();
  const selected = models.data?.find(({ id }) => id === editing);

  function openEditor(id?: number | "new") {
    setEditing(id);
    setError("");
    setNotice("");
  }

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      await cache.invalidateQueries({ queryKey: modelsKey });
      setNotice(result);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void run(async () => {
      // 2026-11-21：默认生成参数按 BeadDiffV2 的 JSON 对象格式编辑。
      const raw = String(fields.get("generationParameters") ?? "").trim();
      let parameters: unknown;
      try { parameters = raw ? JSON.parse(raw) : {}; }
      catch { throw new Error("默认生成参数不是有效的 JSON。"); }
      if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
        throw new Error("默认生成参数必须是 JSON 对象。");
      }
      await desktop.saveAiModel({
        id: typeof editing === "number" ? editing : undefined,
        name: String(fields.get("name") ?? ""),
        baseUrl: String(fields.get("baseUrl") ?? ""),
        // 2026-11-21：编辑列表时保留仍在列表中的当前模型。
        model: selected?.model ?? "",
        models: String(fields.get("models") ?? "").split(/\r?\n/),
        generationParameters: parameters as Record<string, unknown>,
        timeoutSeconds: Number(fields.get("timeoutSeconds")),
        apiKey: String(fields.get("apiKey") ?? ""),
      });
      setEditing(undefined);
      return "模型连接已保存。";
    });
  }

  // 2026-11-21：使用已保存的接口、模型与密钥跑一次短文本请求。
  async function testConnection(id: number) {
    setTest({ id, pending: true });
    try {
      const result = await desktop.testAiModel(id);
      setTest({ id, message: result.hasText
        ? `测试通过 · ${result.model} · ${result.elapsedMs} ms`
        : `模型已响应 · ${result.model} · 仅返回推理内容` });
    } catch (reason) {
      setTest({ id, message: errorText(reason), error: true });
    }
  }

  return <>
    {!enabled && <p className="notice">请在桌面应用中配置 AI 模型。</p>}
    {(error || models.error) && <p className="notice danger" role="alert">{error || errorText(models.error)}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <section className="card settings-card">
      <h2>模型连接</h2>
      <button type="button" className="button secondary" disabled={!enabled || busy} onClick={() => openEditor("new")}>新增连接</button>
      {enabled && <div className="folder-list">
        {models.isPending && <p className="muted" role="status">正在读取模型连接…</p>}
        {models.data?.length === 0 && <p className="muted">尚未添加连接。</p>}
        {models.data?.map((connection) => <div className="recent-row" key={connection.id}>
          <div className="ai-model-summary">
            <button type="button" className="text-button" disabled={busy} onClick={() => openEditor(connection.id)}>
              <strong>{connection.name}</strong>
            </button>
            {/* 2026-11-21：连接摘要显示地址，模型选择位于右侧操作区。 */}
            <span className="muted">{connection.baseUrl}</span>
          </div>
          <span>{connection.hasApiKey ? "API Key 已配置" : "API Key 未配置"}</span>
          <div className="table-actions">
            {/* 2026-11-21：在连接列表直接选择模型，并测试当前选中的模型。 */}
            <select aria-label={`${connection.name} 的当前模型`} value={connection.model} disabled={busy}
              onChange={(event) => {
                const model = event.currentTarget.value;
                void run(async () => {
                  await desktop.setAiModelVariant(connection.id, model);
                  return `已选择 ${model}。`;
                });
              }}>
              {connection.models.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
            <button type="button" className="button secondary" disabled={busy || Boolean(test?.pending)}
              title="向已保存的模型发送一条测试请求" onClick={() => void testConnection(connection.id)}>
              {test?.id === connection.id && test.pending ? "测试中…" : "测试连接"}
            </button>
            {connection.active ? <span className="positive">当前使用</span> : <button type="button" className="button secondary" disabled={busy} onClick={() => {
              void run(async () => {
                await desktop.selectAiModel(connection.id);
                return "已切换当前模型连接。";
              });
            }}>设为当前</button>}
            <button type="button" className="text-button" disabled={busy} onClick={() => {
              if (!window.confirm(`删除「${connection.name}」及其 API Key？`)) return;
              void run(async () => {
                await desktop.deleteAiModel(connection.id);
                if (editing === connection.id) setEditing(undefined);
                return "模型连接已删除。";
              });
            }}>删除</button>
          </div>
          {test?.id === connection.id && test.message && <p className={`folder-list ${test.error ? "negative" : "muted"}`}
            role={test.error ? "alert" : "status"}>{test.message}</p>}
        </div>)}
      </div>}
    </section>
    {enabled && editing !== undefined && <section className="card settings-card">
      <h2>{editing === "new" ? "新增连接" : "编辑连接"}</h2>
      <form className="ai-model-form" key={editing} onSubmit={save}>
        <label>服务名称<input name="name" required maxLength={100} defaultValue={selected?.name} disabled={busy} /></label>
        <label>API 根地址<input name="baseUrl" type="url" required maxLength={2048} placeholder="https://example.com/v1" defaultValue={selected?.baseUrl} disabled={busy} /></label>
        {/* 2026-11-21：每个连接可以录入多个模型，每行一个模型名。 */}
        <label>模型列表（每行一个）<textarea name="models" required rows={4} defaultValue={selected?.models.join("\n")} disabled={busy} /></label>
        <label>API Key<input name="apiKey" type="password" autoComplete="off" maxLength={4096} disabled={busy}
          placeholder={selected?.hasApiKey ? "已保存，留空保留原密钥" : undefined} /></label>
        {/* 2026-11-21：高级选项控制文本请求的默认参数与最长等待时间。 */}
        <details className="ai-model-advanced">
          <summary>高级选项</summary>
          <label>默认生成参数<textarea name="generationParameters" rows={4} disabled={busy}
            defaultValue={JSON.stringify(selected?.generationParameters ?? {}, null, 2)} /></label>
          <label>请求超时（秒）<input name="timeoutSeconds" type="number" min={5} max={600} step={1}
            defaultValue={selected?.timeoutSeconds ?? 120} required disabled={busy} /></label>
        </details>
        <div className="table-actions">
          <button className="button primary" type="submit" disabled={busy}>保存连接</button>
          <button className="button secondary" type="button" disabled={busy} onClick={() => openEditor()}>取消</button>
        </div>
      </form>
    </section>}
  </>;
}
