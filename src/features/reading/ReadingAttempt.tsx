// 2026-11-28：连接单篇阅读作答、草稿自动保存和成绩提交。
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Clock3, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { planForCompletion, reviewPlanId } from "../../domain/readingReview";
import type { ReviewPlan } from "../../domain/readingReview";
import { initializeReadingTiming } from "../../domain/readingTiming";
import { answeredReadingQuestions, scoreReading, SCORING_VERSION } from "../../domain/scoring";
import type { Answers, PracticeDraft, PracticeRecord, ReadingAnnotations, ReadingAsset } from "../../domain/types";
import { MAIN_BANK, mainMedia } from "../../services/banks";
import { desktop, documentsKey, errorText, recordsKey } from "../../services/desktop";
import { AnswerReview } from "./AnswerReview";
import { emptyAnnotations, ReadingNotes } from "./ReadingNotes";
import { ReadingPaper } from "./ReadingPaper";
// 2026-11-19：阅读作答可查阅并收藏 ECDICT 词条。
import { ReadingDictionary } from "./ReadingDictionary";
import { ReadingTimingPanel } from "./ReadingTimingPanel";
// 2026-11-23：作答时支持直接清除所选原文范围的高亮。
import { removeHighlightRange, selectedHighlight } from "./passageHighlights";
import { showReadingLocation } from "./readingHtml";
import { useDraftWriter } from "./useDraftWriter";
import { formatClock, usePracticeClock } from "./usePracticeClock";
import { useReadingTiming } from "./useReadingTiming";

// 2026-11-20：单篇阅读使用自己的作答计时和暂停状态。
export function ReadingAttempt({ asset, draftId, initial, recovered, writerId, mediaUrl }: {
  asset: ReadingAsset; draftId: string; initial: PracticeDraft; recovered: boolean; writerId?: string;
  mediaUrl?: (key: string) => string | undefined;
}) {
  const { exam, explanation } = asset;
  const cache = useQueryClient();
  const [answers, setAnswers] = useState(initial.answers);
  const [annotations, setAnnotations] = useState<ReadingAnnotations>(initial.annotations ?? emptyAnnotations);
  const [paused, setPaused] = useState(Boolean(initial.paused));
  const [frozen, setFrozen] = useState<PracticeRecord | undefined>(initial.pendingResult);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PracticeRecord>();
  const [coverage, setCoverage] = useState<{ missing: string[]; timingMissing: string[] }>();
  const [error, setError] = useState("");
  const [activeQuestion, setActiveQuestion] = useState<string>();
  const root = useRef<HTMLElement>(null);
  const busy = useRef(false);
  const ended = useRef(false);
  const autoSave = useRef<() => void>(() => {});
  const latest = useRef({ answers, annotations, paused, frozen });
  latest.current = { answers, annotations, paused, frozen };
  const writer = useDraftWriter(draftId, writerId);
  const running = Boolean(coverage) && !paused && !pending && !frozen && !result && writer.owned.current;
  const clock = usePracticeClock(initial.elapsedMs, running);
  const timingSeed = useMemo(() => writerId && coverage
    ? initializeReadingTiming(exam, initial, coverage.timingMissing, recovered) : undefined, [coverage, exam, initial, recovered, writerId]);
  const timing = useReadingTiming(timingSeed, running, () => autoSave.current());
  // 2026-11-19：周期写入只覆盖正在计时的答题，暂停和失焦由边界保存。
  const timingActive = useRef(false);
  timingActive.current = timing.accruing;
  const elapsed = clock.elapsed;
  const timingSnapshot = timing.snapshot;
  const media = useCallback((file: string) => initial.bankId === MAIN_BANK ? mainMedia(file) : undefined, [initial.bankId]);
  const save = writer.save;
  const snapshot = useCallback((record?: PracticeRecord): PracticeDraft => ({
    ...initial, answers: latest.current.answers, annotations: latest.current.annotations,
    paused: latest.current.paused, updatedAt: new Date().toISOString(),
    elapsedMs: record ? record.elapsedMs ?? 0 : elapsed(),
    readingTiming: record ? record.readingTiming : timingSnapshot(), pendingResult: record,
  }), [elapsed, initial, timingSnapshot]);

  const flush = useCallback(() => {
    if (writerId && !busy.current && !ended.current && writer.owned.current) {
      void save(snapshot(latest.current.frozen)).catch(() => {});
    }
  }, [save, snapshot, writer.owned, writerId]);
  autoSave.current = flush;
  useEffect(() => {
    if (!writerId) return;
    const interval = window.setInterval(() => { if (timingActive.current) flush(); }, 4_500);
    return () => {
      window.clearInterval(interval);
      flush();
    };
  }, [flush, writerId]);
  useEffect(() => {
    if (!writerId) return;
    const timeout = window.setTimeout(flush, 300);
    return () => window.clearTimeout(timeout);
  }, [annotations, answers, flush, paused, writerId]);

  function select(ids: string[]) {
    if (ids[0]) setActiveQuestion(ids[0]);
    timing.select(ids);
  }

  function markQuestion() {
    if (!activeQuestion) return;
    setAnnotations((previous) => ({
      ...previous, markedQuestions: previous.markedQuestions.includes(activeQuestion)
        ? previous.markedQuestions.filter((id) => id !== activeQuestion)
        : [...previous.markedQuestions, activeQuestion],
    }));
  }

  function highlightSelection() {
    const highlight = root.current && selectedHighlight(root.current);
    if (!highlight) { setError("请先选中同一原文块的一段文字。"); return; }
    setError("");
    setAnnotations((previous) => previous.highlights.some((item) => item.blockId === highlight.blockId && item.start === highlight.start && item.end === highlight.end)
      ? previous : { ...previous, highlights: [...previous.highlights, highlight] });
  }

  // 2026-11-23：沿用原文选区和批注状态，取消操作随草稿自动保存。
  function clearHighlightSelection() {
    const selection = root.current && selectedHighlight(root.current);
    if (!selection) { setError("请先选中同一原文块中要取消高亮的文字。"); return; }
    setError("");
    setAnnotations((previous) => {
      const highlights = removeHighlightRange(previous.highlights, selection);
      return highlights === previous.highlights ? previous : { ...previous, highlights };
    });
    window.getSelection()?.removeAllRanges();
  }

  async function refresh() {
    // 2026-11-28：提交后刷新单篇草稿、复习计划和成绩。
    await Promise.all((["drafts", "review-plans"] as const).map((category) =>
      cache.invalidateQueries({ queryKey: documentsKey(category) })).concat(cache.invalidateQueries({ queryKey: recordsKey })));
  }

  async function submit() {
    if (busy.current || ended.current || !coverage || coverage.missing.length || !writer.owned.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    let record = latest.current.frozen;
    if (!record) {
      const readingTiming = timingSnapshot(true);
      const elapsedMs = elapsed();
      const details = scoreReading(exam, latest.current.answers);
      record = {
        id: initial.id, kind: "reading", title: exam.meta.title, examId: initial.examId, bankId: initial.bankId,
        category: exam.meta.category, startedAt: initial.startedAt, submittedAt: new Date().toISOString(),
        elapsedMs, readingTiming, source: "desktop",
        answers: latest.current.answers, annotations: latest.current.annotations, details,
        points: details.reduce((sum, detail) => sum + detail.points, 0),
        possible: details.reduce((sum, detail) => sum + detail.possible, 0),
        raw: { scoringVersion: SCORING_VERSION },
      };
    }
    latest.current.frozen = record;
    setFrozen(record);
    try {
      const revision = await save(snapshot(record));
      if (!writerId) {
        ended.current = true;
        setResult(record);
        return;
      }
      const id = reviewPlanId(initial.bankId, initial.examId);
      const prior = (await desktop.documents<ReviewPlan>("review-plans")).find((entry) => entry.id === id)?.value;
      const review = planForCompletion(record, prior);
      // 2026-11-20：冻结快照提交为单篇成绩。
      const saved = await desktop.saveRecord(record, draftId, revision, review);
      ended.current = true;
      setResult(saved);
      await refresh();
    } catch (reason) { setError(errorText(reason)); }
    finally {
      busy.current = false;
      setPending(false);
    }
  }

  function resumeAnswering() {
    latest.current.frozen = undefined;
    setFrozen(undefined);
    setError("");
    flush();
  }

  // 2026-11-20：暂停和继续只影响当前篇的计时。
  function togglePause() {
    if (busy.current || ended.current) return;
    const next = !paused;
    latest.current.paused = next;
    setPaused(next);
  }

  const answered = answeredReadingQuestions(exam, answers);
  const editable = !paused && !pending && !frozen && !result;

  // 2026-11-21：阅读作答的原文和题目随正文高度伸缩，交卷后恢复常规纵向布局。
  // 2026-11-21：作答页头按正文宽度安排返回、进度和计时操作。
  return <section className={result ? "practice reading-attempt" : "practice reading-attempt exercise-page"} ref={root}>
    {/* 2026-11-21：篇名在原文中展示，答题工具栏只保留返回、进度与操作。 */}
    <div className="reading-attempt-toolbar">
      <div>
        {/* 2026-11-20：单篇从原题库入口返回。 */}
        {/* 2026-11-28：返回链接使用侧栏的阅读题库名称。 */}
        <Link to="/library" className="back-link"><ArrowLeft size={16} />返回阅读题库</Link>
      </div>
      {/* 2026-11-21：将作答数和可定位的题号放在工具栏中间。 */}
      {!result && <nav className="question-navigation" aria-label="答题进度">
        <span>{answered.size} / {exam.questionOrder.length} 题已作答</span>
        {exam.questionOrder.map((id) => <button key={id} type="button"
          className={`${answered.has(id) ? "answered" : ""} ${annotations.markedQuestions.includes(id) ? "marked" : ""}`}
          aria-current={activeQuestion === id ? "true" : undefined} onClick={() => {
            select([id]); if (root.current) showReadingLocation(root.current, id);
          }}>{exam.questionDisplayMap?.[id] ?? id.slice(1)}</button>)}
      </nav>}
      <div className="practice-actions">
        <span className="time" title="本篇前台有效练习用时"><Clock3 size={17} />{formatClock(clock.elapsedMs)}</span>
        {!result && !frozen && <button type="button" className="button secondary" disabled={pending} onClick={() => void togglePause()}>
          {paused ? <Play size={16} /> : <Pause size={16} />}{paused ? "继续" : "暂停"}</button>}
        {!result && <button type="button" className="button primary" disabled={pending || !coverage || coverage.missing.length > 0 || (paused && !frozen) || !writer.owned.current}
          onClick={() => void submit()}><Check size={17} />{pending ? "正在保存…" : frozen ? "重试提交" : writerId ? "提交练习" : "评分预览"}</button>}
      </div>
    </div>
    {error && <p className="notice danger" role="alert">{error}</p>}
    {writer.failure && <p className="notice danger" role="alert">草稿保存失败。{writer.failure}</p>}
    {frozen && !result && !pending && <div className="notice">已冻结本次作答和计时。<button className="text-button" type="button" onClick={resumeAnswering}>返回作答</button></div>}
    {/* 2026-11-21：隐藏前台计时归属和最近保存提示，作答计时与草稿照常记录。 */}
    {!!coverage?.missing.length && <p className="notice" role="status">此篇有 {coverage.missing.length} 题缺少可作答控件。</p>}
    <div className="table-actions reading-annotation-actions">
      <button type="button" className="button secondary" disabled={!editable || !activeQuestion}
        aria-pressed={Boolean(activeQuestion && annotations.markedQuestions.includes(activeQuestion))} onClick={markQuestion}>标记／取消当前题</button>
      <button type="button" className="button secondary" disabled={!editable} onPointerDown={(event) => event.preventDefault()} onClick={highlightSelection}>高亮所选原文</button>
      {/* 2026-11-23：在同一行取消高亮，按下按钮时保留原文选区。 */}
      <button type="button" className="button secondary" disabled={!editable || !annotations.highlights.length}
        onPointerDown={(event) => event.preventDefault()} onClick={clearHighlightSelection}>取消所选高亮</button>
    </div>
    <ReadingPaper exam={exam} answers={answers} mediaUrl={mediaUrl ?? media} disabled={!editable} highlights={annotations.highlights}
      onChange={(changes: Answers) => setAnswers((current) => ({ ...current, ...changes }))}
      onSelection={select} onCoverage={(missing, timingMissing) => setCoverage({ missing, timingMissing })} />
    <ReadingDictionary root={root} bankId={initial.bankId} examId={exam.examId} title={exam.meta.title} />
    <ReadingNotes value={annotations} disabled={!editable} onUnallocate={() => timing.select([])}
      onNotes={(notes) => setAnnotations((current) => ({ ...current, notes }))}
      onClearHighlight={(index) => setAnnotations((current) => ({ ...current, highlights: current.highlights.filter((_, i) => i !== index) }))} />
    {result && <>
      <div className="result-summary" role="status"><b>{result.points} / {result.possible} 分</b>
        <span>{writerId ? "已保存到本机练习记录" : "浏览器评分预览"}</span>
        {writerId && <Link to={`/records/${result.id}`}>查看记录</Link>}
      </div>
      {writerId && <ReadingTimingPanel record={result} />}
      <AnswerReview details={result.details ?? []} explanation={explanation} onLocate={(id, note) => {
        if (root.current) showReadingLocation(root.current, id, note);
      }} />
    </>}
  </section>;
}
