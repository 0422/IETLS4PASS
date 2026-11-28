// 2026-11-28：统一四科独立练习记录的筛选、展示及导出。
import type { PracticeRecord } from "./types";
import { answerText } from "./scoring";
// 2026-11-27：口语会话在总览中按练习记录展示和导出。
import type { SpeakingSession } from "./speakingPractice";
// 2026-11-27：写作从原始提交记录读取和导出正文。
import type { WritingSubmission } from "./writing";

export const kindLabel = { reading: "阅读", listening: "听力", speaking: "口语", writing: "写作" } as const;

// 2026-11-27：统一列表所需字段，口语仍用原会话作为回放来源。
interface SpeakingRecord {
  id: string;
  kind: "speaking";
  title: string;
  category: string;
  elapsedMs: number;
  submittedAt: string;
  session: SpeakingSession;
}

// 2026-11-27：写作原始提交只有正文和提交时间，用时沿用列表的缺省状态。
interface WritingRecord {
  id: string;
  kind: "writing";
  title: string;
  category: string;
  elapsedMs?: undefined;
  submittedAt: string;
  submission: WritingSubmission;
}

export type ListedPracticeRecord = PracticeRecord | SpeakingRecord | WritingRecord;

export function speakingRecord(session: SpeakingSession): SpeakingRecord {
  return {
    id: session.id, kind: "speaking", title: session.title, category: `Part ${session.part}`,
    elapsedMs: session.elapsedMs, submittedAt: session.updatedAt, session,
  };
}

// 2026-11-27：用每次提交的标识回看当次作文。
export function writingRecord(submission: WritingSubmission): WritingRecord {
  return {
    id: submission.id, kind: "writing", title: submission.title, category: `Task ${submission.task}`,
    submittedAt: submission.submittedAt, submission,
  };
}

export function recordMatches(record: ListedPracticeRecord, search: string) {
  // 2026-11-27：写作可按保存的题号搜索。
  const reference = record.kind === "speaking" ? record.session.book
    : record.kind === "writing" ? record.submission.questionId : record.examId;
  return [record.title, reference, record.category, kindLabel[record.kind]]
    .some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()));
}

export function dateText(value?: string) {
  const date = new Date(value ?? "");
  return Number.isNaN(date.valueOf()) ? "日期未知" : new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium", timeStyle: "short",
  }).format(date);
}

export function durationText(ms?: number) {
  if (!Number.isFinite(ms) || ms === undefined) return "—";
  const seconds = Math.floor(Math.max(ms, 0) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
    : minutes ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// 2026-11-23：整份成绩和逐题成绩共用分值有效性检查。
export function usableScore(record: Pick<PracticeRecord, "points" | "possible">) {
  const { points, possible } = record;
  return points !== null && possible !== null && Number.isFinite(points) && Number.isFinite(possible)
    && points >= 0 && possible > 0 && points <= possible;
}

// 2026-11-27：练习记录导出包含已结束口语的考官问题和实际回答。
export function recordsMarkdown(records: ListedPracticeRecord[]) {
  const escape = (value: string) => value.replace(/[|\r\n]/g, (char) => char === "|" ? "\\|" : " ");
  const rows = (record: ListedPracticeRecord): string[] => {
    const header = [
      `## ${escape(record.title)}`,
      "",
      `- 类型 ${kindLabel[record.kind]}`,
      `- 提交 ${dateText(record.submittedAt)}`,
    ];
    if (record.kind === "speaking") return [
      ...header,
      `- ${record.category}`,
      `- 练习用时 ${durationText(record.elapsedMs)}`,
      "",
      ...record.session.messages.flatMap(({ role, content }) => [`**${role === "assistant" ? "考官" : "我"}**`, "", content, ""]),
    ];
    // 2026-11-27：导出实际保存的作文和原始段落。
    if (record.kind === "writing") return [...header, `- ${record.category}`, "", record.submission.answer, ""];
    return [
      ...header,
      `- 得分 ${usableScore(record) ? `${record.points} / ${record.possible}` : "—"}`,
      `- ${record.source === "legacy" ? "原版记录用时" : "前台有效用时"} ${durationText(record.elapsedMs)}`,
      "",
      ...(record.details?.length ? [
        "| 题号 | 作答 | 标准答案 | 得分 |",
        "|---|---|---|---|",
        ...record.details.map((detail) => `| ${escape(detail.label)} | ${escape(answerText(detail.userAnswer))} | ${escape(answerText(detail.correctAnswer))} | ${detail.points} / ${detail.possible} |`),
        "",
      ] : []),
    ];
  };
  return ["# IETLS4PASS 练习记录", "", ...records.flatMap(rows)].join("\n");
}
