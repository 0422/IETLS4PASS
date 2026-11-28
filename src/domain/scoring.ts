// 2026-11-19：移植上游 answerMatchCore.js 与 unifiedReadingPage.js 的判分规则。
import type { Answer, AnswerResult, Answers, ReadingExam, ReadingGroup } from "./types";

export const SCORING_VERSION = "upstream-reading-v1";

const synonyms: Record<string, string> = {
  true: "true", t: "true", yes: "true", y: "true",
  false: "false", f: "false", no: "false", n: "false",
  ng: "not given", notgiven: "not given", "not-given": "not given",
};

function tidy(value: string) {
  return value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ").trim();
}

function normalize(value: string) {
  const token = tidy(value).replace(/^[\s"'()[\]{}<>.,;:!?\x60]+|[\s"'()\[\]{}<>.,;:!?\x60]+$/g, "");
  const lower = token.toLowerCase();
  if (Object.hasOwn(synonyms, lower)) return synonyms[lower];
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  return token.match(/^([a-z])[.)]\s+\S/i)?.[1].toUpperCase() ?? token;
}

function equivalent(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (/^[A-Z]$/.test(a) || /^[A-Z]$/.test(b)) return false;
  return a.toLowerCase().replace(/[^a-z0-9]+/g, "") === b.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function tokens(answer: Answer | undefined): string[] {
  if (Array.isArray(answer)) return answer.flatMap(tokens);
  if (!answer) return [];
  const value = tidy(answer);
  if (/^[a-z](?:\s*[,/;，、]\s*[a-z])+$/i.test(value)) return value.split(/[,/;，、]/).map(normalize);
  if (/^[a-z](?:\s+[a-z])+$/i.test(value)) return value.split(/\s+/).map(normalize);
  return [normalize(value)].filter(Boolean);
}

// 2026-11-27：听力回看用相同的答案匹配规则给复选和成对填空上色。
export function answersMatch(actual: Answer, expected: Answer) {
  const right = tokens(expected);
  let left = tokens(actual);
  if (right.length === 1 && /^[A-Z]$/.test(right[0]) && left.length === 1
    && !/^[A-Z]$/.test(left[0]) && typeof actual === "string") {
    const label = actual.trim().match(/^([A-Z])\s+\S/);
    if (label) left = [label[1]];
  }
  if (!left.length || !right.length) return false;
  if (Array.isArray(expected) && left.length === 1) return right.some((value) => equivalent(left[0], value));
  const distinctLeft = [...new Set(left)];
  const distinctRight = [...new Set(right)];
  return distinctLeft.length === distinctRight.length
    && distinctLeft.every((value) => distinctRight.some((target) => equivalent(value, target)));
}

function choiceTokens(answer: Answer | undefined) {
  const entries = Array.isArray(answer) ? answer : [answer];
  const normalized: string[] = [];
  for (const entry of entries) {
    for (const token of typeof entry === "string" && /^[a-z]$/i.test(entry.trim())
      ? [entry.trim().toUpperCase()] : tokens(entry)) {
      if (!normalized.some((existing) => equivalent(existing, token))) normalized.push(token);
    }
  }
  return normalized.sort((a, b) => a.localeCompare(b, "en"));
}

export function isCheckboxGroup(group: ReadingGroup) {
  if (!["multi_choice", "multiple_choice"].includes(group.kind)) return false;
  if (/\btype\s*=\s*(?:"checkbox"|'checkbox'|checkbox)(?=\s|\/?>)/i.test(group.bodyHtml)) return true;
  return !/\btype\s*=\s*(?:"radio"|'radio'|radio)(?=\s|\/?>)/i.test(group.bodyHtml);
}

function questionType(group?: ReadingGroup) {
  if (!group) return "other";
  const kind = group.kind.replaceAll("_", "-");
  if (["multi-choice", "single-choice", "multiple-choice"].includes(kind)) return "multiple-choice";
  if (kind === "diagram-completion") return "diagram-labelling";
  if (kind === "flow-chart-completion") return "flow-chart";
  if (kind === "notes-completion") return "note-completion";
  if (kind === "matching" || kind === "classification") {
    const instructions = `${group.leadHtml ?? ""} ${group.bodyHtml}`.replace(/<[^>]+>/g, " ").toLowerCase();
    if (/which paragraph contains|contains the following information/.test(instructions)) return "matching-information";
    if (/list of headings|choose the correct heading|match.*heading/.test(instructions)) return "heading-matching";
    if (/list of people|match each person|list of ideas/.test(instructions)) return "matching-people-ideas";
    return "matching-features";
  }
  return kind;
}

export function scoreReading(exam: ReadingExam, answers: Answers): AnswerResult[] {
  // 2026-11-19：为旧题源保留原位控件，同时按真实复选控件判分。
  const groups = new Map([...exam.questionGroups, ...(exam.scoringGroups ?? [])].flatMap((group) =>
    group.questionIds.map((id) => [id, group] as const)));
  return exam.questionOrder.map((questionId) => {
    const group = groups.get(questionId);
    const correctAnswer = exam.answerKey[questionId] ?? null;
    let userAnswer = answers[questionId] ?? null;
    let possible = 1;
    let points = answersMatch(userAnswer, correctAnswer) ? 1 : 0;
    // 2026-11-19：原版听力组合复选按整组集合完全匹配计分。
    if (group?.kind === "listening-set" && Array.isArray(correctAnswer)) {
      const actual = choiceTokens(userAnswer);
      const expected = choiceTokens(correctAnswer);
      points = actual.length > 0 && actual.length === expected.length
        && expected.every((token) => actual.some((selected) => equivalent(token, selected))) ? 1 : 0;
    }
    if (group && isCheckboxGroup(group)) {
      if (group.questionIds.length > 1) {
        const selected = choiceTokens(group.questionIds.flatMap((id) => answers[id] ?? []));
        const expectedCount = group.questionIds.filter((id) => tokens(exam.answerKey[id]).length > 0).length;
        const expected = tokens(correctAnswer)[0];
        points = selected.length <= expectedCount && expected
          && selected.some((value) => equivalent(value, expected)) ? 1 : 0;
        userAnswer = selected.length ? selected : userAnswer;
      } else if (Array.isArray(correctAnswer)) {
        const selected = choiceTokens(userAnswer);
        const expected = choiceTokens(correctAnswer);
        possible = expected.length || 1;
        points = expected.filter((target) => selected.some((value) => equivalent(value, target))).length;
        userAnswer = selected.length ? selected : userAnswer;
      }
    }
    return {
      questionId,
      label: exam.questionDisplayMap?.[questionId] ?? questionId.replace(/^q/, ""),
      type: questionType(group),
      userAnswer,
      correctAnswer,
      points,
      possible,
    };
  });
}

export function answerText(answer: Answer | undefined) {
  return (Array.isArray(answer) ? answer.join("、") : answer?.trim()) || "—";
}

// 2026-11-19：共享多选的作答状态遵循上游的选满数量规则。
export function answeredReadingQuestions(exam: ReadingExam, answers: Answers) {
  const answered = new Set(exam.questionOrder.filter((id) => tokens(answers[id]).length > 0));
  for (const group of exam.questionGroups) {
    if (group.questionIds.length < 2 || !isCheckboxGroup(group)) continue;
    const selected = choiceTokens(group.questionIds.flatMap((id) => answers[id] ?? []));
    const expected = group.questionIds.filter((id) => tokens(exam.answerKey[id]).length > 0).length;
    for (const id of group.questionIds) {
      if (selected.length > 0 && selected.length >= expected) answered.add(id);
      else answered.delete(id);
    }
  }
  return answered;
}
