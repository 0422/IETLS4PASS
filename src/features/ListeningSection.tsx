// 2026-11-19：从听力列表进入单节作答或静听，并以本机草稿恢复答题状态。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// 2026-11-20：独立呈现听力播放、进度和音量控制。
// 2026-11-27：右侧精听由同一个耳机按钮展开和收起。
import { FileAudio, Headphones, Pause, Play, Volume2 } from "lucide-react";
// 2026-11-23：题面渲染后按已保存的文字范围恢复高亮。
// 2026-11-27：为精听工具栏按钮关联右侧面板。
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
// 2026-11-20：做题操作与播放控件共用一行。
import type { ReactNode, RefObject } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
// 2026-11-20：导出题面中的题图通过现有本地资源映射读取。
// 2026-11-21：题图映射仅使用本机题库中的相对路径。
import { baseName, legacyHtmlPaper, localImageRefs, parent, safeRelative } from "../domain/bankSource";
import { listeningExam, parseListeningPaper, questionsPerSection } from "../domain/listening";
import type { ListeningDraft, ListeningPart, ListeningRow } from "../domain/listening";
// 2026-11-20：直接读取导出题源的逐句时间轴和题面。
// 2026-11-20：交卷时按导出题号评分，包括同一题号下的成对填空。
// 2026-11-21：从导出数据恢复题图文件名与解析。
import { listeningExportImagePath, parseListeningExport, scoreListeningExport } from "../domain/listeningExport";
// 2026-11-20：使用导出题组的实际题号绑定填空、选项和地图标记。
import type { ListeningAnswerPair, ListeningExportBlock, ListeningSentence } from "../domain/listeningExport";
// 2026-11-20：共享多选也按选满数量计算作答状态。
// 2026-11-27：按交卷时的评分和选项匹配结果还原错题颜色。
import { answeredReadingQuestions, answersMatch } from "../domain/scoring";
// 2026-11-21：详解及交卷结果使用同一份题目解析。
// 2026-11-23：听力题面和阅读原文共享文字范围结构。
import type { AnswerResult, Answers, Explanation, PassageHighlight, PracticeRecord, ReadingExam } from "../domain/types";
import { desktop, documentsKey, errorText, recordsKey } from "../services/desktop";
import type { Document } from "../services/desktop";
import { useFolderMedia } from "../services/folderBanks";
// 2026-11-23：PDF 打开组件独立于已移除的旧目录面板。
import { LocalPdf } from "./LocalPdf";
import { AnswerReview } from "./reading/AnswerReview";
import { ReadingPaper } from "./reading/ReadingPaper";
// 2026-11-27：题面和原文共用高亮工具，回看单独保存批注。
import type { AnswerFeedback } from "./reading/ReadingPaper";
import { ListeningHighlightActions, useListeningHighlightPaint, useSavedListeningHighlights } from "./ListeningHighlights";
// 2026-11-27：精听面板和题面工具栏共用原文选区及批注状态。
import type { ListeningHighlightTarget } from "./ListeningHighlights";
import { formatClock, usePracticeClock } from "./reading/usePracticeClock";

interface SectionContent {
  exam?: ReadingExam;
  part?: ListeningPart;
  graded: boolean;
  audio?: string;
  images?: Record<string, string>;
  problem?: string;
  // 2026-11-20：录音、题面预览和评分题目可以分别存在。
  transcript?: ListeningSentence[];
  questionText?: string;
  // 2026-11-20：题面无标准答案时仍可填写、暂停并保存草稿。
  practiceForm?: boolean;
  pairs?: ListeningAnswerPair[];
  // 2026-11-21：记录刷新后读取到的新版解析。
  explanation?: Explanation;
}

function jsonSection(row: ListeningRow, part?: ListeningPart): SectionContent {
  return part ? { exam: listeningExam(row, part), part, graded: part.questions.length === questionsPerSection } : { graded: false };
}

// 2026-11-20：保留现有题面排版，构建阅读答题组件可复用的单选、多选和匹配控件。
function appendExportHtml(node: HTMLElement, html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  node.append(template.content);
}

// 2026-11-21：先匹配新版的 URL 到本地图片路径，再兼容旧版同名文件。
function exportedQuestionGroup(block: ListeningExportBlock, questionOrder: string[], imageFiles: ReadonlyMap<string, string>) {
  const template = document.createElement("template");
  template.innerHTML = block.html;
  const ids = new Set<string>();
  const groupIds = block.questionIds.filter((id) => questionOrder.includes(id));
  const select = (id: string, choices: { label: string; html: string }[]) => {
    const field = document.createElement("select");
    field.name = id;
    field.append(new Option("选择答案", ""));
    for (const { label, html } of choices) {
      const option = document.createElement("template");
      option.innerHTML = html;
      field.append(new Option(`${label}${html ? `. ${option.content.textContent?.trim() ?? ""}` : ""}`, label));
    }
    ids.add(id);
    return field;
  };

  if ((block.type === "201" || block.type === "202") && groupIds.length && block.choices.length) {
    const group = document.createElement("div");
    group.className = "listening-export-choices";
    for (const { label, html } of block.choices) {
      const option = document.createElement("label");
      const input = document.createElement("input");
      input.type = groupIds.length === 1 ? "radio" : "checkbox";
      input.name = groupIds.join("_");
      input.value = label;
      const caption = document.createElement("span");
      caption.append(`${label}. `);
      appendExportHtml(caption, html);
      option.append(input, caption);
      group.append(option);
    }
    template.content.append(group);
    groupIds.forEach((id) => ids.add(id));
  }

  if (block.type === "223" && block.labels.length) {
    groupIds.forEach((id, index) => {
      const item = block.choices[index];
      if (!item) return;
      const label = document.createElement("label");
      label.className = "listening-map-choice";
      const caption = document.createElement("span");
      caption.append(`${id.slice(1)}. `);
      appendExportHtml(caption, item.html);
      label.append(caption, select(id, block.labels.map((label) => ({ label, html: "" }))));
      template.content.append(label);
    });
  }

  if (block.type === "216" || block.type === "208") {
    // 2026-11-21：匹配题保留原题的共用选项，填答时可对照查看。
    if (block.type === "208" && block.choices.length) {
      const bank = document.createElement("div");
      if (block.heading) {
        const heading = document.createElement("strong");
        heading.textContent = block.heading;
        bank.append(heading);
      }
      const options = document.createElement("ul");
      for (const { label, html } of block.choices) {
        const option = document.createElement("li");
        option.append(`${label}. `);
        appendExportHtml(option, html);
        options.append(option);
      }
      bank.append(options);
      template.content.prepend(bank);
    }
    const fields = [...template.content.querySelectorAll<HTMLInputElement>('input.input-item[type="text"][placeholder]')];
    fields.forEach((input, index) => {
      const id = block.blankIds[fields.length === block.blankIds.length ? index : Number(input.placeholder) - 1];
      if (!questionOrder.includes(id)) return;
      if (block.type === "208" && block.choices.length) input.replaceWith(select(id, block.choices));
      else {
        input.name = id;
        const pair = block.pairs.find(({ ids }) => Number(id.slice(1)) > 40 && ids[1] === id);
        input.placeholder = (pair?.ids[0] ?? id).slice(1);
        if (pair) input.setAttribute("aria-label", `第 ${input.placeholder} 题第二空`);
        ids.add(id);
      }
    });
  }
  // 2026-11-20：导出的题图网址只用于匹配用户已经放入目录的同名本地图片。
  for (const image of template.content.querySelectorAll("img")) {
    // 2026-11-21：导出图片位于 Section 对应的子目录，文件名可能与网址不同。
    const source = image.getAttribute("src") ?? "";
    const mapped = listeningExportImagePath(source, imageFiles);
    const filename = (mapped && safeRelative(mapped)) || source.match(/^https?:\/\/[^/]+\/[^?#]*?([^/?#]+)(?:[?#].*)?$/i)?.[1];
    if (filename) image.setAttribute("src", filename);
  }
  return { questionIds: [...ids], html: template.innerHTML,
    kind: block.type === "201" || block.type === "202" ? (groupIds.length > 1 ? "multi_choice" : "multiple_choice") : "fill-blank" };
}

// 2026-11-20：根据导出的题号生成答题页，完整覆盖十题时才开启草稿练习。
// 2026-11-21：将本节的题图映射传给所有题面和选项。
function exportedListeningExam(row: ListeningRow, blocks: ListeningExportBlock[], keys: Answers, file: string, files: string[],
  imageFiles: ReadonlyMap<string, string>) {
  const offset = (row.section - 1) * questionsPerSection;
  const questionOrder = Array.from({ length: questionsPerSection }, (_, index) => `q${offset + index + 1}`);
  // 2026-11-20：额外输入位参与保存，交卷时合并回所属的正式题号。
  const pairs = blocks.flatMap(({ pairs }) => pairs);
  questionOrder.push(...pairs.map(({ ids }) => ids[1]).filter((id) => Number(id.slice(1)) > 40));
  const found = new Set<string>();
  const images: Record<string, string> = {};
  const questionGroups = blocks.map((block, index) => {
    // 2026-11-21：先恢复导出图片路径，再沿用题库媒体读取。
    const { html, kind, questionIds } = exportedQuestionGroup(block, questionOrder, imageFiles);
    questionIds.forEach((id) => found.add(id));
    return { groupId: `export-${index}`, kind, questionIds,
      bodyHtml: localImageRefs(html, files, parent(file), images) };
  });
  // 2026-11-20：题面需要覆盖正式题号，评分另外检查每个填空位的答案。
  if (!questionOrder.every((id) => found.has(id))) return undefined;
  const exam: ReadingExam = { examId: row.examId, meta: { title: row.title, category: "P1" }, passage: { blocks: [] },
    questionGroups, questionOrder, answerKey: keys };
  return { exam, images, practiceForm: true, graded: questionOrder.every((id) => Boolean(keys[id])), pairs };
}

async function loadSection(row: ListeningRow): Promise<SectionContent> {
  if (row.source.type === "paper") return jsonSection(row, row.source.part);
  const { catalog, entry } = row.source;
  if (!entry.file) return { graded: false, audio: entry.audio };
  try {
    const text = (await desktop.bankText(catalog.folderId, entry.file)).replace(/^\uFEFF/, "");
    if (entry.kind === "listening-json" || entry.file.toLowerCase().endsWith(".json")) {
      // 2026-11-20：导出题源沿用本地媒体，不从 JSON 请求网络地址。
      const data: unknown = JSON.parse(text);
      if (entry.exportedListening) {
        const exported = parseListeningExport(data, row.title);
        if (!exported) throw new Error("听力导出资料与该 Section 不匹配。");
        // 2026-11-21：新版题源的图片与解析跟随本节读入。
        const practice = !exported.part && exported.questionBlocks.length
          ? exportedListeningExam(row, exported.questionBlocks, exported.keys, entry.file, catalog.files, exported.imageFiles) : undefined;
        return { ...jsonSection(row, exported.part), ...practice, audio: entry.audio,
          transcript: exported.transcript, questionText: exported.questionText, explanation: exported.explanation };
      }
      const source = parseListeningPaper(data, baseName(entry.file));
      return { ...jsonSection(row, source.parts.find((part) => part.part === row.section)), audio: entry.audio };
    }
    const { exam, graded, media, audio } = legacyHtmlPaper(text, entry, catalog.files, "listening");
    return { exam, graded: graded && exam.questionOrder.length === questionsPerSection, audio, images: media };
  } catch (error) {
    return { graded: false, audio: entry.audio, problem: errorText(error) };
  }
}

// 2026-11-27：作答和历史回看共用题源与精听资源。
export function ListeningSection({ row, draft, mode, back, result, intensiveRow }: {
  row: ListeningRow; draft?: ListeningDraft; mode: string; back: string; result?: PracticeRecord; intensiveRow: ListeningRow;
}) {
  const query = useQuery({ queryKey: ["listening-asset", row.bankId, row.id], queryFn: () => loadSection(row) });
  // 2026-11-20：从续做页也能重开本节，复用开始答题时替换草稿的流程。
  const [restartRequested, setRestartRequested] = useState(false);
  if (query.error) return <p className="notice danger" role="alert">{errorText(query.error)}</p>;
  if (!query.data) return <p className="muted">正在读取听力资料…</p>;
  // 2026-11-27：历史回看独立挂载，读取上次交卷的快照。
  if (result) return <ListeningResultPage row={row} source={query.data} back={back} record={result} intensiveRow={intensiveRow} />;
  // 2026-11-20：从列表直接打开本节答案，详解不启动或修改草稿。
  if (mode === "review") return <ListeningExplanation row={row} source={query.data} back={back} />;
  // 2026-11-20：已识别完整答题位的导出表格可先做草稿练习。
  if (mode === "listen" || !(query.data.graded || query.data.practiceForm) || !query.data.exam) {
    return <ListeningReference row={row} source={query.data} back={back} listen={mode === "listen"} />;
  }
  return <SectionAttempt key={restartRequested ? "restart" : "attempt"} row={row} source={query.data} exam={query.data.exam}
    prior={draft} restart={mode === "restart" || restartRequested} onRestart={() => setRestartRequested(true)} back={back}
    intensiveRow={intensiveRow} />;
}

// 2026-11-21：优先展示新版导出解析，兼容旧 JSON 的逐题说明。
function listeningExplanation(source: SectionContent, details: AnswerResult[]): Explanation {
  if (source.explanation) return source.explanation;
  return { questionExplanations: details.flatMap(({ label }, index) => {
    const text = source.part?.questions[index]?.explanation;
    return text ? [{ sectionTitle: `第 ${label} 题`, text }] : [];
  }) };
}

// 2026-11-20：复用标准答案视图，并把 JSON 内的解析关联到对应题号。
function ListeningExplanation({ row, source, back }: { row: ListeningRow; source: SectionContent; back: string }) {
  // 2026-11-20：详解显示按正式题号归并后的导出答案。
  const details = source.exam ? scoreListeningExport(source.exam, {}, source.pairs) : [];
  const answers = details.filter(({ correctAnswer }) => Array.isArray(correctAnswer) ? correctAnswer.length > 0 : Boolean(correctAnswer?.trim()));
  return <section className="listening-section">
    <Link className="back-link" to={back}>返回听力题库</Link>
    <div className="section-heading"><h2>{row.title}</h2></div>
    {source.problem && <p className="notice danger" role="alert">{source.problem}</p>}
    {/* 2026-11-21：详解直接显示新版按原顺序导入的解析。 */}
    {answers.length > 0 ? <AnswerReview study details={answers} explanation={listeningExplanation(source, details)} />
      : <p className="notice" role="status">本节暂无可读取的标准答案。</p>}
  </section>;
}

function useLocalFileUrl(file?: File) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const current = file && URL.createObjectURL(file);
    setUrl(current);
    return () => { if (current) URL.revokeObjectURL(current); };
  }, [file]);
  return url;
}

// 2026-11-20：播放条、时间和音量与做题操作同排，精听可以同步原文。
// 2026-11-21：做题时在播放器内同时展示题名和作答计时。
// 2026-11-27：播放器开始播放时通知并排的另一条音轨暂停。
// 2026-11-27：侧栏精听把播放进度和播放设置分成两行。
function ListeningMedia({ row, source, player, position = 0, listen = false, compact = false, onPause, onPlay, onPosition, actions, playbackLocked, attemptElapsedMs }: {
  row: ListeningRow; source: SectionContent; player: RefObject<HTMLAudioElement>; position?: number; listen?: boolean;
  onPause?: () => void; onPlay?: () => void; onPosition?: (time: number) => void; actions?: ReactNode; playbackLocked?: boolean;
  attemptElapsedMs?: number; compact?: boolean;
}) {
  const [audio, setAudio] = useState<File>();
  const [rate, setRate] = useState(1);
  const [repeat, setRepeat] = useState(false);
  const nativeMedia = useFolderMedia(row.bankId, source.audio ? { audio: source.audio } : undefined);
  const file = useLocalFileUrl(audio) ?? nativeMedia.urls?.audio;
  useEffect(() => { if (player.current) player.current.playbackRate = rate; }, [file, player, rate]);
  // 2026-11-27：切换录音或离开页面时暂停已挂载的音轨。
  useEffect(() => {
    const element = player.current;
    return () => { element?.pause(); };
  }, [file, player]);
  // 2026-11-20：播放状态跟随媒体事件，切换录音后按新录音刷新。
  const [track, setTrack] = useState({ time: 0, duration: 0, playing: false, volume: 1 });
  const [error, setError] = useState("");
  const positionRestored = useRef(false);
  function syncAudio(audio: HTMLAudioElement) {
    setTrack({ time: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      playing: !audio.paused && !audio.ended, volume: audio.volume });
    onPosition?.(audio.currentTime);
  }
  function togglePlayback() {
    const element = player.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setError("暂时无法播放此音频。"));
    else element.pause();
  }
  const playbackLabel = track.playing ? "暂停播放" : "播放";
  const suppliedAudio = Boolean(source.audio);
  // 2026-11-21：作答计时从零开始，精听沿用独立的播放器布局。
  const showAttemptHeader = attemptElapsedMs !== undefined;
  // 2026-11-27：两种精听布局共用语速和循环控件。
  const listeningPreferences = listen && <>
    <label>语速 <select value={rate} onChange={(event) => setRate(Number(event.target.value))}>
      {[0.75, 1, 1.25, 1.5].map((value) => <option key={value} value={value}>{value}×</option>)}
    </select></label>
    <label><input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} /> 循环播放</label>
  </>;
  return <>
    {/* 2026-11-21：题名放在音轨左侧，宽度不足时播放器内部换行。 */}
    <div className={`listening-player${showAttemptHeader ? " listening-attempt-player" : ""}${compact ? " listening-player-compact" : ""}`}>
      {showAttemptHeader && <h2 className="listening-attempt-title">{row.title}</h2>}
      <div className="listening-track">
        {file ? <>
          <audio ref={player} src={file} loop={repeat} preload="metadata"
            onLoadStart={({ currentTarget }) => { setError(""); syncAudio(currentTarget); }}
            onLoadedMetadata={({ currentTarget }) => {
              if (!positionRestored.current && position > 0 && position < currentTarget.duration) {
                currentTarget.currentTime = position;
              }
              positionRestored.current = true;
              syncAudio(currentTarget);
            }}
            onPlay={({ currentTarget }) => { syncAudio(currentTarget); onPlay?.(); }}
            onPause={({ currentTarget }) => { syncAudio(currentTarget); onPause?.(); }}
            onEnded={({ currentTarget }) => syncAudio(currentTarget)}
            onTimeUpdate={({ currentTarget }) => syncAudio(currentTarget)}
            onSeeked={({ currentTarget }) => syncAudio(currentTarget)}
            onVolumeChange={({ currentTarget }) => syncAudio(currentTarget)}
            onError={() => setError("暂时无法播放此音频。")} />
          <button type="button" className="listening-play-toggle" onClick={togglePlayback} disabled={playbackLocked}
            aria-label={playbackLabel} title={playbackLabel}>
            {track.playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
          </button>
          <input type="range" min={0} max={track.duration || 1} step="any" value={track.time}
            aria-label="播放进度" disabled={playbackLocked || !track.duration} onChange={(event) => {
              const element = player.current;
              if (!element) return;
              element.currentTime = Number(event.currentTarget.value);
              syncAudio(element);
            }} />
          <span className="listening-time">{formatClock(track.time * 1000)} / {formatClock(track.duration * 1000)}</span>
        </> : <span className="muted">{nativeMedia.loading ? "正在加载音频…" : suppliedAudio ? "本地音频不可用" : "请选择本节音频"}</span>}
      </div>
      <div className="listening-player-actions">
        {actions}
        {file && <label className="listening-volume"><Volume2 size={17} aria-hidden="true" />
          <input type="range" min={0} max={1} step={0.05} value={track.volume} aria-label="音量" onChange={(event) => {
            if (player.current) player.current.volume = Number(event.currentTarget.value);
          }} />
        </label>}
        {compact && listeningPreferences}
        {/* 2026-11-21：作答用时放在右端，与进度条旁的播放时间区分。 */}
        {showAttemptHeader && <span className="time listening-attempt-time" role="timer" aria-label="作答计时" title="作答计时">
          {formatClock(attemptElapsedMs)}
        </span>}
      </div>
    </div>
    {error && <p className="notice danger" role="alert">{error}</p>}
    <div className="table-actions listening-media">
    {/* 2026-11-20：已有可读录音的本地题源直接使用，兼容旧资料的手选音频。 */}
    {!nativeMedia.urls?.audio && !nativeMedia.loading && <label className="button secondary file-button"><FileAudio size={16} />{file ? "更换音频" : "选择音频"}
      <input type="file" accept="audio/*,.m4a,.mp3,.wav" onChange={(event) => setAudio(event.currentTarget.files?.[0])} />
    </label>}
    {/* 2026-11-23：展示与本节关联的本地参考资料。 */}
    {row.source.type === "folder" && row.source.entry.pdf && <LocalPdf folderId={row.bankId} relative={row.source.entry.pdf} />}
    {!compact && listeningPreferences}
    </div>
  </>;
}

// 2026-11-27：独立精听和答题页的精听原文使用相同的批注来源。
function useTranscriptHighlights(rowId: string | undefined) {
  const root = useRef<HTMLOListElement>(null);
  const saved = useSavedListeningHighlights(rowId ? `transcript:${rowId}` : undefined);
  return { root, block: "data-listening-sentence", ...saved };
}

function ListeningReference({ row, source, back, listen }: { row: ListeningRow; source: SectionContent; back: string; listen: boolean }) {
  const player = useRef<HTMLAudioElement>(null);
  // 2026-11-27：独立精听的工具栏仅接收原文选区。
  const annotations = useTranscriptHighlights(listen && source.transcript?.length ? row.id : undefined);
  // 2026-11-21：有精听原文时，用剩余高度展示可滚动的句子列表。
  return <section className={listen && source.transcript?.length ? "card exercise-page" : "card"}>
    <Link className="back-link" to={back}>返回听力题库</Link>
    {/* 2026-11-20：音频练习标题与列表中的精听入口一致。 */}
    <h2>{row.title}{listen && <small className="muted">精听</small>}</h2>
    {/* 2026-11-27：独立页面和答题页右侧共用精听播放器和逐句原文。 */}
    {listen ? <ListeningIntensive row={row} source={source} player={player} annotations={annotations} />
      : <ListeningMedia row={row} source={source} player={player} />}
    {!listen && source.questionText && <div className="listening-question-text" lang="en">{source.questionText}</div>}
    {!listen && <p className="notice">本节需要能识别的 10 道题和标准答案才能评分。{source.problem && ` ${source.problem}`}</p>}
  </section>;
}

// 2026-11-27：复用独立精听页的播放控件、逐句定位和原文高亮。
// 2026-11-27：独立精听可在原文上做批注，侧边精听也显示已保存的原文高亮。
function ListeningIntensive({ row, source, player, annotations, onPlay, compact = false }: {
  row: ListeningRow; source: SectionContent; player: RefObject<HTMLAudioElement>;
  annotations: ReturnType<typeof useTranscriptHighlights>; onPlay?: () => void; compact?: boolean;
}) {
  // 2026-11-20：跟随音频时间高亮当前句，点击原文可定位。
  const [position, setPosition] = useState(0);
  const highlighted = useRef<HTMLLIElement>(null);
  // 2026-11-27：同一个原文节点用于绘制已存高亮和判定工具栏选区。
  useListeningHighlightPaint(annotations.root, annotations.block, annotations.highlights, source.transcript);
  const currentSentence = source.transcript?.findIndex(({ start, end }) =>
    start !== undefined && end !== undefined && position >= start && position < end);
  useEffect(() => { highlighted.current?.scrollIntoView({ block: "nearest" }); }, [currentSentence]);
  return <>
    {/* 2026-11-20：精听在播放条下方展示逐句原文。 */}
    <ListeningMedia row={row} source={source} player={player} listen compact={compact} onPosition={setPosition} onPlay={onPlay} />
    {!compact && <ListeningHighlightActions targets={[annotations]} label="原文高亮" />}
    {source.transcript?.length ? <ol ref={annotations.root} className="listening-transcript" aria-label="听力原文" lang="en">
      {source.transcript.map(({ text, start }, index) => <li key={index} data-listening-sentence={index}
        ref={index === currentSentence ? highlighted : undefined} aria-current={index === currentSentence ? "true" : undefined}>
        {start === undefined ? text : <button type="button" onClick={() => {
          const element = player.current;
          if (!element || !Number.isFinite(element.duration) || window.getSelection()?.isCollapsed === false) return;
          element.currentTime = Math.min(start, element.duration);
          setPosition(element.currentTime);
        }}><span className="listening-time">{formatClock(start * 1000)}</span><span>{text}</span></button>}
      </li>)}
    </ol> : <p className="muted" role="status">{source.problem || "本节暂无听力原文。"}</p>}
  </>;
}

// 2026-11-27：精听面板打开时才读取对应的录音和逐句原文。
// 2026-11-27：读取结果和原文批注来自共同的题面工具栏。
function ListeningIntensivePane({ id, row, source, problem, player, onPlay, annotations }: {
  id: string; row: ListeningRow; source?: SectionContent; problem?: string; player: RefObject<HTMLAudioElement>; onPlay: () => void;
  annotations: ReturnType<typeof useTranscriptHighlights>;
}) {
  return <aside id={id} className="card listening-intensive-pane" aria-label="精听">
    {source ? <ListeningIntensive row={row} source={source} player={player} annotations={annotations} onPlay={onPlay} compact />
      : problem ? <p className="notice danger" role="alert">{problem}</p>
      : <p className="muted" role="status">正在读取精听资料…</p>}
  </aside>;
}

// 2026-11-27：工具栏保留高亮操作，精听展开后题面和原文各自滚动。
function ListeningQuestionLayout({ intensiveRow, intensiveSource, player, intensivePlayer, questionAnnotations, children }: {
  intensiveRow: ListeningRow; player: RefObject<HTMLAudioElement>; intensivePlayer: RefObject<HTMLAudioElement>;
  intensiveSource?: SectionContent; questionAnnotations: ListeningHighlightTarget; children: ReactNode;
}) {
  const [showIntensive, setShowIntensive] = useState(false);
  const intensiveId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  // 2026-11-27：沿用已加载的同源录音，展开后才读取备用精听题源及原文批注。
  const intensive = useQuery({ queryKey: ["listening-asset", intensiveRow.bankId, intensiveRow.id],
    queryFn: () => loadSection(intensiveRow), enabled: showIntensive && !intensiveSource });
  const content = intensiveSource ?? intensive.data;
  const hasTranscript = showIntensive && Boolean(content?.transcript?.length);
  const transcriptAnnotations = useTranscriptHighlights(hasTranscript ? intensiveRow.id : undefined);
  function closeIntensive() {
    intensivePlayer.current?.pause();
    setShowIntensive(false);
    toggle.current?.focus();
  }
  return <>
    <div className="listening-question-toolbar">
      {/* 2026-11-27：选区位于哪一栏就更新哪一栏，沿用同一组按钮。 */}
      <ListeningHighlightActions targets={hasTranscript ? [questionAnnotations, transcriptAnnotations] : [questionAnnotations]}
        label={hasTranscript ? "题面与原文高亮" : "题面高亮"} />
      <button ref={toggle} type="button" className="button secondary listening-intensive-toggle" aria-expanded={showIntensive}
        aria-controls={showIntensive ? intensiveId : undefined}
        onClick={() => {
          if (showIntensive) closeIntensive();
          else {
            player.current?.pause();
            setShowIntensive(true);
          }
        }}>
        <Headphones size={16} aria-hidden="true" /> 精听
      </button>
    </div>
    <div className={showIntensive ? "listening-question-layout with-intensive" : "listening-question-layout"}>
      <div className="listening-question-content">{children}</div>
      {showIntensive && <ListeningIntensivePane id={intensiveId} row={intensiveRow} source={content}
        problem={intensive.error ? errorText(intensive.error) : undefined} player={intensivePlayer}
        annotations={transcriptAnnotations} onPlay={() => player.current?.pause()} />}
    </div>
  </>;
}

// 2026-11-27：用交卷快照中的答案和得分标记题面，复选和合并填空细分到每个输入位。
function listeningAnswerFeedback(details: AnswerResult[] | undefined, pairs: ListeningAnswerPair[] = [], answers: Answers): AnswerFeedback | undefined {
  if (!details?.length) return undefined;
  const results = new Map(details.map((detail) => [detail.questionId, detail]));
  const paired = new Map<string, boolean>();
  for (const { ids: [first, second], exchange } of pairs) {
    const detail = results.get(first);
    if (Number(second.slice(1)) <= 40 || !detail || !Array.isArray(detail.correctAnswer)) continue;
    const [firstKey, secondKey] = detail.correctAnswer;
    const left = answers[first] ?? null;
    const right = answers[second] ?? null;
    let leftMatches = answersMatch(left, firstKey ?? null);
    let rightMatches = answersMatch(right, secondKey ?? null);
    if (exchange && Number(leftMatches) + Number(rightMatches) < 2) {
      const swappedLeft = answersMatch(left, secondKey ?? null);
      const swappedRight = answersMatch(right, firstKey ?? null);
      if (Number(swappedLeft) + Number(swappedRight) > Number(leftMatches) + Number(rightMatches)) {
        leftMatches = swappedLeft;
        rightMatches = swappedRight;
      }
    }
    const fullyCorrect = detail.possible > 0 && detail.points === detail.possible;
    paired.set(first, fullyCorrect || leftMatches);
    paired.set(second, fullyCorrect || rightMatches);
  }
  return (ids, value, checkbox) => {
    const id = ids[0];
    const detail = results.get(id);
    if (paired.has(id)) return paired.get(id) ? "correct" : "incorrect";
    if (!detail || detail.possible <= 0) return undefined;
    if (checkbox && (ids.length > 1 || Array.isArray(detail.correctAnswer))) {
      return ids.some((questionId) => answersMatch(value, results.get(questionId)?.correctAnswer ?? null)) ? "correct" : "incorrect";
    }
    return detail.points === detail.possible ? "correct" : "incorrect";
  };
}

// 2026-11-27：作答、交卷和回看沿用同一份原题面及高亮绘制逻辑。
function ListeningQuestionPaper({ source, exam, answers, disabled, imagesLoading, media, paper, highlights, details, onChange }: {
  source: SectionContent; exam: ReadingExam; answers: Answers; disabled: boolean; imagesLoading: boolean;
  media: (name: string) => string | undefined; paper: RefObject<HTMLDivElement>; onChange?: (patch: Answers) => void;
  highlights: PassageHighlight[]; details?: AnswerResult[];
}) {
  const block = source.part ? "data-listening-question" : "data-reading-group";
  useListeningHighlightPaint(paper, block, highlights, imagesLoading ? undefined : exam, media);
  const answerFeedback = useMemo(() => listeningAnswerFeedback(details, source.pairs, answers), [details, source.pairs, answers]);
  // 2026-11-23：旧 JSON 题面以题号定位题干，导出题面以原题组定位。
  return source.part ? <div className="card listening-questions" ref={paper}>
    {source.part.questions.map((question, index) => {
      const id = exam.questionOrder[index];
      const value = typeof answers[id] === "string" ? answers[id] as string : "";
      // 2026-11-27：旧 JSON 题面的下拉和输入框也用交卷时的实际结果上色。
      const feedback = value.trim() ? answerFeedback?.([id], value) : undefined;
      // 2026-11-23：为文字题干标记稳定范围，答案输入控件独立显示。
      return <label key={id}><span data-listening-question={id}>{id.slice(1)}. {question.prompt}</span>
        {question.options ? <select disabled={disabled} value={value} data-answer-feedback={feedback}
          onChange={(event) => onChange?.({ [id]: event.target.value })}>
          <option value="">选择答案</option>{question.options.map((option, position) => <option key={position} value={option}>{option}</option>)}
        </select> : <input disabled={disabled} value={value} data-answer-feedback={feedback}
          onChange={(event) => onChange?.({ [id]: event.target.value })} />}
      </label>;
    })}
  </div> : !imagesLoading && <div className="local-listening-paper" ref={paper}>
    <ReadingPaper exam={exam} answers={answers} disabled={disabled} mediaUrl={media} answerFeedback={answerFeedback}
      onChange={(patch) => onChange?.(patch)} onCoverage={() => {}} />
  </div>;
}

// 2026-11-27：旧记录只有逐题结果时，用保存的答案回填成对输入位。
function savedListeningAnswers(record: PracticeRecord, pairs: ListeningAnswerPair[] = []): Answers {
  if (record.answers) return record.answers;
  const answers: Answers = Object.fromEntries((record.details ?? []).map(({ questionId, userAnswer }) => [questionId, userAnswer]));
  for (const { ids: [first, second] } of pairs) {
    const pair = answers[first];
    if (Number(second.slice(1)) <= 40 || !Array.isArray(pair)) continue;
    answers[first] = pair[0] === "—" ? "" : pair[0] ?? null;
    answers[second] = pair[1] === "—" ? "" : pair[1] ?? null;
  }
  return answers;
}

// 2026-11-27：显示已保存的判分，题库答案后续更新时历史成绩仍按交卷记录展示。
function ListeningResult({ record, source }: { record: PracticeRecord; source: SectionContent }) {
  const details = record.details ?? [];
  return <>
    {/* 2026-11-21：交卷后可在得分下方直接查看本节的解析。 */}
    <AnswerReview details={details} explanation={listeningExplanation(source, details)} showOutcome
      headingAside={<b className="listening-compare-score">答对 {record.points}/{record.possible}</b>} />
  </>;
}

// 2026-11-27：历史回看保留原题面和精听，使用最近一次交卷的答案及判分。
function ListeningResultPage({ row, source, record, back, intensiveRow }: {
  row: ListeningRow; source: SectionContent; record: PracticeRecord; back: string; intensiveRow: ListeningRow;
}) {
  const player = useRef<HTMLAudioElement>(null);
  const intensivePlayer = useRef<HTMLAudioElement>(null);
  // 2026-11-27：回看时保存个人高亮，已提交的答案和评分保持只读。
  const paper = useRef<HTMLDivElement>(null);
  const saved = useSavedListeningHighlights(`question:${record.id}`, record.questionHighlights);
  const images = useFolderMedia(row.bankId, source.images);
  const media = useCallback((name: string) => images.urls?.[name], [images.urls]);
  return <section className="listening-section exercise-page">
    <ListeningMedia row={row} source={source} player={player} attemptElapsedMs={record.elapsedMs ?? 0}
      onPlay={() => intensivePlayer.current?.pause()}
      actions={<Link className="button secondary" to={back}>返回听力题库</Link>} />
    <ListeningQuestionLayout intensiveRow={intensiveRow} intensiveSource={row.id === intensiveRow.id ? source : undefined}
      player={player} intensivePlayer={intensivePlayer}
      questionAnnotations={{ ...saved, root: paper, block: source.part ? "data-listening-question" : "data-reading-group",
        disabled: saved.disabled || !source.exam || (!source.part && images.loading) }}>
      <ListeningResult record={record} source={source} />
      {source.exam ? <ListeningQuestionPaper source={source} exam={source.exam} answers={savedListeningAnswers(record, source.pairs)}
        disabled imagesLoading={images.loading} media={media} paper={paper} highlights={saved.highlights} details={record.details} />
        : <p className="notice" role="status">{source.problem || "本节原题面暂不可用。"}</p>}
    </ListeningQuestionLayout>
  </section>;
}

function updateDraftCache(cache: ReturnType<typeof useQueryClient>, id: string, draft?: ListeningDraft) {
  cache.setQueryData<Document<ListeningDraft>[]>(documentsKey("listening-drafts"), (previous) => [
    ...(previous ?? []).filter((item) => item.id !== id),
    ...(draft ? [{ collection: "listening-drafts" as const, id, value: draft }] : []),
  ]);
}

// 2026-11-20：续做页收到重开回调后，可重新开始本节。
// 2026-11-27：答题时可以在右侧打开同一节的精听。
function SectionAttempt({ row, source, exam, prior, restart, onRestart, back, intensiveRow }: {
  row: ListeningRow; source: SectionContent; exam: ReadingExam; prior?: ListeningDraft; restart: boolean; back: string;
  onRestart: () => void; intensiveRow: ListeningRow;
}) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  // 2026-11-20：只在旧链接显式带有重开模式时清理 URL 参数。
  const [search, setSearch] = useSearchParams();
  const [resumed] = useState(!restart && prior?.examId === row.examId && prior.bankId === row.bankId);
  const [base] = useState<ListeningDraft>(() => resumed && prior ? prior : {
    id: crypto.randomUUID(), revision: 0, bankId: row.bankId, examId: row.examId, startedAt: "",
    elapsedMs: 0, position: 0, answers: {},
  });
  const expected = useRef(prior ? { id: prior.id, revision: prior.revision } : null);
  const startTime = useRef(base.startedAt);
  const [answers, setAnswers] = useState(base.answers);
  const latestAnswers = useRef(answers);
  // 2026-11-23：续做时读取本节题面高亮，选区提示只在作答页内显示。
  const [questionHighlights, setQuestionHighlights] = useState<PassageHighlight[]>(base.questionHighlights ?? []);
  const latestHighlights = useRef(questionHighlights);
  const questionPaper = useRef<HTMLDivElement>(null);
  const highlightBlock = source.part ? "data-listening-question" : "data-reading-group";
  const [active, setActive] = useState(false);
  // 2026-11-20：暂停练习时冻结计时和作答，并记住是否需要恢复播放。
  const [paused, setPaused] = useState(false);
  const resumePlayback = useRef(false);
  const [saveError, setSaveError] = useState("");
  const saveTail = useRef(Promise.resolve());
  const player = useRef<HTMLAudioElement>(null);
  // 2026-11-27：主播放器和精听播放器轮流播放。
  const intensivePlayer = useRef<HTMLAudioElement>(null);
  const frozen = useRef<{ record: PracticeRecord; expected: ListeningDraft }>();
  const images = useFolderMedia(row.bankId, source.images);
  const media = useCallback((name: string) => images.urls?.[name], [images.urls]);
  const [savingResult, setSavingResult] = useState(false);
  // 2026-11-20：交卷期间停止音频，暂停事件不另存一份草稿。
  const submitting = useRef(false);
  // 2026-11-20：暂停答题时停止累计练习时间。
  const clock = usePracticeClock(base.elapsedMs, active && !paused && !savingResult && !frozen.current);

  function persist(next = latestAnswers.current) {
    // 2026-11-23：题面高亮与作答、计时和音频位置一起写入有版本的草稿。
    const snapshot = { ...base, startedAt: startTime.current, elapsedMs: clock.elapsed(),
      position: player.current?.currentTime ?? base.position, answers: next, questionHighlights: latestHighlights.current };
    const pending = saveTail.current.then(async () => {
      const draft = await desktop.saveListeningDraft(row.id, { ...snapshot, revision: (expected.current?.revision ?? 0) + 1 }, expected.current);
      expected.current = { id: draft.id, revision: draft.revision };
      updateDraftCache(cache, row.id, draft);
      return draft;
    });
    saveTail.current = pending.then(() => setSaveError(""), (error: unknown) => setSaveError(errorText(error)));
    return pending;
  }

  function change(patch: Answers) {
    const next = { ...latestAnswers.current, ...patch };
    latestAnswers.current = next;
    setAnswers(next);
    void persist(next).catch(() => undefined);
  }

  const start = useMutation({
    mutationFn: () => {
      if (!startTime.current) startTime.current = new Date().toISOString();
      return persist();
    },
    onSuccess: () => {
      setActive(true);
      if (restart && search.get("mode") === "restart") setSearch((current) => {
        const next = new URLSearchParams(current);
        next.delete("mode");
        return next;
      }, { replace: true });
    },
  });
  const leave = useMutation({
    mutationFn: () => persist(),
    onSuccess: () => navigate(back),
  });
  const submit = useMutation({
    // 2026-11-20：交卷前保留当前音频位置，停止继续播放。
    onMutate: () => {
      submitting.current = true;
      player.current?.pause();
      setSavingResult(true);
    },
    mutationFn: async () => {
      if (!frozen.current) {
        const saved = await persist();
        // 2026-11-20：保留原有记录协议，每节始终生成十条判分结果。
        const details = scoreListeningExport(exam, saved.answers, source.pairs);
        frozen.current = { expected: saved, record: {
          id: saved.id, kind: "listening", source: "desktop", title: row.title, bankId: row.bankId, examId: row.examId,
          category: `P${row.section}`, startedAt: saved.startedAt, submittedAt: new Date().toISOString(), elapsedMs: saved.elapsedMs,
          // 2026-11-27：交卷时留存草稿里的高亮供历史回看。
          questionHighlights: saved.questionHighlights,
          answers: saved.answers, details, points: details.reduce((sum, item) => sum + item.points, 0), possible: questionsPerSection,
        } };
      }
      const { record, expected } = frozen.current;
      return desktop.submitListeningSection(row.id, record, { id: expected.id, revision: expected.revision });
    },
    onSuccess: (record) => {
      updateDraftCache(cache, row.id);
      cache.setQueryData<PracticeRecord[]>(recordsKey, (records) => [record, ...(records ?? []).filter(({ id }) => id !== record.id)]);
      void cache.invalidateQueries({ queryKey: recordsKey });
    },
    // 2026-11-20：保存请求结束后恢复正常的音频暂停处理。
    onSettled: () => {
      submitting.current = false;
      setSavingResult(false);
    },
  });
  const result = submit.data;
  // 2026-11-27：交卷前更新草稿，交卷后的高亮作为本次成绩的个人批注保存。
  const reviewHighlights = useSavedListeningHighlights(result ? `question:${result.id}` : undefined, result?.questionHighlights);
  const displayedHighlights = result ? reviewHighlights.highlights : questionHighlights;
  // 2026-11-20：在顶部安全地暂停、退出和交卷，并继续使用现有的草稿与评分。
  const disabled = !active || paused || savingResult || submit.isPending || Boolean(frozen.current) || leave.isPending;
  const error = saveError || (submit.error && errorText(submit.error));
  function updateQuestionHighlights(next: PassageHighlight[]) {
    if (result) {
      reviewHighlights.update(next);
      return;
    }
    latestHighlights.current = next;
    setQuestionHighlights(next);
    void persist().catch(() => undefined);
  }

  function toggleAttemptPause() {
    const element = player.current;
    if (paused) {
      setPaused(false);
      if (element && resumePlayback.current) void element.play().catch(() => undefined);
    } else {
      resumePlayback.current = Boolean(element && !element.paused && !element.ended);
      element?.pause();
      setPaused(true);
      void persist().catch(() => undefined);
    }
  }
  function confirmSubmission() {
    if (!source.graded) return;
    if (!frozen.current) {
      const answered = answeredReadingQuestions(exam, latestAnswers.current);
      const extraSlots = new Set<string>();
      for (const { ids: [first, second] } of source.pairs ?? []) {
        if (Number(second.slice(1)) <= 40) continue;
        extraSlots.add(second);
        if (!answered.has(second)) answered.delete(first);
      }
      const unanswered = exam.questionOrder.filter((id) => !extraSlots.has(id) && !answered.has(id)).length;
      if (unanswered && !window.confirm(`还有 ${unanswered} 题未作答。确定交卷吗？`)) return;
    }
    submit.mutate();
  }
  // 2026-11-21：答题时展开题面，交卷后保留题目和解析的纵向滚动。
  // 2026-11-27：交卷后沿用并排布局，原题和解析可以一起滚动。
  return <section className="listening-section exercise-page">
    {/* 2026-11-20：答题操作置于题面上方的音频条右侧。 */}
    {/* 2026-11-21：把作答计时与题名放入播放器所在的一行。 */}
    <ListeningMedia row={row} source={source} player={player} position={base.position}
      attemptElapsedMs={result?.elapsedMs ?? clock.elapsedMs}
      playbackLocked={paused || savingResult || submit.isPending || leave.isPending}
      onPause={() => { if (active && !disabled && !submitting.current) void persist().catch(() => undefined); }}
      onPlay={() => intensivePlayer.current?.pause()}
      actions={<>
        {!active ? <button type="button" className="button primary" onClick={() => start.mutate()} disabled={start.isPending}>
          {resumed ? "继续答题" : "开始答题"}
        </button> : !result && <button type="button" className="button secondary" onClick={toggleAttemptPause}
          disabled={savingResult || submit.isPending || Boolean(frozen.current) || leave.isPending}>
          {paused ? "继续答题" : "暂停答题"}
        </button>}
        {active && !frozen.current ? <button type="button" className="button secondary" onClick={() => leave.mutate()}
          disabled={leave.isPending || savingResult || submit.isPending}>退出练习</button>
          : submit.isPending ? <button type="button" className="button secondary" disabled>退出练习</button>
          : <Link className="button secondary" to={back}>退出练习</Link>}
        {!result && <button type="button" className="button primary" onClick={confirmSubmission}
          disabled={!source.graded || !active || paused || submit.isPending || leave.isPending}>
          {frozen.current ? "重试提交" : "交卷"}
        </button>}
      </>} />
    {error && <p className="notice danger" role="alert">{error}</p>}
    {/* 2026-11-20：只有题面时允许完成草稿，评分入口等标准答案就绪。 */}
    {!source.graded && <p className="notice" role="status">本节缺少标准答案，作答可保存为草稿。</p>}
    {/* 2026-11-27：高亮和精听同排，原题面及交卷结果保留在左侧。 */}
    <ListeningQuestionLayout intensiveRow={intensiveRow} intensiveSource={row.id === intensiveRow.id ? source : undefined}
      player={player} intensivePlayer={intensivePlayer}
      questionAnnotations={{ root: questionPaper, block: highlightBlock, highlights: displayedHighlights, update: updateQuestionHighlights,
        disabled: (!source.part && images.loading) || (result ? reviewHighlights.disabled : disabled),
        problem: result ? reviewHighlights.problem : undefined }}>
      {/* 2026-11-27：交卷后的原题统一回填数据库返回的答案快照。 */}
      <ListeningQuestionPaper source={source} exam={exam} answers={result?.answers ?? answers} disabled={disabled} imagesLoading={images.loading}
        media={media} paper={questionPaper} highlights={displayedHighlights} details={result?.details} onChange={change} />
      {result && <ListeningResult record={result} source={source} />}
    </ListeningQuestionLayout>
    <div className="table-actions listening-attempt-actions">
      {/* 2026-11-20：统一列表入口后，续做时仍可确认重开。 */}
      {resumed && !active && <button type="button" className="button secondary" disabled={start.isPending} onClick={() => {
        if (window.confirm("重新做题会替换本节未提交的草稿。继续吗？")) onRestart();
      }}>重新做题</button>}
    </div>
  </section>;
}
