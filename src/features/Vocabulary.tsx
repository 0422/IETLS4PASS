// 2026-11-19：接入上游词表，以间隔复习生成到期队列并保存本机单词状态。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookText, Volume2 } from "lucide-react";
// 2026-11-20：复习与分页浏览复用同一份已应用本机编辑的词表。
// 2026-11-23：订阅后台删除队列，离开词汇页时提前提交剩余写入。
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { WordProgress } from "../domain/types";
import { vocabularyEntries } from "../domain/vocabulary";
import type { VocabularyEdit, VocabularyListId } from "../domain/vocabulary";
import { readWordList } from "../services/banks";
// 2026-11-19：阅读生词与原词表共用轮内学习和到期复习。
import { desktop, desktopAvailable, documentsKey, downloadFile, errorText } from "../services/desktop";
// 2026-11-23：删除和编辑保存共用本地查询缓存的更新逻辑。
import { applyVocabularyEdits, vocabularyEditsKey, vocabularyRemovals } from "../services/vocabularyRemovals";
import type { ReadingWord } from "./reading/ReadingDictionary";
import { VocabularyBrowser } from "./VocabularyBrowser";

const grades = { wrong: 0, hard: 3, good: 4, easy: 5 } as const;
type Grade = keyof typeof grades;
// 2026-11-19：词汇练习使用 IELTS 核心词表和阅读生词。
type Round = { progress: WordProgress; count: number; verification: boolean; due: number };

function schedule(previous: WordProgress | undefined, grade: Grade): WordProgress {
  const now = new Date();
  const quality = grades[grade];
  const firstEase = { wrong: 2.5, hard: 1.8, good: 2.5, easy: 2.8 }[grade];
  const initial = previous?.easeFactor ?? firstEase;
  const adjust = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  const easeFactor = Math.min(3, Math.max(1.3, initial + (quality < 3 ? -0.2 : previous ? adjust : 0)));
  const repetitions = quality < 3 ? 0 : (previous?.repetitions ?? 0) + 1;
  const interval = repetitions === 0 ? 1 : repetitions === 1 ? 6 : Math.max(1, Math.round((previous?.interval ?? 1) * easeFactor));
  const next = new Date(now);
  next.setDate(next.getDate() + interval);
  return { easeFactor, repetitions, interval, nextReview: next.toISOString(), lastReviewed: now.toISOString() };
}

export function Vocabulary() {
  // 2026-11-20：进入时浏览词表，复习由工具栏开启。
  const [list, setList] = useState<VocabularyListId>("ielts_core");
  const [reviewing, setReviewing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [rounds, setRounds] = useState<Record<string, Round>>({});
  const [turn, setTurn] = useState(0);
  const [spelling, setSpelling] = useState(false);
  const [typed, setTyped] = useState("");
  const [mistakes, setMistakes] = useState(0);
  const [feedback, setFeedback] = useState("");
  const cache = useQueryClient();
  // 2026-11-19：静态词汇资源只加载 IELTS 核心词表。
  // 2026-11-20：538 考点词按独立标识缓存，和核心词表共享浏览与复习逻辑。
  const words = useQuery({ queryKey: ["words", list], queryFn: () => list === "reading" ? [] : readWordList(list),
    enabled: list !== "reading", staleTime: Infinity });
  const reading = useQuery({ queryKey: documentsKey("reading-words"), queryFn: () => desktop.documents<ReadingWord>("reading-words"), enabled: desktopAvailable() && list === "reading" });
  // 2026-11-20：保留阅读生词按单词归并的取值顺序。
  const readingWords = useMemo(() => [...new Map((reading.data ?? []).map(({ value }) => [value.word, value])).values()], [reading.data]);
  // 2026-11-23：词表读取与后台删除写入使用同一个查询键。
  const editsKey = vocabularyEditsKey;
  const edits = useQuery({ queryKey: editsKey, queryFn: () => desktop.documents<VocabularyEdit>("vocabulary-edits"), enabled: desktopAvailable() });
  const pendingRemovals = useSyncExternalStore(vocabularyRemovals.subscribe, vocabularyRemovals.pending);
  useEffect(() => () => { void vocabularyRemovals.flush(cache); }, [cache]);
  const update = useMutation({
    mutationFn: ({ id, value }: { id: string; value: VocabularyEdit }) => desktop.put("vocabulary-edits", id, value),
    // 2026-11-23：保存编辑时直接更新已变更的词条，避免全量重读。
    onSuccess: (_, { id, value }) => applyVocabularyEdits(cache, new Map([[id, value]])),
  });
  const progress = useQuery({
    queryKey: documentsKey("vocabulary"), queryFn: () => desktop.documents<WordProgress>("vocabulary"), enabled: desktopAvailable(),
  });
  const entries = new Map((progress.data ?? []).map((item) => [item.id, item.value]));
  const next = (value: string) => entries.get(value)?.nextReview ?? "";
  // 2026-11-20：当前词表和复习队列同时应用改动，复习标识仍为原拼写。
  // 2026-11-23：先计算已保存的词表，再共享即时隐藏结果给列表、分页、复习和导出。
  const savedEntries = useMemo(() => vocabularyEntries(list, list === "reading" ? readingWords : words.data ?? [], edits.data ?? []),
    [list, readingWords, words.data, edits.data]);
  const available = useMemo(() => pendingRemovals.size
    ? savedEntries.filter(({ id }) => !pendingRemovals.has(id)) : savedEntries, [savedEntries, pendingRemovals]);
  const due = available.filter((item) => rounds[item.id] || !next(item.id) || Date.parse(next(item.id)) <= Date.now());
  // 2026-11-19：尚未进入轮内复习的词从普通队列取。
  const word = due.find((item) => (rounds[item.id]?.due ?? Infinity) <= turn)
    ?? due.find((item) => !rounds[item.id]) ?? [...due].sort((a, b) => rounds[a.id].due - rounds[b.id].due)[0];
  const phase = word ? rounds[word.id] : undefined;
  function resetCard() {
    setRevealed(false);
    setSpelling(false);
    setTyped("");
    setMistakes(0);
    setFeedback("");
  }
  const store = useMutation({
    mutationFn: async (choice: Grade) => {
      if (!word) return undefined;
      // 2026-11-20：改拼写后继续写入原条目的复习进度。
      const key = word.id;
      const previous = entries.get(key);
      const grade = choice === "wrong" ? "wrong" : mistakes >= 2 ? "hard" : choice === "easy" && mistakes ? "good" : choice;
      const learning = rounds[key];
      let nextRound: Round | undefined;
      let base = previous;
      const repeatAfter = () => turn + 1 + 3 + Math.floor(Math.random() * 6);
      if (!previous && !learning && (grade === "hard" || grade === "good")) {
        nextRound = { progress: { ...schedule(undefined, grade), repetitions: 0, interval: 1 }, count: 1, verification: false, due: repeatAfter() };
      } else if (learning) {
        const adjustment = grade === "easy" ? 0.15 : grade === "good" ? 0.05 : -0.1;
        base = { ...learning.progress, easeFactor: Math.max(1.3, Math.min(3, learning.progress.easeFactor + adjustment)) };
        if (learning.verification && grade !== "easy") nextRound = { progress: base, count: 1, verification: false, due: repeatAfter() };
        else if (!learning.verification && grade === "easy") nextRound = {
          progress: base, count: 0, verification: true, due: turn + 21 + Math.floor(Math.random() * 11),
        };
        else if (!learning.verification && learning.count + 1 < 12) nextRound = {
          progress: base, count: learning.count + 1, verification: false, due: repeatAfter(),
        };
      }
      if (!nextRound) await desktop.put("vocabulary", key, schedule(base, grade));
      return { key, nextRound };
    },
    onSuccess: async (outcome) => {
      if (outcome) {
        setRounds((current) => {
          const next = { ...current };
          if (outcome.nextRound) next[outcome.key] = outcome.nextRound;
          else delete next[outcome.key];
          return next;
        });
        setTurn((count) => count + 1);
      }
      resetCard();
      if (!outcome?.nextRound) await cache.invalidateQueries({ queryKey: documentsKey("vocabulary") });
    },
  });
  const canSpeak = "speechSynthesis" in window;
  // 2026-11-20：初次读取编辑记录时等待，避免先显示已删除的词。
  const loading = words.isLoading || reading.isLoading || edits.isLoading;
  const error = words.error || reading.error || edits.error || progress.error || store.error || update.error;
  // 2026-11-20：词汇页占满正文，工具栏下按实际剩余高度布局。
  return <div className="vocabulary-page">
    {/* 2026-11-19：移除词汇模块页头，直接显示词表选择。 */}
    {/* 2026-11-20：直接用下拉框选择词表，复习和导出放在同一行。 */}
    <div className="filter-bar vocabulary-toolbar"><select aria-label="词表" value={list} onChange={(event) => {
      // 2026-11-23：切换词表时提交当前累计的删除请求，切换本身不等待数据库。
      void vocabularyRemovals.flush(cache);
      setList(event.target.value as VocabularyListId);
      setReviewing(false);
      update.reset();
      resetCard();
    }} disabled={editing || update.isPending || store.isPending}>
      <option value="ielts_core">IELTS 核心词表</option>
      {/* 2026-11-20：加入总表与七份详解整理的考点词。 */}
      <option value="ielts_538">538 考点词</option>
      {/* 2026-11-20：两份相同的 AWL 资料合为一个选项。 */}
      <option value="awl">AWL 学术词汇表</option>
      {/* 2026-11-19：词表选项限定为雅思学习资料。 */}
      <option value="reading">阅读生词</option>
    </select>
      {/* 2026-11-20：分别标明待复习词数和当前词表总数。 */}
      <span>待复习 {due.length} · 共 {available.length} 词</span>
      <div className="table-actions">
        {list === "reading" && <button type="button" className="button secondary" disabled={loading || !available.length} onClick={() =>
          downloadFile("ietls4pass-reading-words.txt", available.map((item) => `${item.word}\t${item.meaning}\t${item.title ?? ""}`).join("\n"), "text/plain;charset=utf-8")
        }>导出阅读生词</button>}
        <button type="button" className="button primary" disabled={editing || update.isPending || store.isPending || (!reviewing && (loading || progress.isLoading || !due.length || Boolean(edits.error)))}
          onClick={() => { resetCard(); setReviewing(!reviewing); }}>{reviewing ? "返回词表" : "开始复习"}</button>
      </div>
    </div>
    {!desktopAvailable() && <p className="notice">词表修改和复习进度需在桌面应用中保存。</p>}
    {error && <p className="notice danger" role="alert">{errorText(error)}</p>}
    {/* 2026-11-20：词表区域在工具栏和提示下伸展，切换复习时仍保留分页。 */}
    <div className="vocabulary-browser-slot" hidden={reviewing}>
      {/* 2026-11-23：独立的删除队列不占用词条编辑的保存状态。 */}
      {loading ? <p className="card">正在读取词表…</p> : <VocabularyBrowser key={list} entries={available}
        editable={edits.isSuccess && desktopAvailable()} saving={update.isPending}
        onUpdate={(id, value) => update.mutateAsync({ id, value })}
        onRemove={(id) => vocabularyRemovals.enqueue(cache, id)}
        onEditingChange={(active) => { update.reset(); setEditing(active); }} />}
    </div>
    {/* 2026-11-20：保留背词卡片与拼写训练，进入复习后显示。 */}
    {reviewing && (word ? <section className="card flashcard">
      <BookText size={22} />
      <h2 lang={spelling ? "zh" : "en"}>{spelling ? "拼写练习" : word.word}</h2><p className="muted">{spelling ? "" : word.phonetic}</p>
      {phase && <p className="muted">{phase.verification ? "轮内复习 · 简单词验证" : `轮内复习 · 第 ${phase.count} 次`}</p>}
      {canSpeak && !spelling && <button className="text-button" type="button" onClick={() => {
        const speech = new SpeechSynthesisUtterance(word.word); speech.lang = "en-GB"; window.speechSynthesis.speak(speech);
      }}><Volume2 size={17} />朗读</button>}
      {revealed ? <><p>{word.meaning}</p>{!spelling && <p lang="en" className="muted">{word.example}</p>}
        {spelling ? <form className="table-actions" onSubmit={(event) => {
          event.preventDefault();
          const correct = typed.trim().toLowerCase() === word.word.trim().toLowerCase();
          if (!correct) setMistakes((value) => value + 1);
          setFeedback(correct ? "拼写正确" : "拼写需要再试");
        }}><input value={typed} onChange={(event) => setTyped(event.target.value)} aria-label="输入单词拼写" />
          <button className="button secondary" type="submit">核对拼写</button><span role="status">{feedback}</span>
          <button type="button" className="text-button" onClick={() => setSpelling(false)}>显示单词</button></form>
          : <button type="button" className="text-button" onClick={() => setSpelling(true)}>试着拼写</button>}
        <div className="flashcard-actions">
          {([["wrong", "没想起"], ["hard", "困难"], ["good", "一般"], ["easy", "简单"]] as const).map(([grade, label]) =>
            <button key={grade} className="button secondary" type="button" disabled={!desktopAvailable() || store.isPending} onClick={() => store.mutate(grade)}>{label}</button>)}
        </div></> : <button type="button" className="button primary" onClick={() => setRevealed(true)}>显示词义</button>}
    </section> : <p className="card">{loading || progress.isLoading ? "正在读取词表…" : "当前词表没有待复习的词。"}</p>)}
  </div>;
}
