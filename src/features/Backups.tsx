// 2026-11-19：恢复前展示实际写入范围，并允许下载和恢复本机回退点。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FolderUp } from "lucide-react";
import { useState } from "react";
import type { ChangeEvent } from "react";
import { readBackupInput } from "../domain/legacyWorkspace";
import type { BackupInput } from "../domain/legacyWorkspace";
import { desktop, desktopAvailable, downloadFile, errorText } from "../services/desktop";
import type { Backup, RestoreMode, RestorePreview } from "../services/desktop";
import { useBankIndex } from "../services/banks";
import { reportDiagnostic } from "../services/diagnostics";
// 2026-11-23：建立备份和恢复范围之前，先等后台删词操作结束。
import { vocabularyRemovals } from "../services/vocabularyRemovals";

const backupsKey = ["workspace-backups"] as const;
const sourceLabels = { desktop: "桌面备份", "legacy-v2": "原版 v2 备份", "legacy-records": "原版成绩文件" };
const download = (backup: Backup, suffix = new Date().toISOString().slice(0, 10)) =>
  downloadFile(`ietls4pass-backup-${suffix}.json`, JSON.stringify(backup, null, 2), "application/json");

export function Backups() {
  const enabled = desktopAvailable();
  const cache = useQueryClient();
  const index = useBankIndex();
  const backups = useQuery({ queryKey: backupsKey, queryFn: desktop.backups, enabled });
  const [input, setInput] = useState<BackupInput>();
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [preview, setPreview] = useState<RestorePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    // 2026-11-23：备份快照不能漏掉刚提交的词条删除，恢复也不能被延迟写入覆盖。
    try {
      await vocabularyRemovals.flush(cache);
      await action();
    }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function changePreview(incoming: BackupInput, nextMode: RestoreMode) {
    setInput(incoming);
    setMode(nextMode);
    setPreview(undefined);
    setPreview(await desktop.previewRestore(incoming.backup, nextMode));
  }

  function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setInput(undefined);
    setPreview(undefined);
    void run(async () => {
      let parsed: BackupInput;
      try { parsed = readBackupInput(JSON.parse((await file.text()).replace(/^\uFEFF/, "")), index.data?.aliases); }
      catch (error) { reportDiagnostic("backup_file"); throw error; }
      await changePreview(parsed, "merge");
    });
  }

  function apply() {
    if (!input || !preview) return;
    if (mode === "replace" && !window.confirm("覆盖当前成绩和工作区资料？应用会先保存一份本机回退点。")) return;
    void run(async () => {
      setPreview(undefined);
      const result = await desktop.applyRestore(input.backup, mode, preview.token);
      setInput(undefined);
      cache.removeQueries({ queryKey: ["reading-asset"] });
      cache.removeQueries({ queryKey: ["listening-asset"] });
      await cache.invalidateQueries();
      setNotice(`${mode === "merge" ? "合并" : "覆盖"}完成。写入 ${result.addedRecords} 条成绩和 ${result.addedDocuments} 项资料。`
        + (result.rollbackId === null ? "" : ` 可从本机回退点 #${result.rollbackId} 恢复。`));
    });
  }

  return <section className="card settings-card bank-folders">
    {/* 2026-11-21：备份区块直接显示标题和操作。 */}
    <h2>备份与恢复</h2>
    <div className="table-actions">
      <button type="button" className="button secondary" disabled={!enabled || busy} onClick={() => void run(async () => download(await desktop.export()))}>
        <Download size={16} />下载备份
      </button>
      <label className="button secondary file-button"><FolderUp size={16} />选择恢复文件
        <input type="file" accept=".json,application/json" disabled={!enabled || busy} onChange={upload} />
      </label>
      <button type="button" className="button secondary" disabled={!enabled || busy} onClick={() => void run(async () => {
        const id = await desktop.createBackup();
        await cache.invalidateQueries({ queryKey: backupsKey });
        setNotice(`本机回退点 #${id} 已创建。`);
      })}>创建本机回退点</button>
    </div>
    {(error || backups.error) && <p className="notice danger" role="alert">{error || errorText(backups.error)}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {input && <div className="folder-list">
      <h3>{sourceLabels[input.source]}恢复预览</h3>
      {preview && <>
        <p>文件中有 {preview.incomingRecords} 条成绩和 {preview.incomingDocuments} 项资料。</p>
        {mode === "merge" ? <p>同标识的 {preview.conflictingRecords} 条成绩和 {preview.conflictingDocuments} 项资料保留本机版本。</p>
          : <p>当前 {preview.existingRecords} 条成绩和 {preview.existingDocuments} 项资料会先存入回退点，再由文件内容覆盖。</p>}
        <p className="muted">{preview.verified || input.source === "legacy-v2" ? "文件校验已通过。" : "文件只提供结构校验。"}
          {input.ignored > 0 && ` 略过 ${input.ignored} 条无效或重复的原版成绩。`}
          {input.archived > 0 && ` 同时保留 ${input.archived} 组原版字段供后续迁移。`}</p>
      </>}
      <div className="table-actions">
        {input.source === "desktop" && <label>恢复方式<select value={mode} disabled={busy} onChange={(event) => {
          const next = event.target.value === "replace" ? "replace" : "merge";
          void run(() => changePreview(input, next));
        }}><option value="merge">合并</option><option value="replace">覆盖</option></select></label>}
        {preview ? <button type="button" className={`button ${mode === "replace" ? "dangerous" : "primary"}`} disabled={busy} onClick={apply}>
          {mode === "replace" ? "确认覆盖" : "确认合并"}
        </button> : <button type="button" className="button secondary" disabled={busy} onClick={() => void run(() => changePreview(input, mode))}>重新生成预览</button>}
        <button type="button" className="text-button" disabled={busy} onClick={() => { setInput(undefined); setPreview(undefined); }}>关闭预览</button>
      </div>
    </div>}
    {!!backups.data?.length && <div className="folder-list">
      <h3>本机回退点</h3>
      {backups.data.map((entry) => <div key={entry.id} className="recent-row">
        <span>#{entry.id} · {entry.source === "before-replace" ? "覆盖前自动保存" : "手动创建"} · {new Date(entry.createdAt).toLocaleString()}
          <small className="folder-path">{entry.records} 条成绩 · {entry.documents} 项资料</small></span>
        <div className="table-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => void run(async () => {
            const backup = await desktop.readBackup(entry.id);
            await changePreview({ backup, source: "desktop", archived: 0, ignored: 0 }, "replace");
          })}>预览恢复</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => download(await desktop.readBackup(entry.id), `snapshot-${entry.id}`))}>下载</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => {
            if (window.confirm(`删除本机回退点 #${entry.id}？`)) void run(async () => {
              await desktop.deleteBackup(entry.id);
              await cache.invalidateQueries({ queryKey: backupsKey });
            });
          }}>删除</button>
        </div>
      </div>)}
    </div>}
  </section>;
}
