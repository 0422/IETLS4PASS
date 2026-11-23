// 2026-11-21：解析本地写作导出，保留题面、分类、图表引用和范文。
export type WritingTask = "1" | "2";

interface WritingText {
  html: string;
  text: string;
}

export interface WritingQuestion {
  id: string;
  file: string;
  task: WritingTask;
  title: string;
  code: string;
  book: number;
  test: number;
  category: string;
  topics: string[];
  prompt: WritingText;
  images: { url: string; file: string }[];
  examples: (WritingText & { band?: string })[];
}

// 2026-11-23：正式提交存正文和时间，题库与统计共用 Task 和题号标识。
export interface WritingSubmission {
  id: string;
  task: WritingTask;
  questionId: string;
  title: string;
  answer: string;
  submittedAt: string;
}

export function writingQuestionKey(task: WritingTask, id: string) {
  return `${task}:${id}`;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const identifier = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) ? String(value) : text(value);
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function writingFileTask(file: string): WritingTask | undefined {
  const task = /^Task\s*([12])\/.+\.json$/i.exec(file)?.[1];
  return task === "1" || task === "2" ? task : undefined;
}

export function parseWritingQuestion(value: unknown, file: string): WritingQuestion {
  const input = object(value);
  const meta = object(input.meta);
  const task = writingFileTask(file);
  const sourceTask = /^Task\s*([12])$/i.exec(text(meta.task))?.[1];
  if (!task || task !== sourceTask) throw new Error("写作题的 Task 编号与所在目录不一致。");

  const title = text(meta.book) || [text(meta.level1), text(meta.level2)].filter(Boolean).join(" ");
  const code = text(meta.code);
  const id = identifier(meta.questionId) || file;
  const [, book, test] = /剑雅\s*(\d+)\s*Test\s*(\d+)/i.exec(title) ?? [];
  const declaredCategory = text(meta.category) || file.split("/").slice(1, -1).at(0) || "";
  const category = declaredCategory === "是否同意" ? "同意与否题" : declaredCategory;
  const topics = [...new Set(list(meta.topics).map(text).filter(Boolean).flatMap((topic) =>
    topic === "教育与科技类" ? ["教育类", "科技类"] : [topic]))];

  const body = object(input.prompt);
  const prompt = { html: list(body.blocks).map((value) => text(object(value).html)).filter(Boolean).join("\n"), text: text(body.text) };
  if (!prompt.html && !prompt.text) throw new Error("写作题源中没有题面。");
  const images = list(body.images).flatMap((value) => {
    const image = object(value);
    const url = text(image.url);
    const file = text(image.file);
    return url && file ? [{ url, file }] : [];
  });
  const examples = list(input.modelAnswer).flatMap((value) => {
    const example = object(value);
    const html = text(example.html);
    const content = text(example.text);
    return html || content ? [{ html, text: content, band: identifier(example.band) || undefined }] : [];
  });
  return { id, file, task, title: title || code || id, code, book: Number(book) || 0, test: Number(test) || 0,
    category, topics, prompt, images, examples };
}
