// 2026-11-19：提供本地诊断查询、限时详细记录、清理与手动导出。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clearDiagnostics, configureDiagnostics, diagnosticReport } from "../services/diagnostics";
import { desktopAvailable, downloadFile, errorText } from "../services/desktop";

const reportKey = ["diagnostic-report"] as const;

export function Diagnostics() {
  const enabled = desktopAvailable();
  const cache = useQueryClient();
  const report = useQuery({ queryKey: reportKey, queryFn: diagnosticReport, enabled, refetchInterval: 15_000 });
  const update = useMutation({ mutationFn: (action: () => Promise<void>) => action(), onSuccess: () => cache.invalidateQueries({ queryKey: reportKey }) });
  const data = report.data;
  const persistent = data?.storage === "sqlite";
  const detailed = data?.preference.detailedUntil;
  return <section className="card settings-card bank-folders">
    {/* 2026-11-21：本地诊断区块直接显示标题、控件与状态。 */}
    <h2>本地诊断</h2>
    {data && <>
      <div className="table-actions">
        <label><input type="checkbox" checked={data.preference.enabled} disabled={!persistent || update.isPending}
          onChange={(event) => {
            const checked = event.currentTarget.checked;
            update.mutate(() => configureDiagnostics(checked, false));
          }} /> 记录本地诊断</label>
        <button type="button" className="button secondary" disabled={!persistent || !data.preference.enabled || update.isPending}
          onClick={() => update.mutate(() => configureDiagnostics(true, !detailed))}>{detailed ? "结束详细记录" : "详细记录 15 分钟"}</button>
        <button type="button" className="button secondary" disabled={report.isFetching || update.isPending} onClick={() => void report.refetch()}>刷新</button>
        <button type="button" className="button secondary" disabled={report.isFetching || update.isPending} onClick={() => {
          update.mutate(async () => {
            const current = await diagnosticReport();
            downloadFile("ietls4pass-diagnostics.json", JSON.stringify(current, null, 2), "application/json");
          });
        }}>导出诊断</button>
        <button type="button" className="text-button" disabled={update.isPending || (!data.events.length && !data.memory.length)} onClick={() => {
          if (window.confirm("清除本地诊断记录？")) update.mutate(() => clearDiagnostics(persistent));
        }}>清除诊断</button>
      </div>
      {/* 2026-11-21：移除常驻的 SQLite 事件计数，按需显示诊断状态。 */}
      {(!persistent || data.memory.length > 0 || detailed) && <p className="muted folder-list" role="status">
        {!persistent && "SQLite 暂不可用，可以导出本次运行的内存诊断。"}
        {data.memory.length > 0 && ` 内存中有 ${data.memory.length} 条事件。`}
        {detailed && ` 详细记录持续到 ${new Date(detailed).toLocaleTimeString()}。`}
      </p>}
    </>}
    {update.error && <p className="notice danger" role="alert">{errorText(update.error)}</p>}
  </section>;
}
