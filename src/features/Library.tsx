// 2026-11-19：按题库来源、分篇、练习状态和关键词浏览完整阅读题库。
// 2026-11-19：题库配置切换保存至本机，目录题库支持资源状态和重开。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// 2026-11-20：阅读题库保留单篇练习、续做和回放入口。
import { BookOpen, Search } from "lucide-react";
// 2026-11-23：打开当前篇目的得分历史浮层，复用正式提交记录。
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
// 2026-11-19：题库显示按题目和来源保存的复习计划，以及有原始作答的回放入口。
import { dateText, submissions, usableScore } from "../domain/records";
import { reviewPlanId, type ReviewPlan } from "../domain/readingReview";
import type { PracticeDraft, SuiteDraft } from "../domain/types";
import { importedEntries, MAIN_BANK, readingRecordsFor, useBankIndex, useCustomBanks, useSelectedReadingBank } from "../services/banks";
import { desktop, desktopAvailable, documentsKey, errorText, recordsKey } from "../services/desktop";
// 2026-11-19：在阅读题库中更新已绑定的本机文件。
import { useFolderBankSync } from "../services/folderBanks";

export function Library() {
  const index = useBankIndex();
  const cache = useQueryClient();
  const banks = useCustomBanks();
  const sync = useFolderBankSync("reading");
  const records = useQuery({ queryKey: recordsKey, queryFn: desktop.records, enabled: desktopAvailable() });
  const drafts = useQuery({ queryKey: documentsKey("drafts"), queryFn: () => desktop.documents<PracticeDraft>("drafts"), enabled: desktopAvailable() });
  const plans = useQuery({ queryKey: documentsKey("review-plans"), queryFn: () => desktop.documents<ReviewPlan>("review-plans"), enabled: desktopAvailable() });
  // 2026-11-20：只读出旧套题中已提交的子篇，给已有复习计划保留回放来源。
  const suites = useQuery({ queryKey: documentsKey("suites"), queryFn: () => desktop.documents<SuiteDraft>("suites"), enabled: desktopAvailable() });
  const preference = useSelectedReadingBank();
  const bankId = preference.data && (preference.data === MAIN_BANK || banks.data?.some((bank) => bank.id === preference.data))
    ? preference.data : MAIN_BANK;
  const switchBank = useMutation({
    mutationFn: (id: string) => desktop.put("settings", "reading-bank", id),
    onSuccess: () => cache.invalidateQueries({ queryKey: documentsKey("settings") }),
  });
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("source");
  // 2026-11-23：得分弹窗独立于列表布局，并随正式成绩刷新。
  const [scoreExam, setScoreExam] = useState<{ id: string; title: string } | null>(null);
  const scoreDialog = useRef<HTMLDialogElement>(null);
  const chosenBank = banks.data?.find((bank) => bank.id === bankId);
  const entries = bankId === MAIN_BANK ? index.data?.entries ?? [] : chosenBank ? importedEntries(chosenBank.value) : [];
  const submitted = useMemo(() => submissions(records.data ?? []), [records.data]);
  const attempted = useMemo(() => readingRecordsFor(bankId, submitted, index.data, banks.data ?? []),
    [bankId, submitted, index.data, banks.data]);
  const scoreHistory = scoreExam ? attempted.get(scoreExam.id) ?? [] : [];
  const inProgress = new Set((drafts.data ?? []).filter((draft) => !draft.id.startsWith("suite:") && draft.value.bankId === bankId)
    .map((draft) => draft.value.examId));
  const stateOf = (id: string) => inProgress.has(id) ? "draft" : attempted.has(id) ? "complete" : "new";
  const replaySources = new Set([
    ...submitted,
    ...(suites.data ?? []).flatMap(({ value }) => value.completed),
  ].map((record) => record.id));
  const review = new Map(plans.data?.filter(({ value }) => replaySources.has(value.recordId)).map(({ id, value }) => [id, value] as const));
  const dueTime = Date.now();
  const lookup = (examId: string) => review.get(reviewPlanId(bankId, examId));
  const due = (examId: string) => Date.parse(lookup(examId)?.nextReview ?? "") <= dueTime;
  const visible = entries.filter((entry) => (category === "all" || entry.category === category)
    && (status === "all" || (status === "due" ? due(entry.examId) : status === stateOf(entry.examId)))
    && [entry.title, entry.examId, entry.frequency, entry.filename, entry.pdfFilename].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())));
  if (sort === "title") visible.sort((a, b) => a.title.localeCompare(b.title, "en"));
  if (sort === "difficulty") visible.sort((a, b) => (a.difficultyScore ?? Infinity) - (b.difficultyScore ?? Infinity));
  const error = index.error || banks.error || records.error || drafts.error || plans.error || suites.error || preference.error || switchBank.error
    || sync.error || sync.data?.[0];

  return <>
    <div className="filter-bar filter-with-actions library-filters">
      <label className="search-field"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题或题目编号" aria-label="搜索题目" /></label>
      <label className="filter-choice">题库<select value={bankId} disabled={switchBank.isPending} onChange={(event) => switchBank.mutate(event.target.value)}>
        <option value={MAIN_BANK}>默认阅读题库</option>
        {banks.data?.map((bank) => <option key={bank.id} value={bank.id}>{bank.value.title}</option>)}
      </select></label>
      <label>分篇<select value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="all">全部</option><option>P1</option><option>P2</option><option>P3</option>
      </select></label>
      <label>进度<select value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="all">全部</option><option value="new">待练习</option><option value="draft">进行中</option><option value="complete">已练习</option>
        <option value="due">到期复习</option>
      </select></label>
      <label>排序<select value={sort} onChange={(event) => setSort(event.target.value)}>
        <option value="source">题库顺序</option><option value="title">标题</option><option value="difficulty">难度分升序</option>
      </select></label>
    </div>
    {error && <p className="notice danger" role="alert">{errorText(error)}</p>}
    <div className="list-caption"><b>{visible.length}</b> / {entries.length} 篇阅读</div>
    <div className="card table-scroll">
      <table>
        {/* 2026-11-23：成绩列按时间显示最近一次提交，点击可查看该篇各次得分。 */}
        <thead><tr><th>篇目</th><th>分篇</th><th>频率</th><th>进度</th><th>得分</th><th>操作</th></tr></thead>
        <tbody>{visible.map((entry) => {
          const route = `/reading/${encodeURIComponent(bankId)}/${encodeURIComponent(entry.examId)}`;
          const plan = lookup(entry.examId);
          const local = chosenBank?.value.catalog?.entries.find((row) => row.examId === entry.examId);
          const attempts = attempted.get(entry.examId);
          const latest = attempts?.[0];
          const score = latest && usableScore(latest) ? `${latest.points} / ${latest.possible}` : "—";
          return <tr key={entry.examId}>
            <td><Link className="exam-link" to={route}><BookOpen size={17} /><span>{entry.title}</span></Link></td>
            <td><span className="category">{entry.category}</span></td>
            <td>{entry.frequency ?? "—"}</td>
            <td>{stateOf(entry.examId) === "draft" ? "进行中" : attempts ? `已练 ${attempts.length} 次` : "待练习"}</td>
            <td className="reading-score">{latest ? <button type="button" className="text-button" aria-haspopup="dialog"
              aria-label={`${entry.title}，最近得分 ${score}，查看提交历史`} onClick={() => {
                setScoreExam({ id: entry.examId, title: entry.title });
                scoreDialog.current?.showModal();
              }}>{score}</button> : score}</td>
            <td><div className="table-actions">
              <Link to={route}>{local?.kind === "pdf" ? "查看资料" : inProgress.has(entry.examId) ? "继续" : "练习"}</Link>
              {local?.kind !== "pdf" && <Link to={`${route}?mode=study`}>背题</Link>}
              {plan && <Link to={`${route}?mode=replay&record=${encodeURIComponent(plan.recordId)}`}
                title={`下次复习 ${dateText(plan.nextReview)}`}>{due(entry.examId) ? "回放 · 已到期" : "回放"}</Link>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
      {!visible.length && <p className="empty">{index.isLoading ? "正在读取题库…" : "没有符合条件的阅读题目。"}</p>}
    </div>
    {/* 2026-11-23：查看某篇完整成绩，打开时不改变列表行高。 */}
    <dialog ref={scoreDialog} className="card reading-score-dialog" aria-labelledby="reading-score-title" onClose={() => setScoreExam(null)}>
      <div className="section-heading">
        <h2 id="reading-score-title">得分记录</h2>
        <button type="button" className="button secondary" onClick={() => scoreDialog.current?.close()}>关闭</button>
      </div>
      {scoreExam && <>
        <p className="muted">{scoreExam.title}</p>
        {scoreHistory.length ? <table>
          <thead><tr><th scope="col">提交时间</th><th scope="col">得分</th></tr></thead>
          <tbody>{scoreHistory.map((record) => <tr key={record.id}>
            <td>{dateText(record.submittedAt)}</td>
            <td className="reading-score">{usableScore(record) ? `${record.points} / ${record.possible}` : "—"}</td>
          </tr>)}</tbody>
        </table> : <p className="empty">没有可用的提交记录。</p>}
      </>}
    </dialog>
  </>;
}
