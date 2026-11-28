// 2026-11-19：读取上游 v1/v2 的练习记录，保留历史分值、题库身份和原始数据。
// 2026-11-19：把能确认的旧作答、批注和计时转为桌面字段。
import type { Answer, AnswerResult, Answers, PracticeRecord, ReadingAnnotations, ReadingTiming } from "./types";
import { readTiming } from "./readingTiming";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === "string" ? value : "";
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const answer = (value: unknown): Answer =>
  typeof value === "string" ? value : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;

function iso(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : "";
}

function legacyKind(raw: Record<string, unknown>, metadata: Record<string, unknown>, real: Record<string, unknown>) {
  const type = [raw.type, raw.examType, raw.kind, metadata.type, metadata.examType, real.type, real.examType, real.pageType]
    .map(string).join(" ").toLowerCase();
  // 2026-11-28：仅排除旧组合成绩，单篇记录保留原有识别口径。
  if (/suite|套题/.test(type) || [raw, metadata, real].some((item) => item.suiteId != null || item.suitePosition != null) || [
    raw.suiteEntries, raw.children, raw.suiteRecords, raw.subRecords, raw.suiteResults,
    raw.suiteEntrySummaries, real.suiteResults, real.subRecords,
  ].some((value) => Array.isArray(value) && value.length > 0)) return null;
  if (/listen|听力/.test(type)) return "listening";
  if (/read|阅读/.test(type) || /^p[123]-/.test(string(raw.examId))) return "reading";
  return null;
}

// 2026-11-28：转换已有标识的正式单篇成绩，沿用原记录的得分证据。
function normalize(rawValue: unknown): PracticeRecord | null {
  const raw = object(rawValue);
  const real = object(raw.realData);
  const metadata = object(raw.metadata);
  const source = [raw.dataSource, metadata.dataSource, metadata.source, raw.status, real.status].map(string).join(" ");
  if (/demo|sample|preview|draft|interrupted|cancel[l]?ed|synthetic/i.test(source)) return null;
  const sourceId = [raw.id, raw.recordId, raw.sessionId].map(string).find(Boolean);
  if (!sourceId || new TextEncoder().encode(sourceId).length > 233 || /[\x00-\x1f\x7f-\x9f]/.test(sourceId)) return null;
  const id = `legacy:${sourceId}`;
  const kind = legacyKind(raw, metadata, real);
  if (!kind) return null;
  const examId = string(raw.examId) || string(real.examId) || string(metadata.examId);
  const bank = Object.hasOwn(raw, "libraryConfigurationId") ? raw.libraryConfigurationId : metadata.libraryConfigurationId;
  const bankId = legacyBank(bank);
  const evidence = object(raw.readingAnalytics);
  const browse = object(raw.browseScore);
  const submittedAt = [evidence.submittedAt, browse.submittedAt, raw.submittedAt, raw.endTime, real.endTime, raw.completedAt, raw.date, raw.timestamp, raw.createdAt]
    .map(iso).find(Boolean) || "";
  const score = { ...object(real.scoreInfo), ...object(raw.scoreInfo) };
  const earned = numeric(evidence.earned) ?? numeric(browse.earned) ?? numeric(raw.correctAnswers) ?? numeric(score.correct) ?? numeric(score.correctAnswers);
  const total = numeric(evidence.possible) ?? numeric(browse.possible) ?? numeric(score.total) ?? numeric(score.totalQuestions) ?? numeric(raw.totalQuestions);
  const scored = raw.graded !== false && raw.gradable !== false && real.graded !== false && real.gradable !== false
    && earned !== null && total !== null && earned >= 0 && total > 0 && earned <= total;
  const duration = numeric(raw.duration) ?? numeric(real.duration);
  const rawComparison = raw.answerComparison ?? real.answerComparison;
  const comparison = Array.isArray(rawComparison)
    ? rawComparison.map((row, index) => [string(object(row).questionId) || `q${index + 1}`, row] as const)
    : Object.entries(object(rawComparison));
  const details: AnswerResult[] = comparison.flatMap(([questionId, value]) => {
    const row = object(value);
    const possible = numeric(row.weight) ?? (typeof row.isCorrect === "boolean" ? 1 : null);
    const points = numeric(row.partialCorrectCount) ?? (row.isCorrect === true ? possible : row.isCorrect === false ? 0 : null);
    return possible === null || points === null || possible <= 0 || points < 0 || points > possible ? [] : [{
      questionId, label: string(row.questionLabel) || questionId.replace(/^q/i, ""),
      userAnswer: answer(row.userAnswer), correctAnswer: answer(row.correctAnswer),
      type: string(row.questionType) || "other", points, possible,
    }];
  });
  const storedAnswers = legacyAnswers(raw.answers ?? real.answers ?? raw.answerMap);
  return {
    id, kind, title: string(raw.title) || string(raw.examTitle) || string(metadata.examTitle) || examId || "上游练习",
    examId: examId || undefined, bankId, category: string(evidence.category) || string(raw.category) || string(metadata.category), submittedAt,
    startedAt: iso(raw.startTime) || undefined, elapsedMs: duration !== null && duration >= 0 ? Math.round(duration * 1000) : undefined,
    points: scored ? earned : null, possible: scored ? total : null, details,
    answers: Object.keys(storedAnswers).length ? storedAnswers : undefined,
    annotations: kind === "reading" ? legacyAnnotations({ ...real, ...raw }) : undefined,
    readingTiming: kind === "reading" && bankId ? legacyTiming(raw.readingTiming ?? real.readingTiming, id, examId, bankId) : undefined,
    source: "legacy", raw: rawValue,
  };
}

// 2026-11-19：旧题库保留独立身份，显式空值对应内置题库。
export function legacyBank(value: unknown) {
  return value === null ? "main" : typeof value === "string" && value.trim() ? `legacy-bank:${value.trim()}` : undefined;
}

export function legacyAnswers(input: unknown): Answers {
  return Object.fromEntries(Object.entries(object(input))
    .filter(([, value]) => value === null || typeof value === "string" || Array.isArray(value))
    .map(([question, value]) => [question, answer(value)]));
}

export function legacyAnnotations(raw: Record<string, unknown>): ReadingAnnotations | undefined {
  const input = { ...raw, ...object(raw.annotations) };
  const notes = string(input.noteText) || string(input.notes);
  const markedQuestions = array(input.markedQuestions).filter((value): value is string => typeof value === "string");
  const highlights = array(input.highlights).flatMap((value) => {
    const item = object(value);
    const blockId = string(item.blockId);
    const text = string(item.quote) || string(item.text);
    const start = numeric(item.startOffset) ?? numeric(item.start);
    const end = numeric(item.endOffset) ?? numeric(item.end);
    return blockId && text && start !== null && end !== null && Number.isSafeInteger(start) && Number.isSafeInteger(end)
      && start >= 0 && end - start === text.length ? [{ blockId, text, start, end }] : [];
  });
  return notes || markedQuestions.length || highlights.length ? { notes, markedQuestions, highlights } : undefined;
}

export function legacyTiming(value: unknown, attemptId: string, examId: string, bankId: string, final = true) {
  const input = object(value);
  if (!examId || input.measurement !== "foreground-selection" || input.version !== 1 || (final && input.frozen !== true)
    || input.examId !== examId || legacyBank(input.libraryConfigurationId) !== bankId
    || !Array.isArray(input.units) || !Array.isArray(input.questionOrder)) return undefined;
  const units = input.units.map((value) => {
    const unit = object(value);
    const questionIds = array(unit.questionIds);
    return { id: questionIds.join("+"), kind: unit.kind, durationMs: unit.durationMs, questionIds, labels: questionIds.map((id) => string(id).replace(/^q/i, "")) };
  });
  for (const id of array(input.unsupportedQuestionIds)) {
    units.push({ id: string(id), kind: "question", questionIds: [id], labels: [string(id).replace(/^q/i, "")], durationMs: null });
  }
  const members = new Set(units.flatMap((unit) => unit.questionIds));
  if (members.size !== input.questionOrder.length || input.questionOrder.some((id) => !members.has(id))) return undefined;
  const reasonMap: Record<string, ReadingTiming["reasons"][number]> = {
    "recovery-tail": "recovery-tail", "legacy-start": "legacy-draft", "unsupported-mapping": "missing-mapping",
  };
  const reasons = new Set(array(input.partialReasons).map((reason) => Object.hasOwn(reasonMap, string(reason)) ? reasonMap[string(reason)] : "clock-gap"));
  return readTiming({
    version: 1, kind: "foreground-selection", attemptId, examId, bankId, units,
    totalMs: input.totalMs, unallocatedMs: input.unallocatedMs, reasons: [...reasons], finalized: final,
  } as ReadingTiming);
}

// 2026-11-19：原版的部分导出可以只包含学习资料。
export function legacyPracticeRecords(value: unknown, allowEmpty = false) {
  const root = object(value);
  const nested = object(root.data);
  let candidates: unknown[];
  if (root.format === "ielts-atlas-data-v2") {
    const source = object(root.entities);
    const layer = (rows: unknown) => new Map(array(rows).map((row) => {
      const item = object(row);
      return [string(item.recordId), object(item.data)] as const;
    }));
    const details = layer(source.practiceDetails);
    const annotations = layer(source.practiceAnnotations);
    // 2026-11-28：按记录 ID 合并原版单篇的摘要、答案和批注。
    candidates = [...layer(source.practiceSummaries)].map(([id, summary]) => ({
      ...summary, ...details.get(id), ...annotations.get(id), id,
    }));
  } else {
    candidates = Array.isArray(value) ? value : [
      root.practice_records, root.practiceRecords, root.records,
      nested.practice_records, nested.practiceRecords,
      object(nested.practice_records).data, object(nested.practiceRecords).data,
      object(root.exam_system_practice_records).data, object(nested.exam_system_practice_records).data,
    ].flatMap(array);
  }
  const accepted = candidates.map((row) => normalize(row)).filter((row) => row !== null);
  const records = [...new Map(accepted.map((record) => [record.id, record])).values()];
  if (!allowEmpty && !records.length) throw new Error("没有找到有原始标识的正式历史记录。");
  return { records, ignored: candidates.length - records.length };
}
