// 2026-11-19：按上游计时契约保存题目、题组和未分配时长，并保留覆盖限制。
import type { PracticeDraft, ReadingExam, ReadingTiming, ReadingTimingUnit } from "./types";

function timingUnits(exam: ReadingExam, missing: string[]): ReadingTimingUnit[] {
  const order = [...new Set(exam.questionOrder)];
  const components = new Map(order.map((id) => [id, new Set([id])]));
  const unsupported = new Set(missing);
  for (const group of exam.questionGroups) {
    const ids = group.questionIds;
    const joined = new Set(ids.flatMap((id) => [...(components.get(id) ?? [])]));
    if (ids.some((id) => !components.has(id))) for (const id of joined) unsupported.add(id);
    for (const id of joined) components.set(id, joined);
  }
  const unique = [...new Set(components.values())];
  return unique.map((component) => {
    const ids = order.filter((id) => component.has(id));
    return {
      id: ids.join("+"), kind: ids.length > 1 ? "group" : "question", questionIds: ids,
      labels: ids.map((id) => exam.questionDisplayMap?.[id] ?? id.slice(1)),
      durationMs: ids.some((id) => unsupported.has(id)) ? null : 0,
    };
  });
}

function validMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function readTiming(value: ReadingTiming | undefined): ReadingTiming | undefined {
  if (value?.version !== 1 || value.kind !== "foreground-selection" || !Array.isArray(value.units)
    || !Array.isArray(value.reasons) || !validMs(value.unallocatedMs) || !validMs(value.totalMs)) return undefined;
  const members = new Set<string>();
  const unitIds = new Set<string>();
  for (const unit of value.units) {
    if (!unit || typeof unit.id !== "string" || unitIds.has(unit.id)
      || !Array.isArray(unit.questionIds) || !unit.questionIds.length
      || !Array.isArray(unit.labels) || unit.labels.length !== unit.questionIds.length
      || unit.labels.some((label) => typeof label !== "string")
      || unit.kind !== (unit.questionIds.length > 1 ? "group" : "question")
      || (unit.durationMs !== null && !validMs(unit.durationMs))) return undefined;
    unitIds.add(unit.id);
    for (const id of unit.questionIds) {
      if (typeof id !== "string" || members.has(id)) return undefined;
      members.add(id);
    }
  }
  const sum = value.units.reduce((total, unit) => total + (unit.durationMs ?? 0), value.unallocatedMs);
  return sum === value.totalMs ? value : undefined;
}

export function initializeReadingTiming(exam: ReadingExam, draft: PracticeDraft, missing: string[], recovered: boolean) {
  const units = timingUnits(exam, missing);
  const known = new Set(units.filter((unit) => unit.durationMs !== null).map((unit) => unit.id));
  const previous = readTiming(draft.readingTiming);
  if (previous && previous.attemptId === draft.id && previous.examId === draft.examId && previous.bankId === draft.bankId
    && previous.suiteId === draft.suiteId && previous.suitePosition === draft.suitePosition) {
    const matching = units.length === previous.units.length && previous.units.every((old) => known.has(old.id) || old.durationMs === null);
    const reasons = new Set(previous.reasons);
    if (recovered) reasons.add("recovery-tail");
    if (!matching) reasons.add("missing-mapping");
    return { timing: { ...previous, reasons: [...reasons], finalized: false }, known: matching ? known : new Set<string>() };
  }
  const reasons: ReadingTiming["reasons"] = [];
  if (recovered) reasons.push("legacy-draft");
  if (units.some((unit) => unit.durationMs === null)) reasons.push("missing-mapping");
  const timing: ReadingTiming = {
    version: 1, kind: "foreground-selection", attemptId: draft.id, examId: exam.examId, bankId: draft.bankId,
    suiteId: draft.suiteId, suitePosition: draft.suitePosition, units,
    unallocatedMs: 0, totalMs: 0, reasons,
  };
  return { timing, known };
}

export function timingDuration(ms: number) {
  if (ms > 0 && ms < 1_000) return "不足 1 秒";
  const s = Math.floor(ms / 1_000);
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}
