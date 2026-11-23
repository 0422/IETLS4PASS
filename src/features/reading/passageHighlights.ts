// 2026-11-19：按原文块与精确的文字偏移保存高亮，恢复前核对原文。
import type { PassageHighlight } from "../../domain/types";
// 2026-11-23：听力题面通过 CSS 范围呈现高亮，保留题目控件的 DOM。
import { textRange } from "./readingHtml";

// 2026-11-23：原文和听力题目用各自稳定的属性识别文字所在块。
export function selectedHighlight(root: HTMLElement, blockAttribute = "data-passage-block"): PassageHighlight | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return undefined;
  const range = selection.getRangeAt(0);
  const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  // 2026-11-23：以调用方指定的题组、题干或原文块作为选区边界。
  const block = element?.closest<HTMLElement>(`[${blockAttribute}]`);
  if (!block || !root.contains(block) || !block.contains(range.endContainer)) return undefined;
  const text = range.toString();
  if (!text.trim() || text.length > 500) return undefined;
  const preceding = document.createRange();
  preceding.selectNodeContents(block);
  preceding.setEnd(range.startContainer, range.startOffset);
  const start = preceding.toString().length;
  // 2026-11-23：从对应的区域属性获取高亮保存标识。
  return { blockId: block.getAttribute(blockAttribute) ?? "", start, end: start + text.length, text };
}

// 2026-11-23：核对题面的文字和偏移，题源更新后跳过无法定位的旧高亮。
export function highlightRanges(root: HTMLElement, blockAttribute: string, annotations: PassageHighlight[]) {
  const blocks = new Map([...root.querySelectorAll<HTMLElement>(`[${blockAttribute}]`)].map((block) =>
    [block.getAttribute(blockAttribute), block] as const));
  return annotations.flatMap(({ blockId, start, end, text }) => {
    const block = blocks.get(blockId);
    if (!block || start < 0 || end <= start || !Number.isInteger(start) || !Number.isInteger(end)
      || block.textContent?.slice(start, end) !== text) return [];
    const range = textRange(block, start, end);
    return range ? [range] : [];
  });
}

// 2026-11-23：从同一原文块的所有重叠高亮中减去选区，保留选区两侧的文字和偏移。
export function removeHighlightRange(annotations: PassageHighlight[], { blockId, start, end }: PassageHighlight) {
  let changed = false;
  const remaining = annotations.flatMap((highlight) => {
    if (highlight.blockId !== blockId || highlight.end <= start || highlight.start >= end) return [highlight];

    changed = true;
    const pieces: PassageHighlight[] = [];
    if (highlight.start < start) {
      pieces.push({ ...highlight, end: start, text: highlight.text.slice(0, start - highlight.start) });
    }
    if (highlight.end > end) {
      pieces.push({ ...highlight, start: end, text: highlight.text.slice(end - highlight.start) });
    }
    return pieces;
  });
  if (!changed) return annotations;

  // 2026-11-23：原有重叠标记剪裁后可能产生相同片段，批注列表只保留一份。
  const seen = new Set<string>();
  return remaining.filter((highlight) => {
    if (highlight.blockId !== blockId) return true;
    const key = `${highlight.start}:${highlight.end}:${highlight.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function paintHighlights(root: HTMLElement, annotations: PassageHighlight[]) {
  const parents = new Set<Node>();
  for (const mark of root.querySelectorAll("mark[data-saved-highlight]")) {
    if (mark.parentNode) parents.add(mark.parentNode);
    mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  }
  parents.forEach((parent) => parent.normalize());
  for (const block of root.querySelectorAll<HTMLElement>("[data-passage-block]")) {
    const text = block.textContent ?? "";
    const spans: [number, number][] = annotations
      .filter(({ blockId, start, end, text: selection }) => blockId === block.dataset.passageBlock
        && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && text.slice(start, end) === selection)
      .map(({ start, end }) => [start, end]);
    if (!spans.length) continue;
    const merged: [number, number][] = [];
    for (const span of spans.sort(([a], [b]) => a - b)) {
      const previous = merged[merged.length - 1];
      if (previous && previous[1] >= span[0]) previous[1] = Math.max(previous[1], span[1]);
      else merged.push(span);
    }
    const iterator = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; offset: number }[] = [];
    let offset = 0;
    for (let node = iterator.nextNode() as Text | null; node; node = iterator.nextNode() as Text | null) {
      nodes.push({ node, offset });
      offset += node.length;
    }
    for (const { node, offset: start } of nodes) {
      const end = start + node.length;
      for (const [left, right] of [...merged].reverse()) {
        if (left >= end || right <= start) continue;
        const from = Math.max(start, left) - start;
        const to = Math.min(end, right) - start;
        if (to < node.length) node.splitText(to);
        const selected = node.splitText(from);
        const mark = document.createElement("mark");
        mark.dataset.savedHighlight = "true";
        selected.replaceWith(mark);
        mark.append(selected);
      }
    }
  }
}
