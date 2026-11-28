// 2026-11-27：校验考试日期和四科目标分数，按 IELTS 官方规则计算总分。
import { dayKey } from "./records";

export const examSkills = [
  { key: "listening", label: "听力" },
  { key: "speaking", label: "口语" },
  { key: "reading", label: "阅读" },
  { key: "writing", label: "写作" },
] as const;

type ExamSkill = (typeof examSkills)[number]["key"];
type ExamBands = Record<ExamSkill, number | null>;

export interface ExamPlan {
  date: string | null;
  bands: ExamBands;
}

export const emptyExamPlan: ExamPlan = {
  date: null,
  bands: { listening: null, speaking: null, reading: null, writing: null },
};

export function parseExamDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && dayKey(date) === value ? date : undefined;
}

export function readExamPlan(value: unknown): ExamPlan {
  if (!value || typeof value !== "object") return emptyExamPlan;
  const saved = value as Partial<ExamPlan>;
  const bands = { ...emptyExamPlan.bands };
  for (const { key } of examSkills) {
    const band = saved.bands?.[key];
    if (typeof band === "number" && band >= 0 && band <= 9 && Number.isInteger(band * 2)) bands[key] = band;
  }
  return { date: typeof saved.date === "string" && parseExamDate(saved.date) ? saved.date : null, bands };
}

// 2026-11-27：四科等权平均，恰在两档中间时取较高的半分档。
// https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail
export function overallExamBand(bands: ExamBands) {
  let total = 0;
  for (const { key } of examSkills) {
    const band = bands[key];
    if (band === null) return null;
    total += band;
  }
  return Math.round((total / examSkills.length) * 2) / 2;
}

// 2026-11-27：比较日历日序，跨夏令时仍按完整日历天计数。
export function daysUntilExam(examDate: string, today: string) {
  return (Date.parse(`${examDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
}
