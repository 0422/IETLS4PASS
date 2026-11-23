// 2026-11-19：以剑雅书号、Test 和 Section 识别听力条目，并保留自备题源的场景信息。
import type { FolderCatalog, LocalEntry } from "./bankSource";
// 2026-11-23：听力题面使用原有的文本范围结构记录高亮。
import type { Answers, PassageHighlight, PracticeRecord, ReadingExam } from "./types";

// 2026-11-20：统一听力题库的分类顺序，兼容含义对应的旧目录名和场景字段。
export const listeningScenes = [
  "求职", "经营管理", "地理", "旅游", "日常生活", "建筑环境", "健康医疗",
  "住宿", "运动", "图书馆", "保险", "新生入学", "作业讨论", "人文社科",
  "生物", "课题研究",
] as const;
export type ListeningScene = (typeof listeningScenes)[number];

const legacyListeningScenes = new Map<string, ListeningScene>([
  ["租房", "住宿"],
  ["改造建设", "建筑环境"],
  ["医疗", "健康医疗"],
]);
export const questionsPerSection = 10;

// 2026-11-20：每题可附带给详解页使用的解析文字。
interface ListeningQuestion { prompt: string; answer: string | string[]; options?: string[]; explanation?: string }
export interface ListeningPart { part: number; questions: ListeningQuestion[]; title?: string; scene?: string }
export interface ListeningPaper { title: string; parts: ListeningPart[]; sourceName?: string; scene?: string }
export type ListeningDocument = ListeningPaper | { title: string; catalog: FolderCatalog };

export interface ListeningDraft {
  id: string;
  revision: number;
  bankId: string;
  examId: string;
  startedAt: string;
  elapsedMs: number;
  position: number;
  answers: Answers;
  // 2026-11-23：续做时恢复本节题面高亮，旧草稿可省略此字段。
  questionHighlights?: PassageHighlight[];
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(text);
const fileTitle = (name: string) => name.replace(/\.(?:html?|json|pdf|mp3|m4a|wav|ogg|aac|flac|mp4)$/i, "");

export function cambridgeIdentity(name: string) {
  const match = /(?:剑雅|Cambridge(?:\s+IELTS)?)[ _-]*(\d{1,3})[ _-]*Test[ _-]*(\d{1,2})(?!\d)(?:[ _–—-]*(?:Section|Part|P)[ _-]*([1-4])(?!\d))?/i.exec(name);
  if (!match || !Number(match[1]) || !Number(match[2])) return undefined;
  const subtitle = fileTitle(name.slice(match.index + match[0].length)).replace(/^[\s_–—-]+/, "");
  return { book: Number(match[1]), test: Number(match[2]), section: match[3] ? Number(match[3]) : undefined, subtitle };
}

export function parseListeningPaper(value: unknown, name = "", exact = false): ListeningPaper {
  const input = object(value);
  const title = text(input.title) || fileTitle(name);
  const identity = cambridgeIdentity(name) ?? cambridgeIdentity(title);
  if (input.format !== "ietls4pass-listening-v1" || !title || !Array.isArray(input.parts) || input.parts.length < 1 || input.parts.length > 4) {
    throw new Error("听力 JSON 需要 ietls4pass-listening-v1 格式和 1 至 4 个 Section。");
  }
  const parts = input.parts.map((value): ListeningPart => {
    const part = object(value);
    if (typeof part.part !== "number" || !Number.isInteger(part.part) || part.part < 1 || part.part > 4
      || !Array.isArray(part.questions) || part.questions.length < 1 || part.questions.length > questionsPerSection
      || (exact && part.questions.length !== questionsPerSection)) {
      throw new Error("Section 编号需要在 1 至 4 之间，新导入的每个 Section 固定为 10 道题。");
    }
    return {
      part: part.part, title: text(part.title) || undefined, scene: text(part.scene) || undefined,
      questions: part.questions.map((value) => {
        const question = object(value);
        const prompt = text(question.prompt);
        const answer = question.answer;
        const options = question.options;
        if (!prompt || !(typeof answer === "string" ? text(answer) : strings(answer)) || (options !== undefined && !strings(options))) {
          throw new Error(`Section ${part.part} 的每题需填写题干和答案，选项需为字符串数组。`);
        }
        // 2026-11-20：读取可选的逐题解析，兼容原有题目文件。
        return { prompt, answer: answer as string | string[], options: options as string[] | undefined,
          explanation: text(question.explanation) || undefined };
      }),
    };
  });
  if (new Set(parts.map((part) => part.part)).size !== parts.length) throw new Error("听力 JSON 内的 Section 编号重复。");
  if (identity?.section && (parts.length !== 1 || parts[0].part !== identity.section)) {
    throw new Error(`文件名的 Section ${identity.section} 与 JSON 的 part 不一致。`);
  }
  return { title, parts: parts.sort((a, b) => a.part - b.part), sourceName: name || undefined, scene: text(input.scene) || undefined };
}

export function listeningScene(...values: (string | undefined)[]) {
  for (const value of values) {
    // 2026-11-20：目录名和已存的场景字段使用同一套分类名称。
    for (const part of value?.split(/[\\/]/) ?? []) {
      const name = part.trim();
      const scene = listeningScenes.find((candidate) => candidate === name) ?? legacyListeningScenes.get(name);
      if (scene) return scene;
    }
  }
  // 2026-11-19：未识别场景的题目只出现在「全部」。
  return undefined;
}

export interface ListeningRow {
  id: string;
  bankId: string;
  examId: string;
  legacyExamId?: string;
  title: string;
  subtitle?: string;
  scene?: string;
  section: number;
  book?: number;
  test?: number;
  potentialPractice: boolean;
  source: { type: "paper"; part: ListeningPart } | { type: "folder"; catalog: FolderCatalog; entry: LocalEntry };
}

function makeRow(bankId: string, label: string, subtitle: string, section: number, legacyExamId: string | undefined,
  scene: string | undefined, potentialPractice: boolean, source: ListeningRow["source"]): ListeningRow {
  const identity = cambridgeIdentity(label);
  const examId = identity ? `cambridge-${identity.book}-${identity.test}-${section}`
    : source.type === "folder" ? source.entry.examId : `section-${section}`;
  // 保留同一目录内来源独立的条目，续做只恢复原题源的作答。
  const sourceKey = source.type === "folder" ? source.entry.examId : `part-${section}`;
  const title = identity ? `剑雅${identity.book} Test ${identity.test}-Section ${section}` : `${label} · Section ${section}`;
  return { id: `${bankId}:${sourceKey}`, bankId, examId, legacyExamId, title,
    subtitle: identity?.subtitle || (cambridgeIdentity(subtitle) ? undefined : subtitle === label ? undefined : subtitle),
    section, book: identity?.book, test: identity?.test, scene, potentialPractice, source };
}

export function listeningRows(documents: { id: string; value: ListeningDocument }[]) {
  const rows = documents.flatMap(({ id, value }): ListeningRow[] => {
    if ("catalog" in value) return value.catalog.entries.map((entry) => {
      const file = entry.file ?? entry.pdf ?? entry.audio ?? "";
      const label = [file.split("/").at(-1), entry.title].find((part) => part && cambridgeIdentity(part)) ?? entry.title;
      const section = cambridgeIdentity(label)?.section ?? Number(entry.category.slice(1));
      // 2026-11-20：导出资料有录音时仍需独立检查做题数据。
      return makeRow(id, label, entry.title, section, entry.examId, listeningScene(entry.scene, file),
        entry.exportedListening?.hasQuestions ?? Boolean(entry.file), { type: "folder", catalog: value.catalog, entry });
    });
    const label = [value.sourceName, value.title].find((name) => name && cambridgeIdentity(name));
    return value.parts.map((part) => makeRow(id, label || part.title || value.title, part.title || value.title, part.part,
      value.parts.length === 1 ? id : undefined, listeningScene(part.scene, value.scene),
      part.questions.length === questionsPerSection, { type: "paper", part }));
  });
  return rows.sort((a, b) => (b.book ?? 0) - (a.book ?? 0) || (a.test ?? 0) - (b.test ?? 0) || a.section - b.section
    || a.title.localeCompare(b.title, "zh-CN"));
}

// 2026-11-20：顺序视图可单独定位同一节可播放的题源。
export function canListenToRow(row?: ListeningRow) {
  const source = row?.source;
  return source?.type === "paper" || Boolean(source?.entry.audio || source?.entry.kind === "html");
}

export function listeningExam(row: ListeningRow, part: ListeningPart): ReadingExam {
  const questions = part.questions.map((question, index) => [`q${(row.section - 1) * questionsPerSection + index + 1}`, question.answer] as const);
  return { examId: row.examId, meta: { title: row.title, category: "P1" }, passage: { blocks: [] },
    questionGroups: [], answerKey: Object.fromEntries(questions), questionOrder: questions.map(([id]) => id) };
}

export function latestListeningResult(row: ListeningRow, records: PracticeRecord[]) {
  return records.find((record) => record.kind === "listening" && record.bankId === row.bankId
    && (record.examId === row.examId || (row.legacyExamId !== undefined && record.examId === row.legacyExamId))
    && record.possible === questionsPerSection && typeof record.points === "number" && Number.isInteger(record.points)
    && record.points >= 0 && record.points <= questionsPerSection);
}
