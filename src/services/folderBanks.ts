// 2026-11-19：读取原版题库 manifest、预转换资料及可识别的本地 HTML。
import { useEffect, useState } from "react";
// 2026-11-19：阅读、听力在题库页打开时定期同步本机目录索引。
import { useQuery, useQueryClient } from "@tanstack/react-query";
// 2026-11-20：扫描听力时同时读取按册导出的精听资料。
import { discoverEntries, discoverListeningExports, findResource, legacyHtmlPapers, localImageRefs, parent, registeredJson, sourceEntries } from "../domain/bankSource";
import type { FolderCatalog, LocalEntry } from "../domain/bankSource";
import type { Explanation, ReadingAsset, ReadingExam, ReadingIndex } from "../domain/types";
import { desktop, desktopAvailable, documentsKey } from "./desktop";
import type { BankFolder } from "./desktop";

const registrant = /\.register\(\s*["'][^"']+["']\s*,\s*(\{)/;
const extension = (file: string) => file.slice(file.lastIndexOf(".") + 1).toLowerCase();
const formats: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
  aac: "audio/aac", flac: "audio/flac", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
};

function optionalObject<T>(text: string, pattern: RegExp) {
  try { return registeredJson<T>(text, pattern); } catch { return undefined; }
}

// 2026-11-19：口语直接读取文件，阅读和听力使用可复用的本机索引。
// 2026-11-21：阅读和听力持久化索引，口语和写作按本机文件加载。
type ExamBankKind = Extract<BankFolder["kind"], "reading" | "listening">;
interface CatalogDocument { title: string; catalog?: FolderCatalog }
export const folderRefreshInterval = 8_000;
const catalogKey = (kind: ExamBankKind) => kind === "reading" ? "banks" : "listening";

export async function importFolder(folder: BankFolder, previous?: FolderCatalog, force = false) {
  // 2026-11-20：口语资料提示指向新的侧栏名称。
  // 2026-11-21：本地口语资料的读取入口随口语题库移到真题组。
  if (folder.kind === "speaking") throw new Error("请在口语题库中读取口语资料。");
  // 2026-11-21：写作资料使用独立解析器，无需写入阅读或听力索引。
  if (folder.kind === "writing") throw new Error("请在写作题库中读取写作资料。");
  const scan = await desktop.scanBank(folder.id);
  // 2026-11-20：升级听力目录索引后重新识别已下载的题源。
  // 2026-11-21：升级图片、答案和解析读取后重新扫描原有听力目录。
  const revision = folder.kind === "listening" ? `listening-export-v2:${scan.revision}` : scan.revision;
  if (!force && previous && previous.revision === revision) return { count: previous.entries.length, skipped: scan.skipped, changed: false };
  const { files } = scan;
  let aliases: FolderCatalog["aliases"];
  let entries: LocalEntry[] = [];
  const reading = folder.kind === "reading";
  const converted = reading ? files.find((file) => /(?:^|\/)banks\/main\/index\.json$/i.test(file))
    ?? files.find((file) => /^index\.json$/i.test(file)) : undefined;
  if (converted) {
    const index = JSON.parse((await desktop.bankText(folder.id, converted)).replace(/^\uFEFF/, "")) as ReadingIndex;
    if (index.schemaVersion === "IETLS4PASSBankV1" && Array.isArray(index.entries)) {
      aliases = index.aliases;
      entries = index.entries.flatMap((entry): LocalEntry[] => {
        const file = findResource(files, `reading/${entry.examId}.json`, parent(converted));
        return file ? [{ ...entry, kind: "converted", file }] : [];
      });
    }
  }
  const directoryPattern = reading ? /(?:^|\/)reading-exams\/manifest\.js$/i : /(?:^|\/)listening-exams\/manifest\.js$/i;
  const manifest = files.find((file) => directoryPattern.test(file))
    ?? files.find((file) => /^manifest\.js$/i.test(file))
    ?? (!reading ? files.find((file) => /(?:^|\/)listening-index\.compat\.js$/i.test(file)) : undefined);
  if (!entries.length && manifest) {
    const text = await desktop.bankText(folder.id, manifest);
    const marker = reading ? /\bconst\s+manifest\s*=\s*(\{)/
      : /(?:__LISTENING_EXAM_MANIFEST__|listeningExamIndex)\s*=\s*([\[{])/;
    const data = optionalObject<Parameters<typeof sourceEntries>[0]>(text, marker);
    if (data) entries = sourceEntries(data, files, parent(manifest), folder.kind);
    if (reading) {
      aliases = optionalObject<FolderCatalog["aliases"]>(text, /\bRETIRED_EXAM_IDS\s*=\s*(\{)/);
      for (const entry of entries) {
        entry.explanation = files.find((file) => file.toLowerCase().endsWith(`reading-explanations/${entry.examId.toLowerCase()}.js`));
      }
    }
  }
  if (!entries.length) entries = await discoverEntries(files, folder.kind, folder.title);
  // 2026-11-20：导出资料可与原有目录题源共存。
  if (!reading) {
    const exported = await discoverListeningExports(files, folder.title, (file) => desktop.bankText(folder.id, file));
    const claimed = new Set(exported.flatMap(({ file, audio }) => [file, audio].filter(Boolean)));
    entries = [...entries.filter(({ file, audio }) => !claimed.has(file ?? audio)), ...exported];
  }
  // 2026-11-19：允许提前绑定空目录，文件清空时同步移除旧索引。
  if (!entries.length) {
    if (previous) await desktop.remove(catalogKey(folder.kind), folder.id);
    return { count: 0, skipped: scan.skipped, changed: Boolean(previous) };
  }
  // 2026-11-20：持久化与听力导出扫描规则对应的版本。
  const catalog: FolderCatalog = { title: scan.folder.title, folderId: folder.id, entries, files, aliases, revision };
  if (reading) await desktop.put("banks", folder.id, { title: catalog.title, assets: {}, catalog });
  else await desktop.put("listening", folder.id, { title: catalog.title, catalog });
  return { count: entries.length, skipped: scan.skipped, changed: true };
}

// 2026-11-19：题库刷新在页面可见时运行，同版本无需重新解析或更新 SQLite。
export function useFolderBankSync(kind: ExamBankKind, active = true) {
  const cache = useQueryClient();
  const category = catalogKey(kind);
  return useQuery({
    queryKey: ["local-bank-sync", kind], enabled: active && desktopAvailable(), retry: false,
    refetchInterval: folderRefreshInterval, refetchOnMount: "always", refetchOnWindowFocus: "always",
    queryFn: async () => {
      const [folders, documents] = await Promise.all([desktop.bankFolders(), desktop.documents<CatalogDocument>(category)]);
      const catalogs = new Map(documents.map(({ id, value }) => [id, value.catalog]));
      const results = await Promise.allSettled(folders.filter((folder) => folder.kind === kind).map(async (folder) => {
        const result = await importFolder(folder, catalogs.get(folder.id));
        if (result.changed) {
          await cache.invalidateQueries({ queryKey: kind === "reading" ? ["reading-asset", folder.id] : ["listening-asset", folder.id] });
        }
        return result.changed;
      }));
      if (results.some((result) => result.status === "fulfilled" && result.value)) await cache.invalidateQueries({ queryKey: documentsKey(category) });
      const errors = results.flatMap((result) => result.status === "rejected" ? [String(result.reason)] : []);
      return errors;
    },
  });
}

function referenceAsset(entry: LocalEntry): ReadingAsset {
  return {
    exam: {
      examId: entry.examId, meta: { title: entry.title, category: entry.category === "P4" ? "P3" : entry.category },
      passage: { blocks: [] }, questionGroups: [], questionOrder: [], answerKey: {},
    },
    explanation: null, pdfPath: entry.pdf, resourceOnly: true,
  };
}

export async function folderReadingAsset(catalog: FolderCatalog, requestedId: string): Promise<ReadingAsset> {
  const id = Object.hasOwn(catalog.aliases ?? {}, requestedId) ? catalog.aliases?.[requestedId] : requestedId;
  const entry = catalog.entries.find((item) => item.examId === id);
  if (!entry) throw new Error("当前目录索引中找不到这篇阅读。");
  if (!entry.file) return referenceAsset(entry);
  const text = await desktop.bankText(catalog.folderId, entry.file);
  if (entry.kind === "html") {
    const { papers, media } = legacyHtmlPapers(text, entry, catalog.files, "reading");
    return { exam: papers[0].exam, explanation: null, pdfPath: entry.pdf, localMedia: media, resourceOnly: !papers[0].graded };
  }
  const asset = entry.kind === "converted"
    ? JSON.parse(text.replace(/^\uFEFF/, "")) as ReadingAsset
    : { exam: registeredJson<ReadingExam>(text, registrant),
      explanation: entry.explanation ? registeredJson<Explanation>(await desktop.bankText(catalog.folderId, entry.explanation), registrant) : null };
  const { exam } = asset;
  if (exam.examId !== id || !Array.isArray(exam.questionOrder) || !Array.isArray(exam.questionGroups) || !Array.isArray(exam.passage?.blocks)) {
    throw new Error("登记数据与阅读索引不一致。");
  }
  const localMedia: Record<string, string> = {};
  const directory = parent(entry.file);
  const mediaDirectory = entry.kind === "converted" ? parent(directory) : directory;
  const convert = (html?: string) => html === undefined ? undefined : localImageRefs(html, catalog.files, mediaDirectory, localMedia);
  return {
    exam: {
      ...exam,
      passage: { blocks: exam.passage.blocks.map((block) => ({ ...block, html: convert(block.html) })) },
      questionGroups: exam.questionGroups.map((group) => ({ ...group, bodyHtml: convert(group.bodyHtml) ?? "", leadHtml: convert(group.leadHtml) })),
    },
    explanation: asset.explanation ?? null, localMedia, pdfPath: entry.pdf,
  };
}

export function useFolderMedia(id: string, resources?: Record<string, string>) {
  const serialized = JSON.stringify(resources ?? {});
  const key = `${id}:${serialized}`;
  const [result, setResult] = useState<{ key: string; urls: Record<string, string>; missing: string[] }>();
  useEffect(() => {
    const paths = Object.entries(JSON.parse(serialized) as Record<string, string>);
    if (!paths.length) return;
    const urls: Record<string, string> = {};
    const missing: string[] = [];
    let disposed = false;
    void Promise.all(paths.map(async ([name, path]) => {
      try {
        const bytes = await desktop.bankMedia(id, path);
        if (!disposed) urls[name] = URL.createObjectURL(new Blob([bytes], { type: formats[extension(path)] }));
      } catch { missing.push(path); }
    })).then(() => { if (!disposed) setResult({ key, urls, missing }); });
    return () => { disposed = true; Object.values(urls).forEach((url) => URL.revokeObjectURL(url)); };
  }, [id, key, serialized]);
  const current = result?.key === key ? result : undefined;
  return { loading: serialized !== "{}" && !current, urls: current?.urls, missing: current?.missing ?? [] };
}
