// 2026-11-19：读取、筛选、查看和批量导出 SQLite 的历史练习及逐题对比。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
// 2026-11-27：练习记录合并正式成绩和已结束的口语会话。
// 2026-11-27：记录列表也读取正式写作提交。
import { dateText, durationText, kindLabel, recordMatches, recordsMarkdown, speakingRecord, usableScore, writingRecord } from "../domain/records";
import type { ListedPracticeRecord } from "../domain/records";
import { isSubmittedSpeakingSession } from "../domain/speakingPractice";
import type { SpeakingSession } from "../domain/speakingPractice";
import type { PracticeRecord } from "../domain/types";
import { examKey, readingAsset, useCustomBanks, MAIN_BANK } from "../services/banks";
import { desktop, desktopAvailable, documentsKey, downloadFile, errorText, recordsKey } from "../services/desktop";
import { AnswerReview } from "./reading/AnswerReview";
// 2026-11-28：阅读记录继续使用单篇题目和关联计时。
import { ReadingTimingPanel } from "./reading/ReadingTimingPanel";
// 2026-11-27：复用口语消息气泡及本机录音回放。
import { SpeakingMessages, useSpeakingPlayback } from "./SpeakingMessages";
// 2026-11-27：总览和写作回看共用本机正式提交查询。
import { useWritingSubmissions, writingSubmissionsKey } from "../services/writingBank";

const speakingSessionsKey = documentsKey("speaking-sessions");

// 2026-11-27：用同一个键区分列表选择和两种回看入口。
function recordPath(record: ListedPracticeRecord) {
  const id = encodeURIComponent(record.id);
  return record.kind === "speaking" || record.kind === "writing" ? `/records/${record.kind}/${id}` : `/records/${id}`;
}

// 2026-11-27：列表和口语回看读取同一份本机口语会话。
function useSpeakingRecordSessions() {
  return useQuery({ queryKey: speakingSessionsKey, queryFn: () => desktop.documents<SpeakingSession>("speaking-sessions"),
    enabled: desktopAvailable() });
}

export function Records() {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: recordsKey, queryFn: desktop.records, enabled: desktopAvailable() });
  // 2026-11-27：口语加入全部记录，并遵循总览的完成条件。
  const speaking = useSpeakingRecordSessions();
  // 2026-11-27：写作加入全部记录，以及独立的写作筛选。
  const writing = useWritingSubmissions();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const records = [
    ...(query.data ?? []),
    ...(speaking.data ?? []).map(({ value }) => value).filter(isSubmittedSpeakingSession).map(speakingRecord),
    ...(writing.data ?? []).map(({ value }) => writingRecord(value)),
  ];
  const filtered = records.filter((record) => (kind === "all" || record.kind === kind) && recordMatches(record, search))
    .sort((first, second) => second.submittedAt.localeCompare(first.submittedAt));
  const selectedRecords = filtered.filter((record) => selected.has(recordPath(record)));
  // 2026-11-27：只显示当前筛选涉及的数据来源的读取状态。
  const showScores = kind === "all" || kind === "reading" || kind === "listening";
  const showSpeaking = kind === "all" || kind === "speaking";
  const showWriting = kind === "all" || kind === "writing";
  const loading = (showScores && query.isLoading) || (showSpeaking && speaking.isLoading) || (showWriting && writing.isLoading);
  const remove = useMutation({
    // 2026-11-27：按各科记录所在位置完成批量删除。
    mutationFn: (records: ListedPracticeRecord[]) => desktop.deleteRecords(
      records.filter((record) => record.kind !== "speaking" && record.kind !== "writing").map(({ id }) => id),
      records.filter((record) => record.kind === "speaking").map(({ id }) => id),
      records.filter((record) => record.kind === "writing").map(({ id }) => id),
    ),
    onSuccess: async () => {
      setSelected(new Set());
      // 2026-11-19：同步删除成绩后更新的回放、复习计划和批注。
      await Promise.all([
        cache.invalidateQueries({ queryKey: recordsKey }),
        cache.invalidateQueries({ queryKey: speakingSessionsKey }),
        cache.invalidateQueries({ queryKey: writingSubmissionsKey }),
        cache.invalidateQueries({ queryKey: ["documents", "review-plans"] }),
        cache.invalidateQueries({ queryKey: ["documents", "annotations"] }),
        cache.invalidateQueries({ queryKey: documentsKey("listening-highlights") }),
      ]);
    },
  });
  // 2026-11-27：按当前筛选范围显示读取错误。
  const error = remove.error || (showScores && query.error) || (showSpeaking && speaking.error) || (showWriting && writing.error);
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
    {error && <p className="notice danger" role="alert">{errorText(error)}</p>}
    {/* 2026-11-19：搜索、类型筛选和批量操作共用工具栏。 */}
    <div className="filter-bar filter-with-actions">
      <label className="search-field"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索练习记录" aria-label="搜索练习记录" /></label>
      <label>类型<select value={kind} onChange={(event) => setKind(event.target.value)}>
        <option value="all">全部</option><option value="reading">阅读</option><option value="listening">听力</option>
        <option value="speaking">口语</option>
        {/* 2026-11-27：加入写作正式提交的筛选入口。 */}
        <option value="writing">写作</option>
      </select></label>
      <div className="table-actions filter-actions">
        <button type="button" className="button secondary" disabled={!filtered.length} onClick={() => downloadFile("ietls4pass-records.md", recordsMarkdown(selectedRecords.length ? selectedRecords : filtered), "text/markdown;charset=utf-8")}><Download size={16} />导出 Markdown</button>
        <button type="button" className="button secondary" disabled={!selectedRecords.length || remove.isPending}
          onClick={() => {
            if (window.confirm(`从本机删除选中的 ${selectedRecords.length} 条练习记录？`)) remove.mutate(selectedRecords);
          }}><Trash2 size={16} />删除所选</button>
      </div>
    </div>
    <div className="list-caption">{filtered.length} 条记录{selectedRecords.length ? ` · 已选 ${selectedRecords.length} 条` : ""}</div>
    <div className="card table-scroll"><table>
      <thead><tr>
        <th><input type="checkbox" aria-label="选择当前列表" checked={Boolean(filtered.length && filtered.every((item) => selected.has(recordPath(item))))}
          onChange={(event) => setSelected(event.target.checked ? new Set(filtered.map(recordPath)) : new Set())} /></th>
        {/* 2026-11-19：历史详情显示原始用时口径。 */}
        <th>练习</th><th>类型</th><th>得分</th><th>记录用时</th><th>提交时间</th>
      </tr></thead>
      <tbody>{filtered.map((record) => <tr key={recordPath(record)}>
        <td><input type="checkbox" checked={selected.has(recordPath(record))} aria-label={`选择 ${record.title}`} onChange={() => toggle(recordPath(record))} /></td>
        <td><Link to={recordPath(record)}>{record.title}</Link>
          {(record.kind === "speaking" || record.kind === "writing") && <small className="muted"> · {record.category}</small>}</td>
        <td>{kindLabel[record.kind]}</td><td>{record.kind !== "speaking" && record.kind !== "writing" && usableScore(record)
          ? `${record.points} / ${record.possible}` : "—"}</td>
        <td>{durationText(record.elapsedMs)}</td><td>{dateText(record.submittedAt)}</td>
      </tr>)}</tbody>
    </table>
    {!filtered.length && <p className="empty">{loading ? "正在读取记录…" : "暂无符合条件的练习记录。"}</p>}</div>
  </>;
}

// 2026-11-27：按会话 ID 回看原对话，即使题库目录中已找不到该话题。
export function SpeakingRecordDetail() {
  const { id } = useParams();
  const query = useSpeakingRecordSessions();
  const session = query.data?.find(({ value }) => value.id === id && isSubmittedSpeakingSession(value))?.value;
  if (query.error) return <p className="notice danger" role="alert">{errorText(query.error)} <Link to="/records">返回练习记录</Link></p>;
  if (!session) return <p className="notice">{query.isLoading ? "正在读取…" : "该记录不可用。"} <Link to="/records">返回练习记录</Link></p>;
  return <SpeakingRecordReview key={session.id} session={session} />;
}

// 2026-11-27：复盘按当时保存的文字及录音回放。
function SpeakingRecordReview({ session }: { session: SpeakingSession }) {
  const [error, setError] = useState("");
  const playback = useSpeakingPlayback(setError);
  return <>
    <div className="page-heading"><div>
      <Link className="back-link" to="/records"><ArrowLeft size={16} />练习记录</Link>
      <h1>{session.title}</h1>
      <p>口语 · Part {session.part} · {dateText(session.updatedAt)} · {durationText(session.elapsedMs)}</p>
    </div><button type="button" className="button secondary"
      onClick={() => downloadFile("ietls4pass-record.md", recordsMarkdown([speakingRecord(session)]), "text/markdown;charset=utf-8")}>
      <Download size={16} />导出 Markdown</button></div>
    {error && <p className="notice danger" role="alert">{error}</p>}
    <section className="card" aria-label="口语对话">
      <div className="speaking-transcript">
        <SpeakingMessages messages={session.messages} finished hasVoice={false} canPlay playingAudio={playback.playing}
          onAudio={(audioId) => { setError(""); void playback.play(session.id, audioId); }} />
      </div>
    </section>
  </>;
}

// 2026-11-27：按提交 ID 打开当次作文，保留原有段落。
export function WritingRecordDetail() {
  const { id } = useParams();
  const query = useWritingSubmissions();
  const submission = query.data?.find((document) => document.id === id)?.value;
  if (query.error) return <p className="notice danger" role="alert">{errorText(query.error)} <Link to="/records">返回练习记录</Link></p>;
  if (!submission) return <p className="notice">{query.isLoading ? "正在读取…" : "该记录不可用。"} <Link to="/records">返回练习记录</Link></p>;
  return <>
    <div className="page-heading"><div>
      <Link className="back-link" to="/records"><ArrowLeft size={16} />练习记录</Link>
      <h1>{submission.title}</h1>
      <p>写作 · Task {submission.task} · {dateText(submission.submittedAt)}</p>
    </div><button type="button" className="button secondary"
      onClick={() => downloadFile("ietls4pass-record.md", recordsMarkdown([writingRecord(submission)]), "text/markdown;charset=utf-8")}>
      <Download size={16} />导出 Markdown</button></div>
    <section className="card">
      <h2>已提交作文</h2>
      <p className="writing-plain-text" lang="en">{submission.answer}</p>
    </section>
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
    <RecordAnswers record={record} />
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
