// 2026-11-19：读取、筛选、查看和批量导出 SQLite 的历史练习及逐题对比。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { dateText, durationText, kindLabel, recordMatches, recordsMarkdown, usableScore } from "../domain/records";
import type { PracticeRecord } from "../domain/types";
import { examKey, readingAsset, useCustomBanks, MAIN_BANK } from "../services/banks";
import { desktop, desktopAvailable, downloadFile, errorText, recordsKey } from "../services/desktop";
import { AnswerReview } from "./reading/AnswerReview";
// 2026-11-19：历史显示关联前台时长和提前结束的套题，并回放实际保存的作答。
import { ReadingTimingPanel } from "./reading/ReadingTimingPanel";

export function Records() {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: recordsKey, queryFn: desktop.records, enabled: desktopAvailable() });
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const filtered = (query.data ?? []).filter((record) => (kind === "all" || record.kind === kind) && recordMatches(record, search));
  const selectedRecords = filtered.filter((record) => selected.has(record.id));
  const remove = useMutation({
    mutationFn: desktop.deleteRecords,
    onSuccess: async () => {
      setSelected(new Set());
      await cache.invalidateQueries({ queryKey: recordsKey });
      // 2026-11-19：同步删除成绩后更新的回放、复习计划和批注。
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["documents", "review-plans"] }),
        cache.invalidateQueries({ queryKey: ["documents", "annotations"] }),
      ]);
    },
  });
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return <>
    {/* 2026-11-19：去除练习记录模块页头，保留导出和删除操作。 */}
    {!desktopAvailable() && <p className="notice">本机历史在桌面应用中可用。</p>}
    {(query.error || remove.error) && <p className="notice danger" role="alert">{errorText(query.error || remove.error)}</p>}
    {/* 2026-11-19：搜索、类型筛选和批量操作共用工具栏。 */}
    <div className="filter-bar filter-with-actions">
      <label className="search-field"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索练习记录" aria-label="搜索练习记录" /></label>
      <label>类型<select value={kind} onChange={(event) => setKind(event.target.value)}>
        <option value="all">全部</option><option value="reading">阅读</option><option value="listening">听力</option><option value="suite">套题</option>
      </select></label>
      <div className="table-actions filter-actions">
        <button type="button" className="button secondary" disabled={!filtered.length} onClick={() => downloadFile("ietls4pass-records.md", recordsMarkdown(selectedRecords.length ? selectedRecords : filtered), "text/markdown;charset=utf-8")}><Download size={16} />导出 Markdown</button>
        <button type="button" className="button secondary" disabled={!selectedRecords.length || remove.isPending}
          onClick={() => {
            if (window.confirm(`从本机删除选中的 ${selectedRecords.length} 条成绩？`)) remove.mutate(selectedRecords.map((item) => item.id));
          }}><Trash2 size={16} />删除所选</button>
      </div>
    </div>
    <div className="list-caption">{filtered.length} 条记录{selectedRecords.length ? ` · 已选 ${selectedRecords.length} 条` : ""}</div>
    <div className="card table-scroll"><table>
      <thead><tr>
        <th><input type="checkbox" aria-label="选择当前列表" checked={Boolean(filtered.length && filtered.every((item) => selected.has(item.id)))}
          onChange={(event) => setSelected(event.target.checked ? new Set(filtered.map((item) => item.id)) : new Set())} /></th>
        {/* 2026-11-19：历史详情显示原始用时口径。 */}
        <th>练习</th><th>类型</th><th>得分</th><th>记录用时</th><th>提交时间</th>
      </tr></thead>
      <tbody>{filtered.map((record) => <tr key={record.id}>
        <td><input type="checkbox" checked={selected.has(record.id)} aria-label={`选择 ${record.title}`} onChange={() => toggle(record.id)} /></td>
        <td><Link to={`/records/${encodeURIComponent(record.id)}`}>{record.title}</Link></td>
        <td>{kindLabel[record.kind]}</td><td>{usableScore(record) ? `${record.points} / ${record.possible}` : "—"}</td>
        <td>{durationText(record.elapsedMs)}</td><td>{dateText(record.submittedAt)}</td>
      </tr>)}</tbody>
    </table>
    {!filtered.length && <p className="empty">{query.isLoading ? "正在读取记录…" : "暂无符合条件的练习记录。"}</p>}</div>
  </>;
}

export function RecordDetail() {
  const { id } = useParams();
  const query = useQuery({ queryKey: recordsKey, queryFn: desktop.records, enabled: desktopAvailable() });
  const record = query.data?.find((item) => item.id === id);
  if (query.error) return <p className="notice danger" role="alert">{errorText(query.error)}</p>;
  if (!record) return <p className="notice">{query.isLoading ? "正在读取…" : "该记录不可用。"} <Link to="/records">返回练习记录</Link></p>;
  return <>
    <div className="page-heading"><div>
      <Link className="back-link" to="/records"><ArrowLeft size={16} />练习记录</Link>
      <h1>{record.title}</h1><p>{kindLabel[record.kind]} · {dateText(record.submittedAt)}</p>
    </div><button type="button" className="button secondary" onClick={() => downloadFile("ietls4pass-record.md", recordsMarkdown([record]), "text/markdown;charset=utf-8")}><Download size={16} />导出 Markdown</button></div>
    <div className="result-summary"><b>{usableScore(record) ? `${record.points} / ${record.possible} 分` : "得分未知"}</b>
      <span>{record.source === "legacy" ? "原版记录用时" : "前台有效用时"} {durationText(record.elapsedMs)}</span></div>
    {record.partial && <p className="notice">套题提前结束。已保存 {record.children?.length ?? 0} / {record.suiteTotal ?? "未知"} 篇。</p>}
    {record.kind === "suite" && <ReadingTimingPanel record={record} />}
    {record.children?.length ? record.children.map((child) => <div key={child.id} className="record-child"><h2>{child.title}</h2><RecordAnswers record={child} /></div>)
      : <RecordAnswers record={record} />}
  </>;
}

function RecordAnswers({ record }: { record: PracticeRecord }) {
  const banks = useCustomBanks();
  const examId = record.examId ?? "";
  const bankId = record.bankId ?? "";
  const asset = useQuery({
    queryKey: examKey(bankId, examId), queryFn: () => readingAsset(bankId, examId, banks.data ?? []),
    enabled: record.kind === "reading" && Boolean(examId && bankId) && (bankId === MAIN_BANK || banks.isSuccess),
  });
  return <>
    {asset.data && <Link className="text-button" to={`/reading/${encodeURIComponent(bankId)}/${encodeURIComponent(examId)}?mode=replay&record=${encodeURIComponent(record.id)}`}>回放本次作答</Link>}
    {record.kind === "reading" && <ReadingTimingPanel record={record} />}
    <AnswerReview details={record.details ?? []} explanation={asset.data?.explanation} />
    {record.source === "legacy" && record.raw !== undefined && <details className="card legacy-data">
      <summary>查看导入的原始记录</summary><pre>{JSON.stringify(record.raw, null, 2)}</pre>
    </details>}
  </>;
}
