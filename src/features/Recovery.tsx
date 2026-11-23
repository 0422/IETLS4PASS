// 2026-11-19：查看草稿和中断记录，支持回到原练习或将草稿归档。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { dateText, durationText } from "../domain/records";
// 2026-11-19：中断记录展示保存的实际作答和原因，可独立删除。
import { answerText } from "../domain/scoring";
import type { PracticeDraft } from "../domain/types";
import { useBankIndex } from "../services/banks";
import { desktop, desktopAvailable, documentsKey, errorText } from "../services/desktop";

export function Recovery() {
  const cache = useQueryClient();
  const index = useBankIndex();
  const drafts = useQuery({ queryKey: documentsKey("drafts"), queryFn: () => desktop.documents<PracticeDraft>("drafts"), enabled: desktopAvailable() });
  const interrupted = useQuery({ queryKey: documentsKey("interrupted"), queryFn: () => desktop.documents<PracticeDraft>("interrupted"), enabled: desktopAvailable() });
  const archive = useMutation({
    mutationFn: desktop.archiveDraft,
    onSuccess: async () => {
      await Promise.all([cache.invalidateQueries({ queryKey: documentsKey("drafts") }), cache.invalidateQueries({ queryKey: documentsKey("interrupted") })]);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => desktop.remove("interrupted", id),
    onSuccess: () => cache.invalidateQueries({ queryKey: documentsKey("interrupted") }),
  });
  const visible = (drafts.data ?? []).filter((entry) => !entry.id.startsWith("suite:"));
  const title = (draft: PracticeDraft) => index.data?.entries.find((entry) => entry.examId === draft.examId)?.title ?? draft.examId;
  const error = drafts.error || interrupted.error || archive.error || remove.error;
  return <>
    {/* 2026-11-19：移除草稿与中断模块页头。 */}
    {error && <p className="notice danger" role="alert">{errorText(error)}</p>}
    {!desktopAvailable() && <p className="notice">回到桌面应用可查看本机草稿。</p>}
    <section className="card recent"><h2>可恢复草稿</h2>
      {visible.length ? visible.map(({ id, value }) => <div key={id} className="recent-row">
        <span>{title(value)}</span><span>{dateText(value.updatedAt)}</span><div className="table-actions">
          <Link to={`/reading/${encodeURIComponent(value.bankId)}/${encodeURIComponent(value.examId)}`}>继续</Link>
          <button type="button" className="text-button" disabled={archive.isPending} onClick={() => archive.mutate(id)}>归档中断</button>
        </div>
      </div>) : <p className="muted">暂无可恢复草稿。</p>}
    </section>
    <section className="card recent"><h2>中断记录</h2>
      {interrupted.data?.length ? interrupted.data.map(({ id, value }) => <details key={id} className="interrupted-detail">
        <summary>{title(value)} · {durationText(value.elapsedMs)} · {dateText(value.archivedAt ?? value.updatedAt)}</summary>
        <p className="muted">{value.interruptReason === "suite-expired" ? "套题倒计时结束" : value.suiteId ? "套题结束" : "本篇练习中断"}</p>
        {Object.entries(value.answers ?? {}).some(([, answer]) => answerText(answer) !== "—")
          ? <ul>{Object.entries(value.answers ?? {}).filter(([, answer]) => answerText(answer) !== "—")
            .map(([question, answer]) => <li key={question}>{question} · {answerText(answer)}</li>)}</ul>
          : <p className="muted">此中断记录没有保存作答。</p>}
        {value.annotations?.notes && <p>{value.annotations.notes}</p>}
        <button type="button" className="text-button" disabled={remove.isPending} onClick={() => {
          if (window.confirm("删除这条中断记录？")) remove.mutate(id);
        }}>删除此中断记录</button>
      </details>) : <p className="muted">暂无中断记录。</p>}
    </section>
  </>;
}
