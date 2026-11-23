// 2026-11-19：统一读取静态默认题库和 SQLite 中已导入的阅读题库。
import { useQuery } from "@tanstack/react-query";
// 2026-11-19：识别原版同名规范篇目，跨题库回显完成状态。
// 2026-11-20：静态词表使用可带原资料字段的 VocabularyWord。
import type { ExamEntry, PracticeRecord, ReadingAsset, ReadingIndex } from "../domain/types";
// 2026-11-20：从打包的考点词词表解析逐词详解引用。
import { vocabularyPdfWords } from "../domain/vocabulary";
import type { VocabularyListId, VocabularyPdfList, VocabularyWord } from "../domain/vocabulary";
import { desktop, desktopAvailable, documentsKey } from "./desktop";
// 2026-11-19：将已绑定的本机题库接入现有浏览和加载入口。
import type { FolderCatalog } from "../domain/bankSource";
import { folderReadingAsset } from "./folderBanks";
// 2026-11-23：阅读与词汇统一通过桌面资源目录读取。
import { resourceFile } from "./resourceDirectories";

export const MAIN_BANK = "main";
// 2026-11-21：内置阅读和词汇分别从 data 子目录按需读取。
// 2026-11-23：图片、正式题目和词表随各自的生效目录一起切换。
export const mainMedia = (file: string) => resourceFile("reading", file);
export const vocabularyMedia = (file: string) => resourceFile("vocabulary", file);
export const examKey = (bankId: string, examId: string) => ["reading-asset", bankId, examId] as const;

export interface ImportedBank {
  title: string;
  assets: Record<string, ReadingAsset>;
  catalog?: FolderCatalog;
}

export function useSelectedReadingBank() {
  return useQuery({
    queryKey: documentsKey("settings"), queryFn: () => desktop.documents<unknown>("settings"), enabled: desktopAvailable(),
    select: (documents) => {
      const value = documents.find((document) => document.id === "reading-bank")?.value;
      return typeof value === "string" ? value : MAIN_BANK;
    },
  });
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法读取题库资源（${response.status}）。`);
  return response.json() as Promise<T>;
}

export function useBankIndex() {
  // 2026-11-23：索引与题目读取保持同一个根目录。
  return useQuery({ queryKey: ["reading-index"], queryFn: () => json<ReadingIndex>(mainMedia("index.json")), staleTime: Infinity });
}

export function useCustomBanks() {
  return useQuery({
    queryKey: documentsKey("banks"),
    queryFn: () => desktop.documents<ImportedBank>("banks"),
    enabled: desktopAvailable(),
  });
}

export async function readingAsset(bankId: string, examId: string, banks: { id: string; value: ImportedBank }[]) {
  // 2026-11-23：主阅读题库继续沿用 main 与原题号，目录只由配置决定。
  if (bankId === MAIN_BANK) return json<ReadingAsset>(mainMedia(`reading/${examId}.json`));
  const bank = banks.find((item) => item.id === bankId)?.value;
  if (bank?.catalog) return folderReadingAsset(bank.catalog, examId);
  const asset = bank?.assets[examId];
  if (!asset) throw new Error("此题目缺少本地题库资源。");
  return asset;
}

export function importedEntries(bank: ImportedBank): ExamEntry[] {
  if (bank.catalog) return bank.catalog.entries.flatMap((entry) => entry.category === "P4" ? [] : [{
    examId: entry.examId, category: entry.category, title: entry.title, frequency: entry.frequency,
    hasExplanation: Boolean(entry.explanation), filename: entry.file, pdfFilename: entry.pdf,
  }]);
  return Object.values(bank.assets).map(({ exam, explanation }) => ({
    examId: exam.examId,
    title: exam.meta.title,
    category: exam.meta.category,
    hasExplanation: Boolean(explanation),
  }));
}

// 2026-11-23：按题库身份归集正式提交，供进度和完整得分历史共用。
export function readingRecordsFor(
  bankId: string, records: PracticeRecord[], index: ReadingIndex | undefined, banks: { id: string; value: ImportedBank }[],
) {
  const result = new Map<string, PracticeRecord[]>();
  const addRecord = (id: string, record: PracticeRecord) => {
    const attempts = result.get(id);
    if (attempts) attempts.push(record);
    else result.set(id, [record]);
  };
  const bundled = new Map((index?.entries ?? []).map((entry) => [entry.examId, entry]));
  const target = banks.find((bank) => bank.id === bankId)?.value.catalog;
  const canonical = (id: string) => Object.hasOwn(index?.aliases ?? {}, id) ? index?.aliases[id] ?? id : id;
  const title = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  for (const record of records) {
    if (record.kind !== "reading" || !record.examId) continue;
    const id = canonical(record.examId);
    if (record.bankId === bankId) {
      const alias = bankId === MAIN_BANK ? id : Object.hasOwn(target?.aliases ?? {}, record.examId)
        ? target?.aliases?.[record.examId] ?? record.examId : record.examId;
      addRecord(alias, record);
      continue;
    }
    const official = bundled.get(id);
    // 2026-11-19：已知原版题库按源索引确认身份，旧记录才用保存标题交叉校验。
    if (!official) continue;
    const origin = banks.find((bank) => bank.id === record.bankId)?.value.catalog?.entries.find((item) => item.examId === id);
    const destination = target?.entries.find((item) => item.examId === id);
    const inOriginalCatalog = (item: typeof origin) => item && (item.kind === "generated" || item.kind === "converted")
      && title(item.title) === title(official.title);
    if ((record.bankId === MAIN_BANK || (record.source === "legacy" && title(record.title) === title(official.title)) || inOriginalCatalog(origin))
      && (bankId === MAIN_BANK || inOriginalCatalog(destination))) addRecord(id, record);
  }
  const submittedTime = (record: PracticeRecord) => {
    const time = Date.parse(record.submittedAt);
    return Number.isFinite(time) ? time : Number.MIN_SAFE_INTEGER;
  };
  for (const attempts of result.values()) {
    attempts.sort((a, b) => submittedTime(b) - submittedTime(a));
  }
  return result;
}

// 2026-11-19：内置词表入口固定读取 IELTS 核心资源。
// 2026-11-20：两份静态词表通过同一个选择入口加载。
export async function readWordList(list: Exclude<VocabularyListId, "reading"> = "ielts_core"): Promise<VocabularyWord[]> {
  if (list === "ielts_538") {
    // 2026-11-21：考点词仍按既有结构解析，源文件从词汇目录加载。
    return vocabularyPdfWords(await json<VocabularyPdfList>(vocabularyMedia("ielts_538.json")));
  }
  // 2026-11-20：核心词表和 AWL 都是词条数组，按词表标识读取。
  // 2026-11-21：核心词表与 AWL 使用独立的词汇数据路径。
  return json<VocabularyWord[]>(vocabularyMedia(`${list}.json`));
}
