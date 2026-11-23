// 2026-11-19：统一套题子项、历史筛选及按实际分值加权的学习统计。
import type { PracticeRecord } from "./types";
import { answerText } from "./scoring";

export const kindLabel = { reading: "阅读", listening: "听力", suite: "套题" } as const;

export function recordMatches(record: PracticeRecord, search: string) {
  return [record.title, record.examId, record.category, kindLabel[record.kind]]
    .some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()));
}

export function submissions(records: PracticeRecord[]) {
  const children = new Set(records.flatMap((record) => (record.children ?? []).map((child) => child.id)));
  const output = new Map<string, PracticeRecord>();
  for (const record of records) {
    if (record.kind === "suite") {
      for (const child of record.children ?? []) if (child.kind !== "suite") output.set(child.id, child);
    } else if (!children.has(record.id)) output.set(record.id, record);
  }
  return [...output.values()];
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

export function recordsMarkdown(records: PracticeRecord[]) {
  const escape = (value: string) => value.replace(/[|\r\n]/g, (char) => char === "|" ? "\\|" : " ");
  const rows = (record: PracticeRecord, level: number): string[] => [
    `${"#".repeat(level)} ${escape(record.title)}`,
    "",
    `- 类型 ${kindLabel[record.kind]}`,
    `- 提交 ${dateText(record.submittedAt)}`,
    `- 得分 ${usableScore(record) ? `${record.points} / ${record.possible}` : "—"}`,
    `- ${record.source === "legacy" ? "原版记录用时" : "前台有效用时"} ${durationText(record.elapsedMs)}`,
    "",
    ...(record.details?.length ? [
      "| 题号 | 作答 | 标准答案 | 得分 |",
      "|---|---|---|---|",
      ...record.details.map((detail) => `| ${escape(detail.label)} | ${escape(answerText(detail.userAnswer))} | ${escape(answerText(detail.correctAnswer))} | ${detail.points} / ${detail.possible} |`),
      "",
    ] : []),
    ...(record.children ?? []).flatMap((child) => rows(child, Math.min(level + 1, 6))),
  ];
  return ["# IETLS4PASS 练习记录", "", ...records.flatMap((record) => rows(record, 2))].join("\n");
}
