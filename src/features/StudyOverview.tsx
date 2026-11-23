// 2026-11-23：总览展示四科已提交次数、学习活动和题库完成进度。
import { useQuery } from "@tanstack/react-query";
import { Award, BookOpen, ClipboardList, Headphones, LayoutDashboard, Mic, NotebookPen } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { listeningRows, type ListeningDocument } from "../domain/listening";
import { submissions } from "../domain/records";
import { mergeSpeakingTopics, speakingTopicId } from "../domain/speaking";
import type { SpeakingSession } from "../domain/speakingPractice";
import { writingQuestionKey } from "../domain/writing";
import { MAIN_BANK, importedEntries, readingRecordsFor, useBankIndex, useCustomBanks, useSelectedReadingBank } from "../services/banks";
import { desktop, desktopAvailable, documentsKey, errorText, recordsKey } from "../services/desktop";
import { useFolderBankSync } from "../services/folderBanks";
import { useWritingCatalog, useWritingSubmissions } from "../services/writingBank";
import { useSpeakingCatalog } from "./SpeakingBank";
// 2026-11-23：总览继续提供四科提交日期，活动卡独立处理日期范围和排版。
import { LearningActivity } from "./LearningActivity";

export function StudyViews() {
  return <>
    <nav className="study-view-tabs" aria-label="总览视图">
      <NavLink to="/" end><LayoutDashboard size={16} aria-hidden="true" />总览</NavLink>
      <NavLink to="/records"><ClipboardList size={16} aria-hidden="true" />练习记录</NavLink>
      <NavLink to="/achievements" end><Award size={16} aria-hidden="true" />学习成就</NavLink>
    </nav>
    <Outlet />
  </>;
}

export function Overview() {
  const enabled = desktopAvailable();
  const history = useQuery({ queryKey: recordsKey, queryFn: desktop.records, enabled });
  const listeningCatalog = useQuery({ queryKey: documentsKey("listening"), queryFn: () => desktop.documents<ListeningDocument>("listening"), enabled });
  const speakingSessions = useQuery({ queryKey: documentsKey("speaking-sessions"), queryFn: () => desktop.documents<SpeakingSession>("speaking-sessions"), enabled });
  const writingSubmissions = useWritingSubmissions();
  const speakingCatalog = useSpeakingCatalog();
  const writingCatalog = useWritingCatalog(true);
  const readingIndex = useBankIndex();
  const readingBanks = useCustomBanks();
  const selectedReadingBank = useSelectedReadingBank();
  const readingBank = readingBanks.data?.find(({ id }) => id === selectedReadingBank.data);
  const listeningSync = useFolderBankSync("listening");
  const readingSync = useFolderBankSync("reading", Boolean(readingBank));

  // 2026-11-23：只统计正式提交，口语按有回答的已结束会话计一次。
  const records = submissions(history.data ?? []);
  const listening = records.filter((record) => record.kind === "listening");
  const reading = records.filter((record) => record.kind === "reading");
  const speaking = (speakingSessions.data ?? []).map(({ value }) => value)
    .filter((session) => session.phase === "finished" && session.messages.some((message) => message.role === "user"));
  const writing = (writingSubmissions.data ?? []).map(({ value }) => value);

  // 2026-11-23：按可作答题库去重，换来源后仍匹配同一个剑雅 Section。
  const listeningByExam = new Set(listening.map((record) => record.examId));
  const listeningBySource = new Set(listening.map((record) => JSON.stringify([record.bankId, record.examId])));
  const listeningItems = new Set<string>();
  const completedListening = new Set<string>();
  for (const row of listeningRows(listeningCatalog.data ?? [])) {
    if (!row.potentialPractice) continue;
    const cambridge = row.book !== undefined;
    const id = cambridge ? row.examId : row.id;
    listeningItems.add(id);
    if ((cambridge && listeningByExam.has(row.examId))
      || listeningBySource.has(JSON.stringify([row.bankId, row.examId]))
      || (row.legacyExamId && listeningBySource.has(JSON.stringify([row.bankId, row.legacyExamId])))) {
      completedListening.add(id);
    }
  }

  // 2026-11-23：口语按话题、写作按 Task 和题号，阅读按当前题库的可作答篇目统计。
  const speakingItems = mergeSpeakingTopics((speakingCatalog.data ?? []).map((folder) => folder.topics));
  const completedSpeaking = new Set(speaking.map((session) => session.topicId));
  const writingItems = new Set((writingCatalog.data ?? []).flatMap((folder) => folder.questions)
    .map((question) => writingQuestionKey(question.task, question.id)));
  const completedWriting = new Set(writing.map((record) => writingQuestionKey(record.task, record.questionId)));
  const readingEntries = readingBank ? importedEntries(readingBank.value) : readingIndex.data?.entries ?? [];
  const readingPdfs = new Set(readingBank?.value.catalog?.entries.filter((entry) => entry.kind === "pdf").map((entry) => entry.examId));
  const readingItems = new Set(readingEntries.filter((entry) => !readingPdfs.has(entry.examId)).map((entry) => entry.examId));
  const completedReading = readingRecordsFor(readingBank?.id ?? MAIN_BANK, reading, readingIndex.data, readingBanks.data ?? []);

  const recordsError = history.error || speakingSessions.error || writingSubmissions.error;
  const progress = [
    { label: "听力", icon: Headphones, count: history.data ? listening.length : null, unit: "节", total: listeningItems.size, completed: completedListening.size,
      pendingCount: history.isLoading, pending: listeningCatalog.isLoading || listeningSync.isLoading, error: history.error || listeningCatalog.error || listeningSync.error || listeningSync.data?.[0] },
    { label: "口语", icon: Mic, count: speakingSessions.data ? speaking.length : null, unit: "个话题", total: speakingItems.length,
      completed: speakingItems.filter((topic) => completedSpeaking.has(speakingTopicId(topic))).length,
      pendingCount: speakingSessions.isLoading, pending: speakingCatalog.isLoading, error: speakingSessions.error || speakingCatalog.error || (!speakingItems.length && speakingCatalog.data?.flatMap((folder) => folder.problems)[0]) },
    { label: "写作", icon: NotebookPen, count: writingSubmissions.data ? writing.length : null, unit: "道题", total: writingItems.size,
      completed: [...writingItems].filter((id) => completedWriting.has(id)).length,
      pendingCount: writingSubmissions.isLoading, pending: writingCatalog.isLoading, error: writingSubmissions.error || writingCatalog.error || (!writingItems.size && writingCatalog.data?.flatMap((folder) => folder.problems)[0]) },
    { label: "阅读", icon: BookOpen, count: history.data ? reading.length : null, unit: "篇", total: readingItems.size,
      completed: [...readingItems].filter((id) => completedReading.has(id)).length,
      pendingCount: history.isLoading, pending: selectedReadingBank.isLoading || readingBanks.isLoading || (readingBank ? readingSync.isLoading : readingIndex.isLoading),
      error: history.error || selectedReadingBank.error || readingBanks.error || (readingBank ? readingSync.error || readingSync.data?.[0] : readingIndex.error) },
  ];

  return <div className="study-overview">
    {recordsError && <p className="notice danger" role="alert">{errorText(recordsError)}</p>}
    <div className="metrics" aria-label="各科提交次数">
      {progress.map(({ label, icon: Icon, count }) => <div className="metric" key={label}>
        <Icon size={20} aria-hidden="true" /><span>{label}提交</span><strong>{count ?? "—"}{count !== null && <small> 次</small>}</strong>
      </div>)}
    </div>
    <LearningActivity submittedDates={[
      ...records.map((record) => record.submittedAt),
      ...speaking.map((record) => record.updatedAt),
      ...writing.map((record) => record.submittedAt),
    ]} />
    <section className="card">
      <h2>练习进度</h2>
      <div className="study-progress-grid">
        {progress.map(({ label, unit, total, completed, pending, pendingCount, error }) => <div key={label} className="study-progress-item">
          <h3>{label}</h3>
          {error ? <p className="muted" role="status">{errorText(error)}</p> : pending || pendingCount
            ? <p className="muted">正在读取…</p>
            : <>
              <span className="study-progress-count">{completed} / {total} <small>{unit}</small></span>
              <progress aria-label={`${label}已完成题库进度`} max={total || 1} value={completed} />
            </>}
        </div>)}
      </div>
    </section>
  </div>;
}
