// 2026-11-27：共用听力题面与原文的高亮操作，将回看和精听批注保存在本机。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import type { PassageHighlight } from "../domain/types";
import { desktop, documentsKey, errorText } from "../services/desktop";
import type { Document } from "../services/desktop";
import { highlightRanges, removeHighlightRange, selectedHighlight } from "./reading/passageHighlights";

const collection = "listening-highlights";
const key = documentsKey(collection);
export const emptyListeningHighlights: PassageHighlight[] = [];

export function useSavedListeningHighlights(id: string | undefined, initial = emptyListeningHighlights) {
  const cache = useQueryClient();
  const documents = useQuery({
    queryKey: key,
    queryFn: () => desktop.documents<PassageHighlight[]>(collection),
    enabled: Boolean(id),
  });
  const save = useMutation({
    mutationFn: ({ id, value }: { id: string; value: PassageHighlight[] }) => desktop.put(collection, id, value),
    onMutate: () => cache.cancelQueries({ queryKey: key }),
    onSuccess: (_, { id, value }) => {
      cache.setQueryData<Document<PassageHighlight[]>[]>(key, (items) => [
        ...(items ?? []).filter((item) => item.id !== id), { collection, id, value },
      ]);
    },
  });
  const pending = save.isPending && save.variables?.id === id ? save.variables?.value : undefined;
  return {
    highlights: pending ?? documents.data?.find((document) => document.id === id)?.value ?? initial,
    disabled: !id || !documents.data || save.isPending,
    problem: documents.error || save.error ? errorText(documents.error ?? save.error) : "",
    update: (value: PassageHighlight[]) => { if (id) save.mutate({ id, value }); },
  };
}

// 2026-11-27：CSS 高亮独立于控件和当前播放句的选中效果。
export function useListeningHighlightPaint(root: RefObject<HTMLElement>, block: string, highlights: PassageHighlight[],
  content: unknown, media?: unknown) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || typeof Highlight !== "function" || !CSS.highlights || !highlights.length) return;
    const name = block === "data-listening-sentence" ? "listening-transcript-text" : "listening-question-text";
    CSS.highlights.set(name, new Highlight(...highlightRanges(element, block, highlights)));
    return () => { CSS.highlights.delete(name); };
  }, [root, block, highlights, content, media]);
}

// 2026-11-27：题面与精听原文分别保存高亮，工具栏根据当前选区选择目标。
export interface ListeningHighlightTarget {
  root: RefObject<HTMLElement>; block: string; highlights: PassageHighlight[];
  update: (highlights: PassageHighlight[]) => void; disabled?: boolean; problem?: string;
}

// 2026-11-27：点击工具栏时保留选区，取消操作只清除所选范围。
export function ListeningHighlightActions({ targets, label }: {
  targets: ListeningHighlightTarget[]; label: string;
}) {
  const [message, setMessage] = useState("");
  const locked = typeof Highlight !== "function" || targets.every((target) => target.disabled);
  const canRemove = targets.some((target) => !target.disabled && target.highlights.length > 0);
  function change(action: "add" | "remove") {
    for (const { root, block, highlights, update, disabled } of targets) {
      const selection = root.current && selectedHighlight(root.current, block);
      if (!selection) continue;
      if (disabled) {
        setMessage("当前区域的高亮暂不可编辑。");
        return;
      }
      setMessage("");
      window.getSelection()?.removeAllRanges();
      if (action === "add" && highlights.some(({ blockId, start, end, text }) => blockId === selection.blockId
        && start === selection.start && end === selection.end && text === selection.text)) return;
      const next = action === "add" ? [...highlights, selection] : removeHighlightRange(highlights, selection);
      if (next !== highlights) update(next);
      return;
    }
    setMessage("请在同一段文字内选中要操作的内容。");
  }
  return <div className="table-actions listening-annotation-actions" role="group" aria-label={label}>
    <button type="button" className="button secondary" disabled={locked} onPointerDown={(event) => event.preventDefault()}
      onClick={() => change("add")}>高亮所选文字</button>
    <button type="button" className="button secondary" disabled={locked || !canRemove} onPointerDown={(event) => event.preventDefault()}
      onClick={() => change("remove")}>取消所选高亮</button>
    {message && <span className="muted" role="status">{message}</span>}
    {/* 2026-11-27：共用存储错误只提示一次。 */}
    {[...new Set(targets.flatMap(({ problem }) => problem ? [problem] : []))].map((problem) =>
      <span key={problem} className="negative" role="status">{problem}</span>)}
  </div>;
}
