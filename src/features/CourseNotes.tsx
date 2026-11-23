// 2026-11-21：左侧浏览本机笔记，右侧预览或编辑 Markdown。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { desktop, desktopAvailable, errorText } from "../services/desktop";
import type { CourseNote, CourseNoteEntry } from "../services/desktop";
import { NoteMarkdown } from "./NoteMarkdown";
import { placeListMenu } from "./VocabularyBrowser";

const notesKey = ["course-notes"] as const;
const noteKey = (id: string) => ["course-note", id] as const;
type Draft = CourseNote & { id: string };

export function CourseNotes() {
  const enabled = desktopAvailable();
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [notice, setNotice] = useState("");
  const list = useQuery({ queryKey: notesKey, queryFn: desktop.listCourseNotes, enabled });
  const selected = list.data?.find(({ id }) => id === selectedId) ?? list.data?.[0];
  const id = selected?.id ?? "";
  const note = useQuery({ queryKey: noteKey(id), queryFn: () => desktop.readCourseNote(id), enabled: enabled && Boolean(id) });
  const create = useMutation({
    mutationFn: desktop.createCourseNote,
    onSuccess: async (entry) => {
      // 2026-11-21：窗口恢复焦点可能同时刷新列表，按文件名合并新笔记。
      cache.setQueryData<CourseNoteEntry[]>(notesKey, (items) => [...(items ?? []).filter((item) => item.id !== entry.id), entry]);
      setSelectedId(entry.id);
      setCreating(false);
      setTitle("");
      setNotice("");
      await cache.invalidateQueries({ queryKey: notesKey });
    },
  });
  const save = useMutation({
    mutationFn: (entry: Draft) => desktop.saveCourseNote(entry.id, entry.content, entry.revision),
    onSuccess: (value, entry) => {
      cache.setQueryData(noteKey(entry.id), value);
      setDraft(undefined);
      setNotice("已保存。");
    },
  });
  const remove = useMutation({
    mutationFn: desktop.deleteCourseNote,
    onSuccess: async (_, deletedId) => {
      cache.setQueryData<CourseNoteEntry[]>(notesKey, (items) => items?.filter((entry) => entry.id !== deletedId));
      cache.removeQueries({ queryKey: noteKey(deletedId), exact: true });
      setSelectedId((current) => current === deletedId ? undefined : current);
      setDraft((current) => current?.id === deletedId ? undefined : current);
      setNotice("已删除。");
      await cache.invalidateQueries({ queryKey: notesKey });
    },
  });
  const error = list.error || note.error || create.error || save.error || remove.error;
  const busy = create.isPending || save.isPending || remove.isPending;
  const currentDraft = draft?.id === id ? draft : undefined;

  function discardDraft() {
    if (currentDraft && currentDraft.content !== note.data?.content && !window.confirm("放弃未保存的编辑？")) return false;
    setDraft(undefined);
    save.reset();
    setNotice("");
    return true;
  }

  return <div className="course-notes">
    {!enabled && <p className="notice course-notes-status">请在桌面应用中使用课程笔记。</p>}
    {error && <p className="notice danger course-notes-status" role="alert">{errorText(error)}</p>}
    {notice && <p className="notice course-notes-status" role="status">{notice}</p>}
    <div className="course-notes-layout">
      <section className="card course-notes-sidebar" aria-label="课程笔记列表">
        <button className="button secondary course-note-add" type="button" disabled={!enabled || busy || creating} onClick={() => {
          if (!discardDraft()) return;
          create.reset();
          remove.reset();
          setCreating(true);
        }}><Plus size={16} aria-hidden="true" />新增笔记</button>
        {creating && <form className="course-note-create" onSubmit={(event) => { event.preventDefault(); create.mutate(title); }}>
          <input aria-label="笔记标题" placeholder="笔记标题" value={title} required maxLength={120}
            disabled={busy} onChange={(event) => setTitle(event.currentTarget.value)} />
          <div className="table-actions">
            <button className="button primary" type="submit" disabled={busy}>创建</button>
            <button className="button secondary" type="button" disabled={busy} onClick={() => { setCreating(false); create.reset(); }}>取消</button>
          </div>
        </form>}
        {enabled && list.isLoading && <p className="muted" role="status">正在读取笔记…</p>}
        {enabled && list.data?.length === 0 && <p className="muted">暂无笔记。</p>}
        <ul className="course-notes-items" onScroll={(event) => {
          event.currentTarget.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => { menu.open = false; });
        }}>
          {list.data?.map((entry) => <li key={entry.id} className="vocabulary-list-entry">
            <button className="vocabulary-list-select" type="button" aria-pressed={entry.id === id} disabled={busy} onClick={() => {
              if (entry.id === id || !discardDraft()) return;
              setSelectedId(entry.id);
            }}>{entry.title}</button>
            <details className="vocabulary-word-menu" onToggle={(event) => placeListMenu(event.currentTarget, ".course-notes-items")}
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !event.currentTarget.open) return;
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus({ preventScroll: true });
              }}>
              <summary aria-label={`${entry.title} 的操作`}><MoreHorizontal size={16} aria-hidden="true" /></summary>
              <div className="vocabulary-word-menu-pop">
                <button type="button" disabled={busy} onClick={(event) => {
                  const menu = event.currentTarget.closest("details");
                  if (menu) menu.open = false;
                  if (window.confirm(`删除笔记「${entry.title}」及其 Markdown 文件？`)) {
                    save.reset();
                    setNotice("");
                    remove.mutate(entry.id);
                  }
                }}><Trash2 size={14} aria-hidden="true" />删除笔记</button>
              </div>
            </details>
          </li>)}
        </ul>
      </section>
      <section className="card course-note-detail" aria-label="笔记内容">
        {selected ? <>
          <header className="section-heading">
            <h2>{selected.title}</h2>
            <div className="table-actions">
              {currentDraft ? <>
                <button className="button secondary" type="button" disabled={busy} onClick={discardDraft}>取消</button>
                <button className="button primary" type="button" disabled={busy} onClick={() => { setNotice(""); save.mutate(currentDraft); }}>保存</button>
              </> : <button className="button secondary" type="button" disabled={busy || !note.data} onClick={() => {
                if (note.data) { setNotice(""); setDraft({ ...note.data, id }); }
              }}>编辑</button>}
            </div>
          </header>
          {currentDraft ? <textarea className="course-note-editor" aria-label="Markdown 笔记正文" value={currentDraft.content} disabled={busy}
            onChange={(event) => setDraft({ ...currentDraft, content: event.currentTarget.value })} />
            : note.isLoading ? <p className="muted" role="status">正在读取正文…</p>
              : note.data?.content.trim() ? <NoteMarkdown content={note.data.content} />
                : note.data && <p className="muted">暂无内容。</p>}
        </> : <p className="muted">请选择笔记。</p>}
      </section>
    </div>
  </div>;
}
