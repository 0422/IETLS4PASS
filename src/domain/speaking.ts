// 2026-11-19：口语题源按 Part 拆成 UTF-8 JSON，稳定 ID 用于合并和打开详情。
export const speakingParts = [1, 2, 3] as const;
export type SpeakingPart = (typeof speakingParts)[number];

export interface SpeakingTopic {
  id: string;
  part: SpeakingPart;
  category: string;
  title: string;
  book?: string;
  difficulty?: string;
  questions: string[];
  cueCard?: string;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function parseSpeakingFile(value: unknown): SpeakingTopic[] {
  const data = object(value);
  const part = speakingParts.find((item) => item === data.part);
  if (data.format !== "ietls4pass-speaking-v1" || !part || !Array.isArray(data.topics)) {
    throw new Error("需要 ietls4pass-speaking-v1、Part 编号和 topics 数组。");
  }
  return data.topics.map((row, index) => {
    const raw = object(row);
    const id = text(raw.id);
    const category = text(raw.category);
    const title = text(raw.title);
    const cueCard = text(raw.cueCard);
    const hasQuestionList = raw.questions === undefined || (Array.isArray(raw.questions) && raw.questions.every((question) => typeof question === "string"));
    const questions = Array.isArray(raw.questions) ? raw.questions.map(text).filter(Boolean) : [];
    if (!id || !category || !title || !hasQuestionList || (!cueCard && !questions.length)) {
      throw new Error(`第 ${index + 1} 个话题需要 id、category、title，以及题卡或问题。`);
    }
    return { id, part, category, title, questions, cueCard: cueCard || undefined,
      book: text(raw.book) || undefined, difficulty: text(raw.difficulty) || undefined };
  });
}

export const speakingTopicId = (topic: SpeakingTopic) => `${topic.part}:${topic.id}`;

export function mergeSpeakingTopics(groups: SpeakingTopic[][]) {
  const topics = new Map<string, SpeakingTopic>();
  for (const group of groups) for (const topic of group) {
    const id = speakingTopicId(topic);
    if (!topics.has(id)) topics.set(id, topic);
  }
  return [...topics.values()];
}

export function speakingTopicMatches(topic: SpeakingTopic, query: string) {
  const match = query.trim().toLocaleLowerCase();
  return !match || [topic.title, topic.category, topic.book, topic.cueCard, ...topic.questions]
    .some((value) => value?.toLocaleLowerCase().includes(match));
}
