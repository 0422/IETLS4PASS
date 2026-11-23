// 2026-11-21：复用本机题库扫描与文件修订号，打开写作题库即可读取增量资料。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseWritingQuestion, writingFileTask } from "../domain/writing";
// 2026-11-23：写作作答页和总览订阅同一份已提交作文。
import type { WritingQuestion, WritingSubmission } from "../domain/writing";
import { desktop, desktopAvailable, documentsKey, errorText } from "./desktop";
import { folderRefreshInterval } from "./folderBanks";

export const writingCatalogKey = ["writing-catalog"] as const;
export const writingSubmissionsKey = documentsKey("writing-submissions");

// 2026-11-23：只有桌面端读取 SQLite 中的作文记录。
export function useWritingSubmissions() {
  return useQuery({ queryKey: writingSubmissionsKey, queryFn: () => desktop.documents<WritingSubmission>("writing-submissions"), enabled: desktopAvailable() });
}

interface WritingFolder {
  id: string;
  revision: string;
  files: string[];
  questions: WritingQuestion[];
  problems: string[];
}

export function useWritingCatalog(browsing: boolean) {
  const cache = useQueryClient();
  return useQuery({
    queryKey: writingCatalogKey,
    enabled: desktopAvailable(),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: browsing,
    refetchInterval: browsing ? folderRefreshInterval : false,
    queryFn: async (): Promise<WritingFolder[]> => {
      const folders = (await desktop.bankFolders()).filter((folder) => folder.kind === "writing");
      const previous = new Map(cache.getQueryData<WritingFolder[]>(writingCatalogKey)?.map((folder) => [folder.id, folder]));
      return Promise.all(folders.map(async ({ id, title }): Promise<WritingFolder> => {
        const prior = previous.get(id);
        try {
          const scan = await desktop.scanBank(id);
          if (prior && prior.revision === scan.revision) return prior;
          const results = await Promise.all(scan.files.filter(writingFileTask).map(async (file) => {
            try {
              const data: unknown = JSON.parse((await desktop.bankText(id, file)).replace(/^\uFEFF/, ""));
              return { question: parseWritingQuestion(data, file) };
            } catch (reason) {
              return { problem: `${file} · ${errorText(reason)}` };
            }
          }));
          return { id, files: scan.files, revision: scan.revision, questions: results.flatMap(({ question }) => question ?? []),
            problems: results.flatMap(({ problem }) => problem ?? []) };
        } catch (reason) {
          return { id, revision: "", files: prior?.files ?? [], questions: prior?.questions ?? [], problems: [`${title} · ${errorText(reason)}`] };
        }
      }));
    },
  });
}
