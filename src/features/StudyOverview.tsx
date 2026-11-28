// 2026-11-23：总览展示四科已提交次数、学习活动和题库完成进度。
import { useQuery } from "@tanstack/react-query";
// 2026-11-27：学习成就随总览展示，并从旧链接读取展开状态。
import { BookOpen, ClipboardList, Headphones, LayoutDashboard, Mic, NotebookPen } from "lucide-react";
import { NavLink, Outlet, useSearchParams } from "react-router-dom";
import { listeningRows, type ListeningDocument } from "../domain/listening";
import { mergeSpeakingTopics, speakingTopicId } from "../domain/speaking";
// 2026-11-27：总览和练习记录复用同一口语提交条件。
import { isSubmittedSpeakingSession } from "../domain/speakingPractice";
import type { SpeakingSession } from "../domain/speakingPractice";
import { writingQuestionKey } from "../domain/writing";
import { MAIN_BANK, importedEntries, readingRecordsFor, useBankIndex, useCustomBanks, useSelectedReadingBank } from "../services/banks";
import { desktop, desktopAvailable, documentsKey, errorText, recordsKey } from "../services/desktop";
import { useFolderBankSync } from "../services/folderBanks";
import { useWritingCatalog, useWritingSubmissions } from "../services/writingBank";
import { useSpeakingCatalog } from "./SpeakingBank";
// 2026-11-23：总览继续提供四科提交日期，活动卡独立处理日期范围和排版。
import { LearningActivity } from "./LearningActivity";
// 2026-11-27：学习成就置于总览最底部。
import { Achievements } from "./Achievements";

export function StudyViews() {
  return <>
    <nav className="study-view-tabs" aria-label="总览视图">
      <NavLink to="/" end><LayoutDashboard size={16} aria-hidden="true" />总览</NavLink>
      <NavLink to="/records"><ClipboardList size={16} aria-hidden="true" />练习记录</NavLink>
    </nav>
    <Outlet />
  </>;
}

export function Overview() {
  // 2026-11-27：保留旧成就及统计链接可直接定位的行为。
  const [search] = useSearchParams();
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
  const records = history.data ?? [];
  const listening = records.filter((record) => record.kind === "listening");
  const reading = records.filter((record) => record.kind === "reading");
  const speaking = (speakingSessions.data ?? []).map(({ value }) => value)
    .filter(isSubmittedSpeakingSession);
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
  // 2026-11-27：提交次数和题库进度共用单行卡片，进度只展示完成数和总数。
  const progress = [
    { label: "听力", icon: Headphones, count: history.data ? listening.length : null, total: listeningItems.size, completed: completedListening.size,
      pendingCount: history.isLoading, pending: listeningCatalog.isLoading || listeningSync.isLoading, error: history.error || listeningCatalog.error || listeningSync.error || listeningSync.data?.[0] },
    { label: "口语", icon: Mic, count: speakingSessions.data ? speaking.length : null, total: speakingItems.length,
      completed: speakingItems.filter((topic) => completedSpeaking.has(speakingTopicId(topic))).length,
      pendingCount: speakingSessions.isLoading, pending: speakingCatalog.isLoading, error: speakingSessions.error || speakingCatalog.error || (!speakingItems.length && speakingCatalog.data?.flatMap((folder) => folder.problems)[0]) },
    { label: "写作", icon: NotebookPen, count: writingSubmissions.data ? writing.length : null, total: writingItems.size,
      completed: [...writingItems].filter((id) => completedWriting.has(id)).length,
      pendingCount: writingSubmissions.isLoading, pending: writingCatalog.isLoading, error: writingSubmissions.error || writingCatalog.error || (!writingItems.size && writingCatalog.data?.flatMap((folder) => folder.problems)[0]) },
    { label: "阅读", icon: BookOpen, count: history.data ? reading.length : null, total: readingItems.size,
      completed: [...readingItems].filter((id) => completedReading.has(id)).length,
      pendingCount: history.isLoading, pending: selectedReadingBank.isLoading || readingBanks.isLoading || (readingBank ? readingSync.isLoading : readingIndex.isLoading),
      error: history.error || selectedReadingBank.error || readingBanks.error || (readingBank ? readingSync.error || readingSync.data?.[0] : readingIndex.error) },
  ];

  return <div className="study-overview">
    {recordsError && <p className="notice danger" role="alert">{errorText(recordsError)}</p>}
    {/* 2026-11-27：两排指标都在学习活动前面，标题和数值保持同一行。 */}
    <div className="metrics" role="group" aria-label="各科提交次数">
      {progress.map(({ label, icon: Icon, count }) => <div className="metric" key={label}>
        <Icon size={18} aria-hidden="true" /><span>{label}提交</span><strong>{count ?? "—"}{count !== null && <small> 次</small>}</strong>
      </div>)}
    </div>
    <div className="metrics" role="group" aria-label="各科练习进度">
      {progress.map(({ label, icon: Icon, completed, total, pendingCount, pending, error }) => <div className="metric" key={label}>
        <Icon size={18} aria-hidden="true" /><span>{label}进度</span>
        {error ? <span className="metric-status" role="status" title={errorText(error)}>读取失败</span>
          : pending || pendingCount ? <span className="metric-status" role="status">读取中…</span>
          : <strong>{completed}/{total}</strong>}
      </div>)}
    </div>
    <LearningActivity submittedDates={[
      ...records.map((record) => record.submittedAt),
      ...speaking.map((record) => record.updatedAt),
      ...writing.map((record) => record.submittedAt),
    ]} />
    {/* 2026-11-27：预留四科练习经验汇总入口，后续在此接入练习总结。 */}
    <details className="card study-experience">
      <summary>练习经验</summary>
      <p className="muted">暂无练习经验。</p>
    </details>
    {/* 2026-11-27：成就卡在练习经验之后，默认折叠。 */}
    <Achievements reveal={search.get("section") === "achievements"} />
  </div>;
}
