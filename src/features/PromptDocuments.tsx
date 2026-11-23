// 2026-11-22：使用与课程笔记一致的双栏布局，编辑可热更新的 Markdown 提示词。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { desktop, desktopAvailable, errorText } from "../services/desktop";
import type { CourseNote } from "../services/desktop";
import { NoteMarkdown } from "./NoteMarkdown";

const promptsKey = ["prompt-documents"] as const;
const promptKey = (id: string) => ["prompt-document", id] as const;
type Draft = CourseNote & { id: string };

export function PromptDocuments() {
  const enabled = desktopAvailable();
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [notice, setNotice] = useState("");
  const list = useQuery({ queryKey: promptsKey, queryFn: desktop.listPrompts, enabled });
  const selected = list.data?.find(({ id }) => id === selectedId) ?? list.data?.[0];
  const id = selected?.id ?? "";
  const document = useQuery({ queryKey: promptKey(id), queryFn: () => desktop.readPrompt(id), enabled: enabled && Boolean(id) });
  const save = useMutation({
    mutationFn: ({ id, content, revision }: Draft) => desktop.savePrompt(id, content, revision),
    onSuccess: async (value, edited) => {
      await cache.cancelQueries({ queryKey: promptKey(edited.id), exact: true });
      cache.setQueryData(promptKey(edited.id), value);
      setDraft(undefined);
      setNotice("已保存。");
    },
  });
  const currentDraft = draft?.id === id ? draft : undefined;
  const error = list.error || document.error || save.error;

  function discardDraft() {
    if (currentDraft && currentDraft.content !== document.data?.content && !window.confirm("放弃未保存的修改？")) return false;
    setDraft(undefined);
    setNotice("");
    save.reset();
    return true;
  }

  return <div className="course-notes">
    {!enabled && <p className="notice course-notes-status">请在桌面应用中编辑 Prompt 文档。</p>}
    {error && <p className="notice danger course-notes-status" role="alert">{errorText(error)}</p>}
    {notice && <p className="notice course-notes-status" role="status">{notice}</p>}
    <div className="course-notes-layout">
      <section className="card course-notes-sidebar" aria-label="Prompt 文档列表">
        {enabled && list.isLoading && <p className="muted" role="status">正在读取文档…</p>}
        <ul className="course-notes-items">
          {list.data?.map((entry) => <li key={entry.id} className="vocabulary-list-entry">
            <button className="vocabulary-list-select" type="button" aria-pressed={entry.id === id}
              disabled={save.isPending} onClick={() => {
                if (entry.id === id || !discardDraft()) return;
                setSelectedId(entry.id);
              }}>{entry.title}</button>
          </li>)}
        </ul>
      </section>
      <section className="card course-note-detail" aria-label="Prompt 文档正文">
        {selected ? <>
          <header className="section-heading">
            <h2>{selected.title}</h2>
            <div className="table-actions">
              {currentDraft ? <>
                <button className="button secondary" type="button" disabled={save.isPending} onClick={() => {
                  if (discardDraft()) void document.refetch();
                }}>取消</button>
                <button className="button primary" type="button" disabled={save.isPending} onClick={() => {
                  setNotice("");
                  save.mutate(currentDraft);
                }}>保存</button>
              </> : <button className="button secondary" type="button" disabled={!document.data || save.isPending} onClick={() => {
                if (!document.data) return;
                setNotice("");
                setDraft({ ...document.data, id });
              }}>编辑</button>}
            </div>
          </header>
          {currentDraft ? <textarea className="course-note-editor" aria-label="Markdown 提示词正文" value={currentDraft.content}
            disabled={save.isPending} onChange={(event) => setDraft({ ...currentDraft, content: event.currentTarget.value })} />
            : document.isLoading ? <p className="muted" role="status">正在读取正文…</p>
              : document.data?.content.trim() ? <NoteMarkdown content={document.data.content} />
                : document.data && <p className="muted">暂无内容。</p>}
        </> : enabled && !list.isLoading && <p className="muted">暂无文档。</p>}
      </section>
    </div>
  </div>;
}
