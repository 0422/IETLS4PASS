// 2026-11-19：在原文选词查阅 ECDICT，按题库与文章保存生词出处。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { RefObject } from "react";
import type { Word } from "../../domain/types";
// 2026-11-21：阅读生词查询从词汇数据目录加载 ECDICT。
import { vocabularyMedia } from "../../services/banks";
import { desktop, desktopAvailable, documentsKey, errorText } from "../../services/desktop";
import { selectedHighlight } from "./passageHighlights";

interface Entry { w: string; t?: string; d?: string; p?: string; x?: string }

export interface ReadingWord extends Word {
  bankId: string;
  examId: string;
  title: string;
  selectedText: string;
  savedAt: string;
}

export function ReadingDictionary({ root, bankId, examId, title }: {
  root: RefObject<HTMLElement>; bankId: string; examId: string; title: string;
}) {
  const cache = useQueryClient();
  const [term, setTerm] = useState("");
  const [problem, setProblem] = useState("");
  const lookup = useQuery({
    queryKey: ["reading-ecdict"],
    queryFn: async () => {
      // 2026-11-21：词典与其他词汇文件共用数据目录。
      const response = await fetch(vocabularyMedia("ecdict.json"));
      if (!response.ok) throw new Error("本地 ECDICT 词典不可读取。");
      return (await response.json()) as { entries: Record<string, Entry> };
    },
    enabled: Boolean(term),
    staleTime: Infinity,
  });
  const entries = lookup.data?.entries ?? {};
  const key = term.toLowerCase().replace(/[’‘]/g, "'").replace(/[‐‑‒–—]/g, "-").replace(/^[^a-z]+|[^a-z]+$/gi, "");
  const entry = Object.hasOwn(entries, key) ? entries[key] : undefined;
  const save = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("此词没有可保存的词条。");
      const word: ReadingWord = {
        word: entry.w, meaning: entry.t || entry.d || "", phonetic: entry.p, example: entry.d,
        bankId, examId, title, selectedText: term, savedAt: new Date().toISOString(),
      };
      await desktop.put("reading-words", JSON.stringify([entry.w, bankId, examId]), word);
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: documentsKey("reading-words") }),
  });
  return <div className="reading-dictionary">
    <button type="button" className="text-button" onPointerDown={(event) => event.preventDefault()} onClick={() => {
      const selected = root.current && selectedHighlight(root.current);
      const text = selected?.text.trim().replace(/\s+/g, " ") ?? "";
      save.reset();
      if (!text || text.length > 70) { setProblem("请在阅读原文选中一个单词或短语。"); return; }
      setProblem("");
      setTerm(text);
    }}>用 ECDICT 查所选词</button>
    {problem && <p className="muted">{problem}</p>}
    {term && <div className="card dictionary-entry">
      <div className="section-heading"><h3 lang="en">{term}</h3>
        <button type="button" className="text-button" onClick={() => { setTerm(""); setProblem(""); }}>关闭释义</button></div>
      {lookup.isLoading ? <p>正在读取词典…</p> : entry ? <>
        <p className="muted">{entry.p}</p><p>{entry.t}</p><p lang="en">{entry.d}</p>
        <button type="button" className="button secondary" disabled={!desktopAvailable() || save.isPending || save.isSuccess}
          onClick={() => save.mutate()}>{save.isSuccess ? "已保存至阅读生词" : "保存至阅读生词"}</button>
      </> : !lookup.error && <p>本地词典中暂无对应词条。</p>}
      {(lookup.error || save.error) && <p role="alert">{errorText(lookup.error || save.error)}</p>}
    </div>}
  </div>;
}
