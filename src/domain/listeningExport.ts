// 2026-11-20：读取精听导出的标题、逐句时间轴和可选题面，保留现有评分格式。
// 2026-11-21：导出答案校验沿用本节的题量常量。
import { cambridgeIdentity, parseListeningPaper, questionsPerSection } from "./listening";
import type { ListeningPart } from "./listening";
// 2026-11-20：解析导出中的标准答案及同一题号下的成对填空。
import { answerText, scoreReading } from "./scoring";
// 2026-11-21：导出解析以文本显示，保持题组原有的段落顺序。
import type { Answers, Explanation, ReadingExam } from "./types";

export interface ListeningSentence {
  text: string;
  start?: number;
  end?: number;
}

// 2026-11-20：导出题号由导航的 scoreCode 关联，避免每题组内重复从 1 编号。
export interface ListeningExportBlock {
  type: string;
  html: string;
  questionIds: string[];
  blankIds: string[];
  choices: { label: string; html: string }[];
  labels: string[];
  heading: string;
  answers: Answers;
  pairs: ListeningAnswerPair[];
}

export interface ListeningAnswerPair { ids: [string, string]; exchange: boolean }

// 2026-11-20：按十个正式题号出分，部分题号下的两空也能按导出的顺序规则评分。
export function scoreListeningExport(exam: ReadingExam, answers: Answers, pairs: ListeningAnswerPair[] = []) {
  const details = new Map(scoreReading(exam, answers).map((item) => [item.questionId, item]));
  for (const { ids, exchange } of pairs) {
    const [first, second] = ids;
    const left = details.get(first);
    const right = details.get(second);
    if (!left || !right) continue;
    if (exchange) {
      const swapped = scoreReading({ ...exam, questionOrder: ids }, {
        ...answers, [first]: answers[second] ?? null, [second]: answers[first] ?? null,
      });
      if (swapped[0].points + swapped[1].points > left.points + right.points) {
        if (Number(second.slice(1)) > 40) {
          left.points = swapped[0].points;
          right.points = swapped[1].points;
        } else {
          [left.points, right.points] = [swapped[1].points, swapped[0].points];
          [left.correctAnswer, right.correctAnswer] = [right.correctAnswer, left.correctAnswer];
        }
      }
    }
    if (Number(second.slice(1)) > 40) {
      left.points = left.points + right.points === 2 ? 1 : 0;
      if (left.userAnswer || right.userAnswer) left.userAnswer = [answerText(left.userAnswer), answerText(right.userAnswer)];
      left.correctAnswer = [answerText(left.correctAnswer), answerText(right.correctAnswer)];
      details.delete(second);
    }
  }
  return [...details.values()];
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const timestamp = (value: unknown) =>
  typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;

// 2026-11-21：优先读取新版按题号及 scoreCode 导出的答案，兼容只带原始字段的旧题源。
function exportedAnswers(value: unknown) {
  const answers = new Map<string, { code: string; accepted: string[]; right: string }>();
  for (const item of Array.isArray(value) ? value : []) {
    const entry = record(item);
    const index = Number(entry.questionIndex);
    if (!Number.isInteger(index) || index < 1 || index > 40) continue;
    const right = text(entry.rightAnswer);
    const accepted = (Array.isArray(entry.accepted) ? entry.accepted : []).map(text).filter(Boolean);
    const terms = accepted.length ? accepted : right.split("|").map(text).filter(Boolean);
    if (terms.length) answers.set(`q${index}`, { code: text(entry.scoreCode), accepted: terms, right: right || terms.join("|") });
  }
  return answers;
}

// 2026-11-21：将题图网址映射到导出的相对路径，浏览器无需访问站点取图。
export function listeningExportImagePath(source: string, images: ReadonlyMap<string, string>) {
  if (!images.size) return undefined;
  try {
    return images.get(new URL(source, "https://ieltscat.xdf.cn").href);
  } catch {
    return undefined;
  }
}

// 2026-11-20：将不同导出题型归一为题组、可选项和本节实际题号。
// 2026-11-21：按现有题型拆开整组答案，再关联到本节的实际题号。
function questionBlocks(data: Record<string, unknown>, preferred: ReturnType<typeof exportedAnswers>): ListeningExportBlock[] {
  const nav = new Map<string, string[]>();
  for (const value of Array.isArray(data.navList) ? data.navList.flat(2) : []) {
    const item = record(value);
    const number = Number(item.orderId);
    const code = text(item.scoreCode);
    if (!code || !Number.isInteger(number) || number < 1 || number > 40) continue;
    const keys = nav.get(code) ?? [];
    keys.push(`q${number}`);
    nav.set(code, keys);
  }
  if (!Array.isArray(data.contentList)) return [];
  const answerFor = (id: string, scoreCode: string) => {
    const entry = preferred.get(id);
    return entry && (!entry.code || entry.code === scoreCode) ? entry : undefined;
  };
  // 2026-11-20：少数题在同一官方题号下有两个输入位，额外编号仅用于保存作答。
  let slotNumber = 100;
  return data.contentList.flatMap((value) => {
    const encoded = record(value).content;
    try {
      const block = record(typeof encoded === "string" ? JSON.parse(encoded) : encoded);
      const type = text(block.sctype);
      if (!type) return [];
      const answers: Answers = {};
      const pairs: ListeningAnswerPair[] = [];
      // 2026-11-21：用题号和评分码核对新版答案的归属。
      const score = text(block.sccode);
      const ids = nav.get(score) ?? [];
      const blankIds = (Array.isArray(block.content) ? block.content : []).flatMap((value) => {
        const slot = record(value);
        const code = text(slot.sccode);
        const listed = nav.get(code) ?? [];
        if (!listed.length) return [""];
        const values = Array.isArray(slot.value) ? slot.value.map(text) : [text(slot.value)];
        const fields = type === "216" && listed.length === 1 && values.length === 2
          ? [...listed, `q${++slotNumber}`] : listed;
        // 2026-11-21：两个空的逗号分隔答案与单空的竖线备选分别处理。
        const supplied = answerFor(listed[0], code);
        const pairsFromExport = supplied?.right.split(",");
        fields.forEach((id, index) => {
          const grouped = pairsFromExport?.length === fields.length ? pairsFromExport[index] : undefined;
          const alternatives = fields.length === 1 && supplied
            ? supplied.accepted : (grouped || values[index])?.split("|").map(text).filter(Boolean);
          if (alternatives?.length) answers[id] = alternatives.length === 1 ? alternatives[0] : alternatives;
        });
        if (fields.length === 2) pairs.push({ ids: [fields[0], fields[1]], exchange: String(slot.exchange) === "1" });
        return fields;
      });
      const choices = (Array.isArray(block.options) ? block.options : []).flatMap((value) => {
        const option = record(value);
        const label = typeof option.name === "number" ? String(option.name) : text(option.name);
        return label ? [{ label, html: text(option.option) }] : [];
      });
      const labels = type === "223" ? (Array.isArray(block.title) ? block.title : text(block.title).split(","))
        .map(text).filter(Boolean) : [];
      if (type === "201" || type === "202" || type === "223") {
        const values = Array.isArray(block.value) ? block.value.map(text) : [...text(block.value)];
        // 2026-11-21：多选的字母串和地图题的逗号序列均使用导出的顺序。
        const supplied = answerFor(ids[0], score);
        const ordered = supplied ? (type === "223" ? supplied.right.split(",").map(text) : [...supplied.right]) : [];
        ids.forEach((id, index) => {
          const alternatives = ids.length === 1 ? supplied?.accepted : undefined;
          if (alternatives?.length) answers[id] = alternatives.length === 1 ? alternatives[0] : alternatives;
          else {
            const answer = (ordered.length === ids.length ? ordered[index] : undefined)
              || (values.length === ids.length ? values[index] : undefined);
            if (answer) answers[id] = answer;
          }
        });
      }
      return [{ type, html: type === "223" ? "" : text(block.title), questionIds: ids,
        blankIds, choices, labels, heading: text(block.head), answers, pairs }];
    } catch {
      return [];
    }
  });
}

export function parseListeningExport(value: unknown, filename: string) {
  const input = record(value);
  const meta = record(input.meta);
  const listening = record(input.listening);
  const identity = cambridgeIdentity([meta.book, meta.test, meta.section].map(text).join(" "));
  if (!identity?.section || !input.listening || typeof input.listening !== "object") return undefined;
  const expected = cambridgeIdentity(filename);
  if (!expected || identity.book !== expected.book || identity.test !== expected.test || identity.section !== expected.section) return undefined;

  const subtitle = text(meta.subTitle) || text(listening.title);
  const questionData = record(input.questions);
  const questionText = questionData.ok === true ? text(questionData.questionText) : "";
  // 2026-11-20：保留导出题面的说明和 HTML 表格，渲染时再转换可识别的答题位。
  // 2026-11-20：从导出导航恢复分组填空和选项题的实际题号。
  // 2026-11-21：新版题面保留既有题型处理，同时导入标准答案、解析文本和本地题图。
  const blocks = questionData.ok === true ? questionBlocks(record(record(questionData.raw).data), exportedAnswers(input.answers)) : [];
  const imageFiles = new Map((Array.isArray(questionData.images) ? questionData.images : []).flatMap((value) => {
    const image = record(value);
    const url = text(image.url);
    const file = text(image.file);
    return url && file ? [[url, file] as const] : [];
  }));
  const questionExplanations = (Array.isArray(input.analysis) ? input.analysis : []).flatMap((value) => {
    const explanation = text(record(value).text);
    return explanation ? [{ text: explanation }] : [];
  });
  const explanation: Explanation | undefined = questionExplanations.length ? { questionExplanations } : undefined;
  let part: ListeningPart | undefined;
  if (questionData.ok !== false && Array.isArray(questionData.items)) {
    try {
      part = parseListeningPaper({ format: "ietls4pass-listening-v1",
        parts: [{ part: identity.section, questions: questionData.items }] }, filename, true).parts[0];
    } catch {
      // 评分需要完整的十题与答案，保留可用的题面文本和精听资料。
    }
  }

  const sentences: ListeningSentence[] = (Array.isArray(listening.sentences) ? listening.sentences : []).flatMap((value) => {
    const sentence = record(value);
    const english = text(sentence.en);
    if (!english) return [];
    const start = timestamp(sentence.start);
    const end = timestamp(sentence.end);
    return [Number.isFinite(start) && start >= 0 && Number.isFinite(end) && end > start
      ? { text: english, start, end } : { text: english }];
  });
  const transcript = sentences.length ? sentences : text(listening.transcript).split(/\r?\n/).filter(Boolean)
    .map((line): ListeningSentence => ({ text: line }));
  // 2026-11-20：只有明确覆盖本节十个正式题号的标准答案才打开详解。
  const keys = Object.assign({}, ...blocks.map((block) => block.answers)) as Answers;
  // 2026-11-21：按所匹配的本节题号检验导出答案是否齐全。
  const offset = (identity.section - 1) * questionsPerSection;
  const hasAnswers = Boolean(part) || Array.from({ length: questionsPerSection }, (_, index) => `q${offset + index + 1}`).every((id) => Boolean(keys[id]));
  // 2026-11-21：将新版题图映射和解析一并交给练习页。
  return { identity, subtitle, part, questionText, questionBlocks: blocks, keys, hasAnswers, transcript,
    audioFile: text(listening.audioFile), imageFiles, explanation };
}
