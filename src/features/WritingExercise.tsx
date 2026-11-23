// 2026-11-21：双栏展示写作题面和图表，作答、范文共用当前内容与计时器。
// 2026-11-23：作文提交后持久化，并更新总览订阅的记录。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock3 } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { localImageRefs, parent, safeRelative } from "../domain/bankSource";
import { dateText } from "../domain/records";
import type { WritingQuestion, WritingSubmission } from "../domain/writing";
import { desktop, desktopAvailable, errorText, type Document } from "../services/desktop";
import { useFolderMedia } from "../services/folderBanks";
import { useWritingSubmissions, writingSubmissionsKey } from "../services/writingBank";
import { readingFragment } from "./reading/readingHtml";
import { formatClock, usePracticeClock } from "./reading/usePracticeClock";

function WritingText({ html, text, urls }: { html: string; text: string; urls?: Record<string, string> }) {
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (html && content.current) content.current.replaceChildren(readingFragment(html, (file) => urls?.[file]));
  }, [html, urls]);
  return html ? <div ref={content} /> : <p className="writing-plain-text">{text}</p>;
}

// 2026-11-21：题图只从已绑定的本机目录读取，保留导出的题面排版。
function writingContent(question: WritingQuestion, files: string[]) {
  const resources: Record<string, string> = {};
  const paths = new Map(question.images.map(({ url, file }) => [url, file]));
  function withImages(html: string) {
    if (!/<img\b/i.test(html)) return html;
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const image of template.content.querySelectorAll("img[src]")) {
      const exported = paths.get(image.getAttribute("src") ?? "");
      const local = exported && safeRelative(exported);
      if (local) image.setAttribute("src", local);
    }
    return localImageRefs(template.innerHTML, files, parent(question.file), resources);
  }
  return {
    prompt: { ...question.prompt, html: withImages(question.prompt.html) },
    examples: question.examples.map((example) => ({ ...example, html: withImages(example.html) })),
    resources,
  };
}

export function WritingExercise({ question, folderId, files, viewingModel, back, practice, model }: {
  question: WritingQuestion;
  folderId: string;
  files: string[];
  viewingModel: boolean;
  back: string;
  practice: string;
  model: string;
}) {
  // 2026-11-23：首次进入回显最近一次提交，重新作答时另起记录。
  const cache = useQueryClient();
  const submissions = useWritingSubmissions();
  const latest = submissions.data?.reduce<WritingSubmission | undefined>((current, { value }) =>
    value.task === question.task && value.questionId === question.id && (!current || value.submittedAt >= current.submittedAt)
      ? value : current, undefined);
  const [draft, setDraft] = useState<string | null>(null);
  const viewingSubmission = draft === null && latest !== undefined;
  const answer = draft ?? latest?.answer ?? "";
  const pending = useRef<WritingSubmission | null>(null);
  const submitting = useRef(false);
  // 2026-11-21：实时统计作文词数，保留缩写、连字符词和小数的整体计数。
  const wordCount = useMemo(() =>
    answer.match(/[\p{L}\p{N}]+(?:['’\u2010\u2011-][\p{L}\p{N}]+|(?<=\p{N})[.,]\p{N}+)*/gu)?.length ?? 0, [answer]);
  const [timer, setTimer] = useState<"ready" | "running" | "paused">("ready");
  // 2026-11-23：失败时保留作文和同一次提交的标识，重试可安全覆盖同一条记录。
  const save = useMutation({
    mutationFn: (value: WritingSubmission) => desktop.put("writing-submissions", value.id, value),
    onSuccess: async (_, value) => {
      await cache.cancelQueries({ queryKey: writingSubmissionsKey });
      cache.setQueryData<Document<WritingSubmission>[]>(writingSubmissionsKey, (records) => [
        ...(records ?? []).filter(({ id }) => id !== value.id), { collection: "writing-submissions", id: value.id, value },
      ]);
      pending.current = null;
      setDraft(null);
      setTimer("paused");
      void cache.invalidateQueries({ queryKey: writingSubmissionsKey });
    },
    onSettled: () => { submitting.current = false; },
  });
  const clock = usePracticeClock(0, timer === "running" && !viewingModel && !viewingSubmission && !save.isPending);
  const content = useMemo(() => writingContent(question, files), [question, files]);
  const media = useFolderMedia(folderId, content.resources);

  // 2026-11-23：防止连续点击重复提交，用户重写时清空旧正文和计时。
  function submit() {
    if (submitting.current || !wordCount || viewingSubmission || !desktopAvailable()) return;
    const text = answer.trim();
    const prior = pending.current;
    const value = prior?.answer === text ? prior : {
      id: crypto.randomUUID(), task: question.task, questionId: question.id, title: question.title,
      submittedAt: new Date().toISOString(), answer: text,
    };
    pending.current = value;
    submitting.current = true;
    save.mutate(value);
  }

  function startOver() {
    setDraft("");
    setTimer("ready");
    clock.reset();
    save.reset();
  }
  // 2026-11-21：写作题面和作答区使用正文剩余高度。
  return <section className="writing-session exercise-page">
    <div className="section-heading writing-session-heading">
      {/* 2026-11-21：题目名称与返回链接同行，右侧计时操作垂直对齐。 */}
      <div className="writing-heading-main">
        <Link className="back-link" to={back}><ArrowLeft size={16} aria-hidden="true" />返回写作题库</Link>
        <h2>{question.title}</h2>
      </div>
      <div className="table-actions">
        <span className="time" role="timer" aria-label="作答计时"><Clock3 size={16} aria-hidden="true" />{formatClock(clock.elapsedMs)}</span>
        {!viewingModel && !viewingSubmission && <button className="button secondary" type="button" disabled={save.isPending}
          onClick={() => setTimer(timer === "running" ? "paused" : "running")}>
          {timer === "ready" ? "开始计时" : timer === "running" ? "暂停计时" : "继续计时"}
        </button>}
      </div>
    </div>
    <div className="reading-paper writing-paper">
      <section className="paper-column" aria-label="题目">
        <h3>题目</h3>
        <div lang="en">{media.loading ? <p className="muted" role="status">正在读取题图…</p>
          : <WritingText {...content.prompt} urls={media.urls} />}</div>
      </section>
      <section className="paper-column writing-editor" aria-label="作答和范文">
        <nav className="study-view-tabs" aria-label="写作题目视图">
          <Link to={practice} aria-current={!viewingModel ? "page" : undefined}>作答</Link>
          <Link to={model} aria-current={viewingModel ? "page" : undefined}>范文</Link>
        </nav>
        {viewingModel ? content.examples.length > 0 ? <div className="writing-examples" lang="en">
          {content.examples.map((example, index) => <article key={index}>
            {(content.examples.length > 1 || example.band) &&
              <h3>范文{content.examples.length > 1 ? ` ${index + 1}` : ""}{example.band ? ` · Band ${example.band}` : ""}</h3>}
            <WritingText {...example} urls={media.urls} />
          </article>)}
        </div> : <p className="muted" role="status">暂无范文。</p>
          : <>
            {/* 2026-11-23：保存后的正文可查看，作答区下方提供提交和重新作答。 */}
            {submissions.error && <p className="notice danger" role="alert">{errorText(submissions.error)}</p>}
            {save.error && <p className="notice danger" role="alert">{errorText(save.error)}</p>}
            <textarea className="writing-answer" aria-label="作文作答" placeholder="在此输入作文" lang="en"
              readOnly={viewingSubmission || submissions.isLoading || save.isPending} value={answer}
              onChange={(event) => setDraft(event.currentTarget.value)} />
            <div className="writing-answer-footer">
              {viewingSubmission ? <>
                <span className="muted" role="status">已提交 · {dateText(latest?.submittedAt)}</span>
                <button type="button" className="button secondary" disabled={save.isPending} onClick={startOver}>重新作答</button>
              </> : <button type="button" className="button primary" onClick={submit}
                disabled={!desktopAvailable() || submissions.isLoading || !wordCount || save.isPending}>
                {save.isPending ? "正在提交…" : "提交作文"}
              </button>}
              <output className="writing-word-count">已写 {wordCount} 词</output>
            </div>
          </>}
      </section>
    </div>
  </section>;
}
