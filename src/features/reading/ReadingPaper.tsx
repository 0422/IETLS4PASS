// 2026-11-19：以双栏阅读界面承载上游题面，用 React 状态记录原位输入、选择及拖放。
import { useLayoutEffect, useRef } from "react";
// 2026-11-19：通过题面事件选择计时单位，并恢复原文高亮。
import type { Answer, Answers, PassageHighlight, ReadingExam } from "../../domain/types";
import { isCheckboxGroup } from "../../domain/scoring";
import { questionIds, readingFragment } from "./readingHtml";
import { paintHighlights } from "./passageHighlights";

const optionSelector = ".drag-item, .draggable-word, .card[draggable]";
const dropSelector = ".paragraph-dropzone, .match-dropzone, .drop-target-summary, .dropzone";
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
// 2026-11-27：听力交卷后可给实际填写的答案和选中的选项着色。
export type AnswerFeedback = (ids: string[], value: string, checkbox?: boolean) => "correct" | "incorrect" | undefined;

interface Props {
  exam: ReadingExam;
  answers: Answers;
  disabled: boolean;
  mediaUrl: (file: string) => string | undefined;
  onChange: (changes: Answers) => void;
  onCoverage: (missing: string[], timingMissing: string[]) => void;
  onSelection?: (ids: string[]) => void;
  highlights?: PassageHighlight[];
  // 2026-11-27：题面根据调用方提供的已保存判分展示颜色。
  answerFeedback?: AnswerFeedback;
}

const selection = (answer: Answer | undefined) => Array.isArray(answer) ? answer : answer ? [answer] : [];

export function ReadingPaper({ exam, answers, disabled, mediaUrl, onChange, onCoverage, onSelection, highlights, answerFeedback }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const passage = useRef<HTMLDivElement>(null);
  const groups = useRef<HTMLDivElement>(null);
  const latest = useRef({ onChange, onCoverage, disabled, onSelection });
  latest.current = { onChange, onCoverage, disabled, onSelection };

  useLayoutEffect(() => {
    const paper = root.current;
    const article = passage.current;
    const exercises = groups.current;
    if (!paper || !article || !exercises) return;
    const order = new Set(exam.questionOrder);
    const ready = new Set<string>();
    const timingReady = new Set<string>();
    const groupMap = new Map(exam.questionGroups.flatMap((group) => group.questionIds.map((id) => [id, group] as const)));
    // 2026-11-19：原文块提供稳定的高亮定位边界。
    article.replaceChildren(...exam.passage.blocks.map((block) => {
      const container = document.createElement("div");
      container.dataset.passageBlock = block.blockId;
      container.append(readingFragment(block.html ?? "", mediaUrl));
      return container;
    }));
    exercises.replaceChildren();
    for (const group of exam.questionGroups) {
      const section = document.createElement("section");
      section.className = "question-group";
      section.dataset.readingGroup = group.groupId;
      section.append(readingFragment(`${group.leadHtml ?? ""}${group.bodyHtml}`, mediaUrl));
      exercises.append(section);
    }

    for (const zone of paper.querySelectorAll<HTMLElement>(dropSelector)) {
      const id = questionIds(zone.dataset.question ?? zone.dataset.questionId ?? zone.dataset.target ?? zone.id, order)[0];
      if (!id) continue;
      const group = groupMap.get(id);
      if (!group) continue;
      const groupNode = exercises.querySelector(`[data-reading-group="${CSS.escape(group.groupId)}"]`);
      const items = [...(groupNode?.querySelectorAll<HTMLElement>(optionSelector) ?? [])];
      const options = new Map<string, string>();
      for (const item of items) {
        const label = item.textContent?.trim() ?? "";
        const { heading, option, key, word, value } = item.dataset;
        const token = heading || option || key || word || value || label;
        if (!token) continue;
        options.set(token, label || token);
        item.draggable = true;
        item.dataset.pickToken = token;
        item.dataset.pickGroup = group.groupId;
      }
      if (!options.size) continue;
      const select = document.createElement("select");
      select.name = id;
      select.dataset.dropGroup = group.groupId;
      select.dataset.reusable = String(group.allowOptionReuse !== false);
      select.append(new Option(`第 ${exam.questionDisplayMap?.[id] ?? id.slice(1)} 题`, ""));
      for (const [token, label] of options) select.append(new Option(label, token));
      zone.replaceChildren(select);
      zone.dataset.dropAnswer = id;
    }

    for (const field of paper.querySelectorAll<Field>("input, select, textarea")) {
      let ids = questionIds(field.name || field.dataset.questionId || field.dataset.question, order);
      if (!ids.length) ids = questionIds(field.id, order);
      if (ids.length > 1 && field instanceof HTMLInputElement && field.type === "checkbox") {
        const group = groupMap.get(ids[0]);
        if (group && isCheckboxGroup(group) && group.questionIds.length === 1) ids = [ids[0]];
      }
      if (!ids.length) {
        field.disabled = true;
        continue;
      }
      field.dataset.answerIds = ids.join(" ");
      const source = (field.name || field.dataset.questionId || field.dataset.question || field.id).replace(/^reading-/, "");
      if (/^q?\d+(?:[-_–]q?\d+)*(?:[-_](?:input|anchor|target))?$/i.test(source)) {
        field.dataset.timingIds = ids.join(" ");
        ids.forEach((id) => timingReady.add(id));
      }
      if (!field.getAttribute("aria-label")) {
        const label = ids.map((id) => exam.questionDisplayMap?.[id] ?? id.slice(1)).join("、");
        const choice = field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type)
          ? ` ${field.parentElement?.textContent?.trim() || field.value}` : "";
        field.setAttribute("aria-label", `第 ${label} 题${choice}`);
      }
      ids.forEach((id) => ready.add(id));
    }
    latest.current.onCoverage(exam.questionOrder.filter((id) => !ready.has(id)), exam.questionOrder.filter((id) => !timingReady.has(id)));
    let keyboardSelectionUntil = 0;
    function keyboard(event: KeyboardEvent) {
      if (event.isTrusted && event.key === "Tab") keyboardSelectionUntil = performance.now() + 350;
    }
    function selectFrom(event: Event) {
      if (!event.isTrusted || latest.current.disabled || !(event.target instanceof Element)) return;
      if (event.type === "focusin" && performance.now() > keyboardSelectionUntil) return;
      const target = event.target;
      const field = target.closest<HTMLElement>("[data-answer-ids]")
        ?? target.closest("label")?.querySelector<HTMLElement>("[data-answer-ids]");
      if (field) latest.current.onSelection?.(field.dataset.timingIds?.split(" ") ?? []);
      else if (article!.contains(target)) latest.current.onSelection?.([]);
    }

    function update(event: Event) {
      const field = event.target as Field;
      const ids = field?.dataset?.answerIds?.split(" ");
      if (!ids || latest.current.disabled) return;
      if (event.isTrusted) latest.current.onSelection?.(field.dataset.timingIds?.split(" ") ?? []);
      const radio = field instanceof HTMLInputElement && field.type === "radio";
      const check = field instanceof HTMLInputElement && field.type === "checkbox";
      if (radio && !field.checked) return;
      if (check) {
        const checked = [...paper!.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")]
          .filter((candidate) => candidate.name === field.name).map((candidate) => candidate.value);
        latest.current.onChange(Object.fromEntries(ids.map((id) => [id, checked])));
        return;
      }
      latest.current.onChange({ [ids[0]]: field.value });
    }

    let dragged: { group: string; token: string } | null = null;
    function dragStart(event: DragEvent) {
      const item = (event.target as HTMLElement).closest<HTMLElement>("[data-pick-token]");
      if (!item || latest.current.disabled) return;
      dragged = { group: item.dataset.pickGroup ?? "", token: item.dataset.pickToken ?? "" };
      event.dataTransfer?.setData("text/plain", dragged.token);
    }
    function dropTarget(event: DragEvent) {
      const zone = (event.target as HTMLElement).closest("[data-drop-answer]");
      const select = zone?.querySelector("select");
      return !latest.current.disabled && select && dragged && select.dataset.dropGroup === dragged.group ? select : null;
    }
    function dragOver(event: DragEvent) {
      if (dropTarget(event)) event.preventDefault();
    }
    function drop(event: DragEvent) {
      const field = dropTarget(event);
      if (!field || !dragged) return;
      event.preventDefault();
      if ([...field.options].some((option) => option.value === dragged?.token && !option.disabled)) {
        latest.current.onSelection?.(field.dataset.timingIds?.split(" ") ?? []);
        field.value = dragged.token;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      dragged = null;
    }
    function dragEnd() { dragged = null; }

    paper.addEventListener("input", update);
    paper.addEventListener("pointerdown", selectFrom);
    paper.addEventListener("focusin", selectFrom);
    window.addEventListener("keydown", keyboard, true);
    paper.addEventListener("dragstart", dragStart);
    paper.addEventListener("dragover", dragOver);
    paper.addEventListener("drop", drop);
    paper.addEventListener("dragend", dragEnd);
    return () => {
      paper.removeEventListener("input", update);
      paper.removeEventListener("pointerdown", selectFrom);
      paper.removeEventListener("focusin", selectFrom);
      window.removeEventListener("keydown", keyboard, true);
      paper.removeEventListener("dragstart", dragStart);
      paper.removeEventListener("dragover", dragOver);
      paper.removeEventListener("drop", drop);
      paper.removeEventListener("dragend", dragEnd);
    };
  }, [exam, mediaUrl]);

  // 2026-11-19：高亮更新仅改变原文文字包裹，保持已有作答控件。
  useLayoutEffect(() => {
    if (passage.current) paintHighlights(passage.current, highlights ?? []);
  }, [highlights, exam, mediaUrl]);

  useLayoutEffect(() => {
    const fields = root.current?.querySelectorAll<Field>("[data-answer-ids]");
    if (!fields) return;
    const usedByGroup = new Map<string, Set<string>>();
    // 2026-11-27：分开排版的选项标签也跟随对应控件着色。
    const feedbackLabels = new Set<HTMLLabelElement>();
    for (const field of fields) {
      const ids = field.dataset.answerIds?.split(" ") ?? [];
      const id = ids[0] ?? "";
      const values = selection(answers[id]);
      field.disabled = disabled;
      if (field instanceof HTMLInputElement && ["radio", "checkbox"].includes(field.type)) {
        field.checked = values.includes(field.value);
      } else if (field.value !== (values[0] ?? "")) field.value = values[0] ?? "";
      // 2026-11-27：只给已有输入或已选项着色，原题未选选项保持可读。
      if (answerFeedback) {
        const checkbox = field instanceof HTMLInputElement && field.type === "checkbox";
        const choice = checkbox || (field instanceof HTMLInputElement && field.type === "radio");
        const feedback = (choice ? field instanceof HTMLInputElement && field.checked : field.value.trim())
          ? answerFeedback(ids, field.value, checkbox) : undefined;
        if (feedback) {
          field.dataset.answerFeedback = feedback;
          if (choice && field instanceof HTMLInputElement) {
            for (const label of field.labels ?? []) {
              label.dataset.answerFeedback = feedback;
              feedbackLabels.add(label);
            }
          }
        } else delete field.dataset.answerFeedback;
      }
      const group = field.dataset.dropGroup;
      if (group && field.value) {
        if (!usedByGroup.has(group)) usedByGroup.set(group, new Set());
        usedByGroup.get(group)?.add(field.value);
      }
    }
    for (const field of fields) {
      if (!(field instanceof HTMLSelectElement) || field.dataset.reusable !== "false") continue;
      const used = usedByGroup.get(field.dataset.dropGroup ?? "");
      for (const option of field.options) option.disabled = option.value !== field.value && Boolean(used?.has(option.value));
    }
    // 2026-11-27：重建题面和切换练习状态时移除上一份判分标记。
    if (answerFeedback) return () => {
      fields.forEach((field) => { delete field.dataset.answerFeedback; });
      feedbackLabels.forEach((label) => { delete label.dataset.answerFeedback; });
    };
  }, [answers, disabled, exam, mediaUrl, answerFeedback]);

  return <div className="reading-paper" ref={root}>
    <article className="passage-paper paper-column" ref={passage} tabIndex={0} aria-label="阅读原文" />
    <div className="question-paper paper-column" ref={groups} aria-label="题目和答题控件" />
  </div>;
}
