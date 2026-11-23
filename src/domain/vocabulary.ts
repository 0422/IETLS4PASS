// 2026-11-20：本机词条编辑沿用原来的复习标识，删除状态和内容编辑用同一条记录保存。
import type { Word } from "./types";

// 2026-11-20：单独保存考点词的资料元数据，编辑普通词条字段时继续显示原详解。
// 2026-11-20：为 AWL 学术词汇表保留独立的编辑和复习标识。
export type VocabularyListId = "ielts_core" | "ielts_538" | "awl" | "reading";
interface VocabularyStudyFields {
  category: 1 | 2 | 3;
  rank?: number;
  substitutions?: string;
  relatedWords?: string[];
}

interface VocabularyStudyNote {
  number: number;
  word: string;
  file: string;
  page: number;
  text: string;
}

// 2026-11-20：保留 AWL 词族成员、最常用词形和来源页。
interface VocabularyWordFamily {
  sublist: number;
  commonForm: string;
  variants: string[];
  source: { file: string; page: number };
}

export type VocabularyWord = Word & {
  title?: string;
  study?: VocabularyStudyFields & { notes: VocabularyStudyNote[] };
  wordFamily?: VocabularyWordFamily;
};
export type VocabularyEntry = VocabularyWord & { id: string };
export type VocabularyEdit = { kind: "replace"; word: Word } | { kind: "remove" };

// 2026-11-20：同一份详解只随词表打包一次，主词与对应的替换词共享引用。
export interface VocabularyPdfList {
  words: (Word & { study: VocabularyStudyFields & { noteIds: number[] } })[];
  notes: Record<number, VocabularyStudyNote | undefined>;
}

export function vocabularyPdfWords(data: VocabularyPdfList): VocabularyWord[] {
  return data.words.map(({ study, ...word }) => {
    const { noteIds, ...fields } = study;
    return { ...word, study: { ...fields, notes: noteIds.flatMap((id) => data.notes[id] ?? []) } };
  });
}

export function vocabularyEntries(
  list: VocabularyListId,
  words: readonly VocabularyWord[],
  edits: readonly { id: string; value: VocabularyEdit }[],
) {
  const changes = new Map(edits.map(({ id, value }) => [id, value]));
  const entries = new Map<string, VocabularyEntry>();
  for (const word of words) {
    const id = `${list}:${word.word}`;
    if (entries.has(id)) continue;
    const edited = changes.get(id);
    if (edited?.kind === "remove") continue;
    const display = edited?.kind === "replace" ? edited.word : word;
    // 2026-11-20：保留原资料的分类和详解，复习和编辑继续使用同一词条标识。
    // 2026-11-20：改拼写或释义后仍显示原词族资料。
    entries.set(id, { ...display, id, title: word.title, study: word.study, wordFamily: word.wordFamily });
  }
  return [...entries.values()];
}
