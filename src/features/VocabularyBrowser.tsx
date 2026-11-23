// 2026-11-20：以分页词表浏览和编辑词条，列表和详情共用原词条标识。
import { useState } from "react";
// 2026-11-20：通过分页表单接收键盘提交。
import type { FormEvent } from "react";
// 2026-11-20：词条的更多操作沿用浮层菜单的省略号与删除图标。
import { MoreHorizontal, Trash2 } from "lucide-react";
import type { Word } from "../domain/types";
import type { VocabularyEdit, VocabularyEntry } from "../domain/vocabulary";

const pageSize = 20;
type WordForm = { id: string; word: string; meaning: string; example: string; freq: string; phonetic: string };

// 2026-11-20：计算菜单在列表可见区域内的方向，避免底部条目的操作被裁切。
// 2026-11-21：课程笔记复用词汇列表的更多操作浮层定位。
export function placeListMenu(menu: HTMLDetailsElement, listSelector = ".vocabulary-list-entries") {
  if (!menu.open) {
    delete menu.dataset.placement;
    return;
  }
  // 2026-11-21：按当前列表滚动容器判断浮层方向。
  const list = menu.closest(listSelector)?.getBoundingClientRect();
  const anchor = menu.getBoundingClientRect();
  const panel = menu.querySelector<HTMLElement>(".vocabulary-word-menu-pop");
  if (!list || !panel) return;
  const roomBelow = Math.min(list.bottom, window.innerHeight) - anchor.bottom;
  const roomAbove = anchor.top - Math.max(list.top, 0);
  menu.dataset.placement = roomBelow < panel.offsetHeight + 4 && roomAbove > roomBelow ? "above" : "below";
}

// 2026-11-23：删除交由后台处理，编辑保存仍保留原来的等待状态。
export function VocabularyBrowser({ entries, editable, saving, onUpdate, onRemove, onEditingChange }: {
  entries: VocabularyEntry[];
  editable: boolean;
  saving: boolean;
  onUpdate: (id: string, value: VocabularyEdit) => Promise<void>;
  // 2026-11-23：菜单直接提交删除请求并立即隐藏词条。
  onRemove: (id: string) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [page, setPage] = useState(0);
  // 2026-11-20：输入中的页码暂存，提交后才切换列表。
  const [pageInput, setPageInput] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<WordForm>();
  const [problem, setProblem] = useState("");
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = entries.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selected = draft ? entries.find((entry) => entry.id === draft.id) : visible.find((entry) => entry.id === selectedId) ?? visible[0];
  // 2026-11-20：复用右侧详情，考点词还可查看原表字段及对应详解。
  const study = selected?.study;
  // 2026-11-20：AWL 在右侧显示同一个词族的原表信息。
  const wordFamily = selected?.wordFamily;
  const locked = Boolean(draft) || saving;

  // 2026-11-20：校验目标页码，跳页后默认展示目标页的首个词条。
  function jumpToPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("page");
    if (locked || !(input instanceof HTMLInputElement)) return;

    const value = input.value.trim();
    const target = Number(value);
    if (!/^\d+$/.test(value) || target < 1 || target > pageCount) {
      input.setCustomValidity(`请输入 1 到 ${pageCount} 之间的整数页码。`);
      input.reportValidity();
      return;
    }

    setPageInput(undefined);
    if (target === currentPage + 1) return;
    setSelectedId(undefined);
    setPage(target - 1);
  }

  function finishEdit() {
    setDraft(undefined);
    setProblem("");
    onEditingChange(false);
  }

  async function save(fields: WordForm) {
    const word = fields.word.trim();
    const freq = fields.freq.trim() ? Number(fields.freq) : undefined;
    if (!entries.some((entry) => entry.id === fields.id)) { setProblem("该词已从词表移除，请取消编辑。"); return; }
    if (!word) { setProblem("请输入单词。"); return; }
    if (entries.some((entry) => entry.id !== fields.id && entry.word.trim().toLowerCase() === word.toLowerCase())) {
      setProblem("这个词表中已经有该单词。");
      return;
    }
    if (freq !== undefined && (!Number.isFinite(freq) || freq < 0)) {
      setProblem("词频请输入非负数字或留空。");
      return;
    }
    const value: Word = { word, meaning: fields.meaning.trim(), example: fields.example.trim(), phonetic: fields.phonetic.trim(), freq };
    setProblem("");
    try {
      await onUpdate(fields.id, { kind: "replace", word: value });
      finishEdit();
    } catch {
      // 保存错误由词汇页统一展示，保留编辑内容以供重试。
    }
  }

  if (!selected && !draft) return <p className="card">当前词表暂无单词。</p>;

  return <div className="vocabulary-browser">
    <section className="card vocabulary-list" aria-label="单词列表">
      {/* 2026-11-20：滚动后关闭浮层，由下次打开时重新判断位置。 */}
      <ul className="vocabulary-list-entries" key={currentPage} onScroll={(event) => {
        event.currentTarget.querySelectorAll<HTMLDetailsElement>(".vocabulary-word-menu[open]").forEach((menu) => { menu.open = false; });
      }}>
        {visible.map((entry) => <li key={entry.id} className="vocabulary-list-entry">
          <button type="button" className="vocabulary-list-select" aria-pressed={entry.id === selected?.id}
            disabled={locked} onClick={() => setSelectedId(entry.id)} lang="en">{entry.word}</button>
          {/* 2026-11-20：将更多操作浮在单词行上方，保持列表项原有位置。 */}
          {editable && !locked && <details className="vocabulary-word-menu"
            onToggle={(event) => placeListMenu(event.currentTarget)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !event.currentTarget.open) return;
              event.stopPropagation();
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus({ preventScroll: true });
            }}>
            <summary aria-label={`${entry.word} 的操作`} title="词条操作"><MoreHorizontal size={16} aria-hidden="true" /></summary>
            <div className="vocabulary-word-menu-pop">
              <button type="button" onClick={(event) => {
                const menu = event.currentTarget.closest("details");
                if (menu) {
                  menu.open = false;
                  menu.querySelector("summary")?.focus({ preventScroll: true });
                }
                // 2026-11-23：点击删除后直接移出列表，无需弹窗确认。
                onRemove(entry.id);
              }}><Trash2 size={14} aria-hidden="true" />从词表删除</button>
            </div>
          </details>}
        </li>)}
      </ul>
      <nav className="vocabulary-pagination" aria-label="词表分页">
        <button type="button" className="button secondary" disabled={locked || currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
        {/* 2026-11-20：注明这里显示的是当前页与总页数。 */}
        {/* 2026-11-20：在当前页的位置输入目标页码并按回车，继续显示总页数。 */}
        <form className="vocabulary-page-jump" onSubmit={jumpToPage}>
          <span aria-hidden="true">第</span>
          <input type="text" name="page" inputMode="numeric" enterKeyHint="go" autoComplete="off"
            size={String(pageCount).length} value={pageInput ?? String(currentPage + 1)}
            aria-label={`页码，共 ${pageCount} 页，输入后按回车跳转`} title={`输入 1 到 ${pageCount} 的页码后按回车`}
            disabled={locked || pageCount === 1}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              event.currentTarget.setCustomValidity("");
              setPageInput(event.currentTarget.value);
            }}
            onBlur={(event) => {
              event.currentTarget.setCustomValidity("");
              setPageInput(undefined);
            }} />
          <span aria-hidden="true">/ {pageCount} 页</span>
        </form>
        <span className="sr-only" role="status">第 {currentPage + 1} / {pageCount} 页</span>
        <button type="button" className="button secondary" disabled={locked || currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>下一页</button>
      </nav>
    </section>

    <section className="card vocabulary-detail" aria-label="词条详情">
      <div className="section-heading">
        <h2 lang="en">{selected?.word ?? draft?.word}</h2>
        {editable && !draft && selected && <button className="button secondary" type="button" disabled={saving} onClick={() => {
          setSelectedId(selected.id);
          setDraft({ id: selected.id, word: selected.word, meaning: selected.meaning, example: selected.example ?? "",
            freq: selected.freq?.toString() ?? "", phonetic: selected.phonetic ?? "" });
          onEditingChange(true);
        }}>编辑</button>}
      </div>
      {draft ? <form className="vocabulary-edit-form" onSubmit={(event) => {
        event.preventDefault();
        if (!saving) void save(draft);
      }}>
        <label>单词<input value={draft.word} required disabled={saving}
          onChange={(event) => setDraft({ ...draft, word: event.target.value })} /></label>
        <label>音标<input value={draft.phonetic} disabled={saving}
          onChange={(event) => setDraft({ ...draft, phonetic: event.target.value })} /></label>
        <label>释义<textarea rows={3} value={draft.meaning} disabled={saving}
          onChange={(event) => setDraft({ ...draft, meaning: event.target.value })} /></label>
        <label>例句<textarea rows={3} value={draft.example} disabled={saving}
          onChange={(event) => setDraft({ ...draft, example: event.target.value })} /></label>
        <label>词频<input type="number" min="0" step="any" value={draft.freq} disabled={saving}
          onChange={(event) => setDraft({ ...draft, freq: event.target.value })} /></label>
        {problem && <p role="alert" className="notice danger">{problem}</p>}
        <div className="table-actions">
          <button type="submit" className="button primary" disabled={saving}>{saving ? "正在保存…" : "保存"}</button>
          <button type="button" className="button secondary" disabled={saving} onClick={finishEdit}>取消</button>
        </div>
      </form> : selected && <dl className="vocabulary-word-fields">
        <div><dt>释义</dt><dd>{selected.meaning || "—"}</dd></div>
        <div><dt>例句</dt><dd>{selected.example || "—"}</dd></div>
        <div><dt>词频</dt><dd>{selected.freq ?? "—"}</dd></div>
        <div><dt>音标</dt><dd>{selected.phonetic || "—"}</dd></div>
        {selected.title && <div><dt>来源</dt><dd>{selected.title}</dd></div>}
        {/* 2026-11-20：按原表区分分组、最常用词形和同族成员。 */}
        {wordFamily && <>
          <div><dt>AWL 分组</dt><dd lang="en">Sublist {wordFamily.sublist}</dd></div>
          <div><dt>最常用词形</dt><dd lang="en">{wordFamily.commonForm}</dd></div>
          {wordFamily.variants.length > 0 && <div><dt>同族词形</dt><dd lang="en">{wordFamily.variants.join(", ")}</dd></div>}
          <div><dt>来源</dt><dd>{wordFamily.source.file} · 第 {wordFamily.source.page} 页</dd></div>
        </>}
        {/* 2026-11-20：重要性排行和词频各用自己的字段。 */}
        {study && <>
          <div><dt>考点分类</dt><dd>第 {study.category} 类</dd></div>
          {study.rank !== undefined && <div><dt>重要性排行</dt><dd>{study.rank}</dd></div>}
          {study.substitutions && <div><dt>真题同义替换</dt><dd>{study.substitutions}</dd></div>}
          {study.relatedWords?.length ? <div><dt>关联主词</dt><dd>{study.relatedWords.join("、")}</dd></div> : null}
        </>}
      </dl>}
      {/* 2026-11-20：显示与词头匹配的详解正文及 PDF 页码。 */}
      {selected && study?.notes.length ? <section className="vocabulary-study" aria-label="考点详解">
        <h3>考点详解</h3>
        {study.notes.map((note, index) => <details key={`${selected.id}:${note.number}`} open={index === 0}>
          <summary>{note.word} · 详解第 {note.number} 词</summary>
          <p className="muted vocabulary-study-source">{note.file} · 第 {note.page} 页</p>
          <p className="vocabulary-study-text">{note.text}</p>
        </details>)}
      </section> : null}
    </section>
  </div>;
}
