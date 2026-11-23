// 2026-11-19：从正式成绩或已提交的套题子篇回放作答，单独保存批注并提交复习反馈。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { dateText, submissions } from "../../domain/records";
import { planForFeedback, reviewPlanId } from "../../domain/readingReview";
import type { ReviewPlan, ReviewQuality } from "../../domain/readingReview";
import { scoreReading } from "../../domain/scoring";
import type { PracticeRecord, ReadingAnnotations, ReadingAsset, SuiteDraft } from "../../domain/types";
import { MAIN_BANK, mainMedia } from "../../services/banks";
import { desktop, desktopAvailable, documentsKey, errorText, recordsKey } from "../../services/desktop";
import { AnswerReview } from "./AnswerReview";
import { emptyAnnotations, ReadingNotes } from "./ReadingNotes";
import { ReadingPaper } from "./ReadingPaper";
// 2026-11-19：回放及背题保留相同的阅读词典入口。
import { ReadingDictionary } from "./ReadingDictionary";
import { selectedHighlight } from "./passageHighlights";
import { showReadingLocation } from "./readingHtml";

// 2026-11-19：目录题库回放使用原目录题图。
// 2026-11-20：旧套题成绩作为单篇只读回放，复用原记录和批注。
export function ReadingReplay({ asset, bankId, recordId, media }: {
  asset: ReadingAsset; bankId: string; recordId?: string; media?: (key: string) => string | undefined;
}) {
  const enabled = desktopAvailable() && Boolean(recordId);
  const records = useQuery({ queryKey: recordsKey, queryFn: desktop.records, enabled });
  // 2026-11-20：从旧套题文档中只读取已提交的子篇，兼容未导入正式历史的回放链接。
  const suites = useQuery({ queryKey: documentsKey("suites"), queryFn: () => desktop.documents<SuiteDraft>("suites"), enabled });
  const plans = useQuery({ queryKey: documentsKey("review-plans"), queryFn: () => desktop.documents<ReviewPlan>("review-plans"), enabled });
  const notes = useQuery({ queryKey: documentsKey("annotations"), queryFn: () => desktop.documents<ReadingAnnotations>("annotations"), enabled });
  const history = [...submissions(records.data ?? []), ...(suites.data ?? []).flatMap(({ value }) => value.completed)];
  const record = history.find((item) => item.id === recordId && item.examId === asset.exam.examId && item.bankId === bankId);
  const plan = plans.data?.find(({ id }) => id === reviewPlanId(bankId, asset.exam.examId))?.value;
  const initial = notes.data?.find(({ id }) => id === recordId)?.value ?? record?.annotations ?? emptyAnnotations;
  const error = records.error || suites.error || plans.error || notes.error;
  if (recordId && error) return <p className="notice danger" role="alert">{errorText(error)}</p>;
  if (recordId && (records.isLoading || suites.isLoading || plans.isLoading || notes.isLoading)) return <p className="muted">正在读取回放…</p>;
  // 2026-11-21：失效回放的返回入口使用新模块名。
  if (recordId && !record) return <p className="notice">此回放记录已失效或来源与题目不一致。<Link to="/library">返回阅读练习</Link></p>;
  return <ReadOnlyPaper asset={asset} bankId={bankId} record={record} initial={initial}
    plan={plan?.recordId === record?.id ? plan : undefined} mediaUrl={media} />;
}

function ReadOnlyPaper({ asset, bankId, record, initial, plan, mediaUrl }: {
  asset: ReadingAsset; bankId: string; record?: PracticeRecord; initial: ReadingAnnotations; plan?: ReviewPlan;
  mediaUrl?: (key: string) => string | undefined;
}) {
  const cache = useQueryClient();
  const { exam, explanation } = asset;
  const [annotations, setAnnotations] = useState(initial);
  const [active, setActive] = useState("");
  const [error, setError] = useState("");
  const [attemptId] = useState(() => crypto.randomUUID());
  const [openedPlan] = useState(() => plan);
  const root = useRef<HTMLElement>(null);
  const media = useCallback((file: string) => bankId === MAIN_BANK ? mainMedia(file) : undefined, [bankId]);
  const feedback = useMutation({
    mutationFn: async (quality: ReviewQuality) => {
      if (!openedPlan) return;
      const change = planForFeedback(openedPlan, quality, attemptId);
      await desktop.applyReviewFeedback(change);
      return change.value;
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: documentsKey("review-plans") }),
  });
  const saveNotes = useMutation({
    mutationFn: async () => { if (record) await desktop.put("annotations", record.id, annotations); },
    onSuccess: () => cache.invalidateQueries({ queryKey: documentsKey("annotations") }),
  });
  const details = record?.details ?? scoreReading(exam, {});
  const answers = record?.answers ?? Object.fromEntries((record?.details ?? []).map(({ questionId, userAnswer }) => [questionId, userAnswer]));
  const stalePlan = openedPlan && plan?.revision !== openedPlan.revision;
  // 2026-11-19：再次修改批注时清除上一版的已保存提示。
  function editAnnotations(edit: (current: ReadingAnnotations) => ReadingAnnotations) {
    saveNotes.reset();
    setAnnotations(edit);
  }
  function navigateQuestion(id: string, note?: string) {
    setActive(id);
    if (root.current) showReadingLocation(root.current, id, note);
  }

  return <section className="practice" ref={root}>
    {/* 2026-11-21：从阅读回放返回阅读练习列表。 */}
    <div className="page-heading"><div><Link className="back-link" to="/library">返回阅读练习</Link>
      <h1>{exam.meta.title}</h1><p>{record ? `作答回放 · ${dateText(record.submittedAt)}` : "背题与解析"}</p>
    </div></div>
    {(error || feedback.error || saveNotes.error) && <p className="notice danger" role="alert">{error || errorText(feedback.error || saveNotes.error)}</p>}
    <nav className="question-navigation" aria-label="题目定位">
      {exam.questionOrder.map((id) => <button key={id} type="button" className={annotations.markedQuestions.includes(id) ? "marked" : ""}
        aria-current={active === id ? "true" : undefined} onClick={() => navigateQuestion(id)}>{exam.questionDisplayMap?.[id] ?? id.slice(1)}</button>)}
    </nav>
    {record && <div className="table-actions reading-annotation-actions">
      <button className="button secondary" type="button" disabled={!active || saveNotes.isPending} onClick={() => editAnnotations((current) => ({
        ...current, markedQuestions: current.markedQuestions.includes(active)
          ? current.markedQuestions.filter((id) => id !== active) : [...current.markedQuestions, active],
      }))}>标记／取消当前题</button>
      <button className="button secondary" type="button" disabled={saveNotes.isPending} onPointerDown={(event) => event.preventDefault()} onClick={() => {
        const highlight = root.current && selectedHighlight(root.current);
        if (!highlight) { setError("请选择同一原文块中的文字。"); return; }
        setError("");
        editAnnotations((current) => current.highlights.some((item) => item.blockId === highlight.blockId && item.start === highlight.start && item.end === highlight.end)
          ? current : { ...current, highlights: [...current.highlights, highlight] });
      }}>高亮所选原文</button>
    </div>}
    <ReadingPaper exam={exam} answers={answers} disabled mediaUrl={mediaUrl ?? media} highlights={annotations.highlights} onChange={() => {}} onCoverage={() => {}} />
    <ReadingDictionary root={root} bankId={bankId} examId={exam.examId} title={exam.meta.title} />
    {record && <ReadingNotes value={annotations} disabled={saveNotes.isPending}
      onNotes={(notes) => editAnnotations((current) => ({ ...current, notes }))}
      onClearHighlight={(i) => editAnnotations((current) => ({ ...current, highlights: current.highlights.filter((_, index) => index !== i) }))}
      onSave={() => saveNotes.mutate()} />}
    {saveNotes.isSuccess && <p className="notice" role="status">回放批注已保存。</p>}
    <AnswerReview details={details} explanation={explanation} onLocate={navigateQuestion} study={!record} />
    {openedPlan && <div className="card reading-measurement">
      <h2>复习反馈</h2>
      {feedback.data ? <p role="status">下一次复习 {dateText(feedback.data.nextReview)}</p>
        : stalePlan ? <p>复习计划已变化，请从题库重新打开回放。</p>
        : <div className="table-actions">{([["hard", "困难"], ["good", "一般"], ["easy", "简单"]] as const).map(([quality, label]) =>
          <button className="button secondary" key={quality} type="button" disabled={feedback.isPending} onClick={() => feedback.mutate(quality)}>{label}</button>)}</div>}
    </div>}
  </section>;
}
