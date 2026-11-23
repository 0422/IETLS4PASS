// 2026-11-19：为阅读草稿及回放提供原文高亮、题目标记和纯文本笔记。
import type { ReadingAnnotations } from "../../domain/types";

export const emptyAnnotations: ReadingAnnotations = { notes: "", markedQuestions: [], highlights: [] };

export function ReadingNotes({ value, onNotes, onClearHighlight, onUnallocate, onSave, disabled }: {
  value: ReadingAnnotations;
  onNotes: (notes: string) => void;
  onClearHighlight: (index: number) => void;
  onUnallocate?: () => void;
  onSave?: () => void;
  disabled?: boolean;
}) {
  return <details className="card reading-notes" onPointerDown={onUnallocate} onFocus={onUnallocate}>
    <summary>我的阅读批注 · {value.markedQuestions.length} 个题目标记 · {value.highlights.length} 处高亮</summary>
    <label>阅读笔记<textarea value={value.notes} onChange={(event) => onNotes(event.target.value)} disabled={disabled}
      rows={3} maxLength={20_000} placeholder="记录生词、解题思路或需要复习的段落" /></label>
    {value.highlights.length > 0 && <ul>{value.highlights.map((highlight, index) => <li key={`${highlight.blockId}:${highlight.start}:${highlight.end}`}>
      <span>{highlight.text}</span><button className="text-button" type="button" disabled={disabled} onClick={() => onClearHighlight(index)}>清除</button>
    </li>)}</ul>}
    {onSave && <button type="button" className="button secondary" disabled={disabled} onClick={onSave}>保存回放批注</button>}
  </details>;
}
