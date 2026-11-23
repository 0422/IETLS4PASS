// 2026-11-23：系统页显示每类资源的有效目录，允许单独替换或恢复默认。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { desktop, desktopAvailable, documentsKey, errorText } from "../services/desktop";
import type { ResourceDirectory, ResourceDirectoryKind } from "../services/desktop";
import { importFolder } from "../services/folderBanks";
import { notifyKokoroDirectoryChanged } from "../services/resourceDirectories";

const directoriesKey = ["resource-directories"] as const;
const labels: Record<ResourceDirectoryKind, string> = {
  reading: "阅读练习",
  listening: "听力真题",
  speaking: "口语真题",
  writing: "写作真题",
  vocabulary: "词表与查词",
  notes: "课程笔记",
  prompts: "Prompt 文档",
  kokoro: "Kokoro 模型",
};
const affectedQueries: Record<ResourceDirectoryKind, readonly (readonly string[])[]> = {
  reading: [["reading-index"], ["reading-asset", "main"]],
  listening: [["bank-folders"], ["local-bank-sync", "listening"], documentsKey("listening"), ["listening-asset"]],
  speaking: [["bank-folders"], ["speaking-catalog"]],
  writing: [["bank-folders"], ["writing-catalog"]],
  vocabulary: [["words"], ["reading-ecdict"]],
  notes: [["course-notes"], ["course-note"]],
  prompts: [["prompt-documents"], ["prompt-document"]],
  kokoro: [],
};

export function ResourceDirectories() {
  const cache = useQueryClient();
  const enabled = desktopAvailable();
  const directories = useQuery({ queryKey: directoriesKey, queryFn: desktop.resourceDirectories, enabled });
  const change = useMutation({
    mutationFn: ({ kind, reset }: { kind: ResourceDirectoryKind; reset: boolean }) =>
      reset ? desktop.resetResourceDirectory(kind) : desktop.chooseResourceDirectory(kind),
    onSuccess: async (directory) => {
      if (!directory) return;
      cache.setQueryData<ResourceDirectory[]>(directoriesKey, (current) => current?.map((item) => item.kind === directory.kind ? directory : item));
      if (directory.kind === "kokoro") notifyKokoroDirectoryChanged();
      try {
        // 2026-11-23：在返回听力详情前重建索引，使原题号的续做链接仍能解析。
        if (directory.kind === "listening") {
          const folders = (await desktop.bankFolders()).filter(({ kind }) => kind === "listening");
          for (const folder of folders) await importFolder(folder, undefined, true);
        }
      } finally {
        await Promise.all(affectedQueries[directory.kind].map((queryKey) => cache.resetQueries({ queryKey })));
      }
    },
  });
  const error = errorText(change.error || directories.error || "");
  return <section className="card settings-card resource-directories">
    <h2>资源目录</h2>
    {!enabled && <p className="muted">请在桌面应用中管理资源目录。</p>}
    {directories.isLoading && <p role="status">正在读取资源目录…</p>}
    {error && <p className="notice danger" role="alert">{error}</p>}
    <ul className="resource-directory-list">
      {directories.data?.map((item) => <li key={item.kind} className="resource-directory-row">
        <div>
          <strong id={`resource-${item.kind}`}>{labels[item.kind]}</strong>
          {!item.available && <small className="muted">{item.bundled ? " · 当前使用内置资源" : " · 目录尚不可用"}</small>}
          <div className="resource-directory-path" title={item.path}>{item.path}</div>
          {item.overridden && <div className="muted resource-directory-path" title={item.defaultPath}>默认 {item.defaultPath}</div>}
        </div>
        <div className="table-actions" role="group" aria-labelledby={`resource-${item.kind}`}>
          <button type="button" className="button secondary" disabled={change.isPending}
            onClick={() => change.mutate({ kind: item.kind, reset: false })}><FolderOpen size={16} aria-hidden="true" />更改目录</button>
          <button type="button" className="text-button" disabled={change.isPending || !item.overridden}
            onClick={() => change.mutate({ kind: item.kind, reset: true })}>恢复默认</button>
        </div>
      </li>)}
    </ul>
  </section>;
}
