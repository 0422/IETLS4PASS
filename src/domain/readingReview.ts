// 2026-11-19：按上游文章级 SM-2 规则安排阅读复习，评分及反馈用独立标识去重。
import type { PracticeRecord } from "./types";

export type ReviewQuality = "hard" | "good" | "easy";
const qualities = { hard: 2, good: 4, easy: 5 } as const;

export interface ReviewPlan {
  revision: number;
  examId: string;
  bankId: string;
  recordId: string;
  title: string;
  latestCompletedAt: string;
  easeFactor: number;
  interval: number;
  repetitions: number;
  reviewCount: number;
  lapseCount: number;
  nextReview: string;
  lastReviewed: string;
  // 2026-11-19：兼容原版尚未发生首次复习的计划。
  lastQuality: ReviewQuality | null;
  lastReviewAttemptId: string;
  appliedReviewAttemptIds: string[];
}

export interface ReviewPlanChange {
  id: string;
  expectedRevision: number;
  value: ReviewPlan;
}

export const reviewPlanId = (bankId: string, examId: string) => JSON.stringify([bankId, examId]);

function outcome(
  current: ReviewPlan | undefined, quality: ReviewQuality, at: Date, attempt: string,
) {
  const q = qualities[quality];
  const currentRepetitions = current?.repetitions ?? 0;
  const easeFactor = Math.min(3, Math.max(1.3, (current?.easeFactor ?? 2.5) + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  let repetitions = currentRepetitions + 1;
  let interval: number;
  if (quality === "hard") {
    repetitions = 0;
    interval = 1;
  } else if (quality === "easy" && currentRepetitions === 0) {
    repetitions = 2;
    interval = 6;
  } else if (currentRepetitions < 2) interval = currentRepetitions === 0 ? 1 : 6;
  else interval = Math.max(1, Math.round((current?.interval ?? 1) * easeFactor));
  const next = new Date(at);
  next.setDate(next.getDate() + interval);
  return {
    easeFactor, interval, repetitions, reviewCount: (current?.reviewCount ?? 0) + 1,
    lapseCount: (current?.lapseCount ?? 0) + Number(quality === "hard"),
    nextReview: next.toISOString(), lastReviewed: at.toISOString(), lastQuality: quality,
    lastReviewAttemptId: attempt, appliedReviewAttemptIds: [...(current?.appliedReviewAttemptIds ?? []), attempt],
  };
}

export function planForCompletion(record: PracticeRecord, previous?: ReviewPlan): ReviewPlanChange | undefined {
  const { points, possible, examId, bankId, submittedAt } = record;
  if (record.kind !== "reading" || record.source !== "desktop" || !examId || !bankId
    || points === null || possible === null || !Number.isFinite(points) || !Number.isFinite(possible)
    || possible <= 0 || points < 0 || points > possible || (!previous && points === possible)
    || previous?.recordId === record.id || (previous && submittedAt < previous.latestCompletedAt)) return undefined;
  const attempt = `completion:${record.id}`;
  const quality: ReviewQuality = points * 100 < possible * 60 ? "hard" : points * 100 <= possible * 80 ? "good" : "easy";
  const expectedRevision = previous?.revision ?? 0;
  const scheduled = previous && previous.lastReviewed > submittedAt
    ? { ...previous, lastReviewAttemptId: attempt, appliedReviewAttemptIds: [...previous.appliedReviewAttemptIds, attempt] }
    : outcome(previous, quality, new Date(submittedAt), attempt);
  return {
    id: reviewPlanId(bankId, examId), expectedRevision,
    value: { ...scheduled, revision: expectedRevision + 1, examId, bankId, recordId: record.id, title: record.title,
      latestCompletedAt: submittedAt },
  };
}

export function planForFeedback(plan: ReviewPlan, quality: ReviewQuality, attempt: string): ReviewPlanChange {
  return {
    id: reviewPlanId(plan.bankId, plan.examId), expectedRevision: plan.revision,
    value: { ...plan, ...outcome(plan, quality, new Date(), attempt), revision: plan.revision + 1 },
  };
}
