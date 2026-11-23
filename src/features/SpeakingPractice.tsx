// 2026-11-21：口语真题详情按分 Part 的阶段、轮数和时间运行语音问答。
// 2026-11-21：考官音色偏好沿用工作区设置存储。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// 2026-11-21：语音气泡负责播放图标，练习页保留麦克风图标。
import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { speakingTopicId } from "../domain/speaking";
import type { SpeakingTopic } from "../domain/speaking";
// 2026-11-21：本机合成与考官音色选择使用统一标识。
import { defaultExaminerVoice, examinerVoices, isExaminerVoice } from "../domain/kokoroSpeech";
import type { ExaminerVoice } from "../domain/kokoroSpeech";
import {
  // 2026-11-22：选题页面提交提示词文档标识与实际对话数据。
  awaitingQuestion, beginLongTurn, examinerRequest, finishSpeaking, pauseSpeaking, recordSpeakingAnswer, speakingDeadline,
  speakingElapsed, speakingLimits, speakingRoundCount, startSpeakingSession,
} from "../domain/speakingPractice";
import type { SpeakingMessage, SpeakingSession } from "../domain/speakingPractice";
import { desktop, desktopAvailable, documentsKey, errorText } from "../services/desktop";
import type { Document } from "../services/desktop";
// 2026-11-21：考官问题交给后台 Kokoro 合成。
import { createKokoroSpeech } from "../services/kokoroSpeech";
import { formatClock } from "./reading/usePracticeClock";
// 2026-11-21：对话语音条和原录音播放独立于作答表单。
import { SpeakingMessages, useSpeakingPlayback } from "./SpeakingMessages";
import { useSpeakingRecorder } from "./useSpeakingRecorder";
import type { SpeakingAudio } from "./useSpeakingRecorder";

const sessionsKey = documentsKey("speaking-sessions");
// 2026-11-21：保存开始下一轮时使用的考官音色。
const voicePreferenceKey = "speaking-examiner-voice";
const statuses = { questions: "问答", prepare: "准备", "long-turn": "陈述", "follow-up": "追问", finished: "已结束" };
const endLabels = { time: "时间到", rounds: "已完成规定轮数", manual: "已结束练习" };

// 2026-11-21：本次录音可在发送前试听，按会话隔离。
interface VoiceDraft {
  sessionId: string;
  url: string;
  durationMs: number;
  // 2026-11-21：同一份试听用 WAV 在发送时附加到本机对话记录。
  id: string;
  blob: Blob;
}

// 2026-11-21：用请求对象隔离停止、切换音色或离开后的过期播放。
interface SynthesizedQuestion {
  audio?: HTMLAudioElement;
  url?: string;
}

// 2026-11-21：录音保存沿用 JSON 备份格式，转写继续使用原始 WAV。
function encodeRecording(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const fail = () => reject(new Error("无法读取本次录音。"));
    reader.onerror = fail;
    reader.onabort = fail;
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.startsWith("data:audio/wav;base64,")) {
        fail();
        return;
      }
      resolve(reader.result.slice("data:audio/wav;base64,".length));
    };
    reader.readAsDataURL(blob);
  });
}

function canTranscribe(models: Awaited<ReturnType<typeof desktop.aiModels>> | undefined) {
  const active = models?.find((model) => model.active);
  if (!active?.hasApiKey) return false;
  try {
    const url = new URL(active.baseUrl);
    return url.origin === "https://api.deepseek.com";
  } catch { return false; }
}

function firstQuestion(content: string) {
  const question = content.trim().match(/[^?]*\?/)?.[0]?.trim();
  if (!question) throw new Error("考官未返回问题，请重试。");
  return question;
}

export function SpeakingPractice({ topic }: { topic: SpeakingTopic }) {
  const enabled = desktopAvailable();
  const cache = useQueryClient();
  const records = useQuery({ queryKey: sessionsKey, queryFn: () => desktop.documents<SpeakingSession>("speaking-sessions"), enabled });
  const models = useQuery({ queryKey: ["ai-model-connections"], queryFn: desktop.aiModels, enabled });
  // 2026-11-21：记住考试外选择的音色，场内回放使用会话中的音色。
  const voicePreference = useQuery({
    queryKey: documentsKey("settings"), queryFn: () => desktop.documents<unknown>("settings"), enabled,
    select: (values) => {
      const voice = values.find(({ id }) => id === voicePreferenceKey)?.value;
      return isExaminerVoice(voice) ? voice : defaultExaminerVoice;
    },
  });
  const voiceChange = useMutation({
    mutationFn: (voice: ExaminerVoice) => desktop.put("settings", voicePreferenceKey, voice),
    onSuccess: () => cache.invalidateQueries({ queryKey: documentsKey("settings") }),
    onError: (reason) => setError(errorText(reason)),
  });
  const nextVoice = (voiceChange.isPending ? voiceChange.variables : voicePreference.data) ?? defaultExaminerVoice;
  const [selectedId, setSelectedId] = useState<string>();
  const sessions = (records.data ?? []).map(({ value }) => value).filter((item) => item.topicId === speakingTopicId(topic))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const session = sessions.find(({ id }) => id === selectedId) ?? sessions[0];
  const [input, setInput] = useState("");
  // 2026-11-21：转写先进入输入框，录音仅用于本轮预览。
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft>();
  const previewAudio = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState("");
  // 2026-11-21：区分考官当前播报与考生原录音回放。
  const [playingQuestion, setPlayingQuestion] = useState<number>();
  const recordedAudio = useSpeakingPlayback(setError);
  const [operation, setOperation] = useState("");
  const [voicing, setVoicing] = useState(false);
  const [now, setNow] = useState(Date.now);
  const operationLock = useRef(false);
  const mounted = useRef(false);
  const activeVoice = useRef<SpeechSynthesisUtterance>();
  // 2026-11-21：同一页面复用一个合成线程及其已生成音频。
  const [kokoro] = useState(createKokoroSpeech);
  const activeKokoro = useRef<SynthesizedQuestion>();
  // 2026-11-21：每场练习自动尝试连接一次，避免授权未通过后反复弹窗。
  const microphoneSession = useRef<string>();
  const transcript = useRef<HTMLDivElement>(null);
  // 2026-11-21：Kokoro 优先，系统语音可在本地合成出错时继续播报。
  const hasSystemVoice = typeof window.speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
  const hasKokoro = typeof Worker !== "undefined";
  const hasVoice = hasKokoro || hasSystemVoice;
  const voiceInput = canTranscribe(models.data);
  const elapsed = session ? speakingElapsed(session, now) : 0;
  const remaining = session ? speakingDeadline(session) - elapsed : 0;
  // 2026-11-21：整场到点才释放，Part 2 各阶段之间复用同一设备。
  const totalTimeReached = Boolean(session && elapsed >= speakingLimits[session.part].totalMs);
  const replyNeeded = Boolean(session && awaitingQuestion(session));
  const isAnswerPhase = session?.phase === "long-turn" || session?.phase === "questions" || session?.phase === "follow-up";
  // 2026-11-21：即使在作答时间到点后，也允许确认到点前录下的回答。
  const voiceReview = voiceDraft?.sessionId === session?.id ? voiceDraft : undefined;
  const canAnswer = Boolean(isAnswerPhase && !replyNeeded && !operation
    && (voiceReview || (session?.runningSince != null && remaining > 0)));

  useEffect(() => {
    mounted.current = true;
    // 2026-11-21：进入话题时预加载模型，降低首个问题等待时间。
    if (hasKokoro) void kokoro.warm().catch(() => undefined);
    return () => {
      mounted.current = false;
      activeVoice.current = undefined;
      window.speechSynthesis?.cancel();
      // 2026-11-21：离开页面时释放生成音频及后台模型。
      disposeKokoroAudio();
      kokoro.close();
    };
  }, []);

  // 2026-11-21：发送、重录、切换会话或离开页面时释放临时试听地址。
  useEffect(() => {
    if (!voiceDraft) return;
    return () => URL.revokeObjectURL(voiceDraft.url);
  }, [voiceDraft]);

  useEffect(() => {
    if (!session || session.runningSince === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.runningSince]);

  useEffect(() => {
    const list = transcript.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [session?.id, session?.messages.length, operation]);

  useEffect(() => {
    if (session?.phase !== "finished") return;
    stopVoice();
  }, [session?.id, session?.phase]);

  function stopVoice() {
    activeVoice.current = undefined;
    window.speechSynthesis?.cancel();
    // 2026-11-21：同时停止本地合成的考官播报。
    disposeKokoroAudio();
    setVoicing(false);
    // 2026-11-21：停止考官播报时复位对应气泡。
    setPlayingQuestion(undefined);
  }

  // 2026-11-21：清理本机合成音频的播放器与临时地址。
  function disposeKokoroAudio() {
    const current = activeKokoro.current;
    activeKokoro.current = undefined;
    current?.audio?.pause();
    if (current?.url) URL.revokeObjectURL(current.url);
  }

  // 2026-11-21：系统播报作为 Kokoro 失败后的备用声音。
  function playSystemVoice(text: string, index?: number) {
    if (!hasSystemVoice) {
      stopVoice();
      setError("当前系统语音不可用，可展开「查看题目」看考官问题。");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    const completeVoice = () => {
      if (!mounted.current || activeVoice.current !== utterance) return false;
      activeVoice.current = undefined;
      setVoicing(false);
      // 2026-11-21：播报结束后恢复播放图标。
      setPlayingQuestion(undefined);
      return true;
    };
    utterance.onend = completeVoice;
    utterance.onerror = ({ error: reason }) => {
      if (!completeVoice() || reason === "canceled" || reason === "interrupted") return;
      setError("播报失败，可重听或展开「查看题目」。");
    };
    activeVoice.current = utterance;
    setVoicing(true);
    // 2026-11-21：单独的提示语不占据某条考官问题的播放状态。
    setPlayingQuestion(index);
    window.speechSynthesis.speak(utterance);
  }

  // 2026-11-21：语音条按会话音色播放，历史录音和考官问题互斥。
  async function play(text: string, index?: number, voice = session?.examinerVoice ?? defaultExaminerVoice,
    prepared?: ArrayBuffer | Error) {
    if (!mounted.current) return;
    if (index !== undefined && index === playingQuestion && (activeKokoro.current || activeVoice.current)) {
      stopVoice();
      return;
    }
    previewAudio.current?.pause();
    recordedAudio.stop();
    stopVoice();
    if (!hasKokoro) {
      playSystemVoice(text, index);
      return;
    }
    const current: SynthesizedQuestion = {};
    activeKokoro.current = current;
    setVoicing(true);
    setPlayingQuestion(index);
    const failed = (reason: unknown) => {
      if (activeKokoro.current !== current) return;
      disposeKokoroAudio();
      setError(hasSystemVoice ? `Kokoro 播报失败，已使用系统语音。 ${errorText(reason)}`
        : `Kokoro 播报失败，可右键显示问题。 ${errorText(reason)}`);
      if (hasSystemVoice) playSystemVoice(text, index);
      else stopVoice();
    };
    try {
      if (prepared instanceof Error) throw prepared;
      const wav = prepared ?? await kokoro.synthesize(text, voice);
      if (activeKokoro.current !== current) return;
      current.url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
      const audio = new Audio(current.url);
      current.audio = audio;
      audio.onended = () => { if (activeKokoro.current === current) stopVoice(); };
      audio.onerror = () => failed(new Error("无法播放合成音频。"));
      await audio.play();
    } catch (reason) {
      failed(reason);
    }
  }

  // 2026-11-21：自动提问先合成再开始作答计时，失败时交给备用播报处理。
  async function prepareQuestion(text: string, voice: ExaminerVoice) {
    if (!hasKokoro) return undefined;
    try { return await kokoro.synthesize(text, voice); }
    catch (reason) { return reason instanceof Error ? reason : new Error(errorText(reason)); }
  }

  // 2026-11-21：可选录音附件与本次消息使用同一个保存事务。
  async function persist(value: SpeakingSession, recording?: string) {
    const saved = await desktop.saveSpeakingSession({ ...value, updatedAt: new Date().toISOString() }, recording);
    cache.setQueryData<Document<SpeakingSession>[]>(sessionsKey, (prior) => [
      ...(prior ?? []).filter(({ id }) => id !== saved.id), { collection: "speaking-sessions", id: saved.id, value: saved },
    ]);
    if (mounted.current) { setSelectedId(saved.id); setNow(Date.now()); }
    return saved;
  }

  async function run(label: string, action: () => Promise<unknown>) {
    if (operationLock.current) return;
    operationLock.current = true;
    setOperation(label);
    setError("");
    try { await action(); }
    catch (reason) { if (mounted.current) setError(errorText(reason)); }
    finally {
      operationLock.current = false;
      if (mounted.current) { setOperation(""); setNow(Date.now()); }
    }
  }

  async function ask(value: SpeakingSession) {
    // 2026-11-21：退出话题后保留已保存的回答，下次打开时才继续提问和计时。
    if (!mounted.current || !awaitingQuestion(value)) return;
    // 2026-11-22：每次考官发问读取最新的系统和口语提示词。
    const reply = await desktop.generateText(examinerRequest(topic, value));
    if (!mounted.current) return;
    const content = firstQuestion(reply.content);
    // 2026-11-21：等待本地合成与等待文本模型使用同样的暂停计时规则。
    const voice = value.examinerVoice ?? defaultExaminerVoice;
    const prepared = await prepareQuestion(content, voice);
    if (!mounted.current) return;
    const time = Date.now();
    const message: SpeakingMessage = {
      role: "assistant", content, at: new Date(time).toISOString(), model: reply.model, elapsedMs: value.elapsedMs, phase: value.phase,
    };
    await persist({ ...value, runningSince: time, messages: [...value.messages, message] });
    // 2026-11-21：自动提问也高亮当前问题的语音条。
    // 2026-11-21：首个问题也使用新建会话记录的音色。
    if (hasVoice) void play(content, value.messages.length, voice, prepared);
  }

  // 2026-11-21：发送语音回答时同时保存原录音与校对后的文字。
  async function submit(value: SpeakingSession, body: string, inputType: "text" | "voice", draft?: VoiceDraft) {
    const recording = draft && await encodeRecording(draft.blob);
    const written = await persist(recordSpeakingAnswer(value, body, inputType, Date.now(), draft?.durationMs, draft?.id), recording);
    // 2026-11-21：确定保存成功后再清空输入和本次录音。
    if (mounted.current) { setInput(""); setVoiceDraft(undefined); }
    if (awaitingQuestion(written)) await ask(written);
  }

  function sendText() {
    if (!session || !input.trim() || !canAnswer || recorder.state !== "idle") return;
    // 2026-11-21：点发送才保存，保留已确认转写的语音输入来源。
    previewAudio.current?.pause();
    // 2026-11-21：点发送才将试听录音关联到对话。
    void run("正在处理回答…", () => submit(session, input, voiceReview ? "voice" : "text", voiceReview));
  }

  function sendAudio(audio: SpeakingAudio) {
    if (!session || !isAnswerPhase || replyNeeded || session.runningSince === null) return;
    // 2026-11-21：用松手时间暂停计时，留待试听、编辑和确认，不在这里提交。
    void run("正在转写录音…", async () => {
      // 2026-11-21：最后一段录音已收齐，到达整场上限时在转写前释放设备。
      const paused = pauseSpeaking(session, audio.endedAt);
      if (paused.elapsedMs >= speakingLimits[paused.part].totalMs) releaseMicrophone();
      await persist(paused);
      if (!mounted.current) return;
      const recording = new Blob([new Uint8Array(audio.bytes)], { type: "audio/wav" });
      // 2026-11-21：固定草稿录音标识，保存失败时可重试该次发送。
      setVoiceDraft({ sessionId: session.id, url: URL.createObjectURL(recording), durationMs: audio.durationMs,
        id: crypto.randomUUID(), blob: recording });
      setInput("");
      const text = await desktop.transcribeSpeakingAudio(audio.bytes);
      if (mounted.current) setInput(text);
    });
  }

  // 2026-11-21：重录恢复当前题计时，保留已完成的问答轮次。
  function discardForRetake() {
    if (!session || !voiceReview || remaining <= 0) return;
    previewAudio.current?.pause();
    void run("正在准备重录…", async () => {
      await persist({ ...session, runningSince: Date.now() });
      if (mounted.current) { setInput(""); setVoiceDraft(undefined); }
    });
  }

  const recorder = useSpeakingRecorder(sendAudio, setError);
  const finished = session?.phase === "finished";

  // 2026-11-21：新练习和恢复中的练习共享自动连接，关麦时清理归属。
  function prepareMicrophone(practiceId: string) {
    if (!voiceInput || microphoneSession.current === practiceId) return;
    microphoneSession.current = practiceId;
    void recorder.enable();
  }

  function releaseMicrophone() {
    microphoneSession.current = undefined;
    recorder.disable();
  }

  // 2026-11-21：返回进行中的练习时恢复连接，已结束或关闭语音服务后释放。
  useEffect(() => {
    if (finished || !voiceInput) {
      releaseMicrophone();
    } else if (session && !totalTimeReached) {
      prepareMicrophone(session.id);
    }
  }, [session?.id, finished, voiceInput, totalTimeReached]);

  useEffect(() => {
    if (!session || session.phase === "finished" || session.runningSince === null || remaining > 0 || operationLock.current) return;
    if (recorder.state !== "idle" && recorder.stop()) return;
    // 2026-11-21：整场到时且没有待收尾的录音时，直接释放麦克风。
    if (totalTimeReached) releaseMicrophone();
    void run("正在保存练习…", async () => {
      const time = Date.now();
      if (session.phase === "prepare") {
        // 2026-11-21：合成 Part 2 指令的时间不从陈述环节扣除。
        const prompt = "Please begin speaking now.";
        const voice = session.examinerVoice ?? defaultExaminerVoice;
        const prepared = await prepareQuestion(prompt, voice);
        if (!mounted.current) return;
        await persist(beginLongTurn(session, Date.now()));
        if (hasVoice) void play(prompt, undefined, voice, prepared);
      } else if (input.trim() && isAnswerPhase && !replyNeeded) {
        await submit(session, input, "text");
      } else {
        await persist(finishSpeaking(session, "time", time));
      }
    });
  // 2026-11-21：到点处理区分本阶段和整场。
  }, [session?.id, session?.revision, remaining, totalTimeReached, operation, recorder.state]);

  function begin() {
    setInput("");
    void run(topic.part === 2 ? "正在开始练习…" : "考官正在准备问题…", async () => {
      // 2026-11-21：用开始对话的点击直接启动麦克风授权，同时保存练习。
      // 2026-11-21：开始新一轮前停止旧回放，将当前选择固定在会话中。
      stopVoice();
      recordedAudio.stop();
      const practice = startSpeakingSession(topic, Date.now(), nextVoice);
      prepareMicrophone(practice.id);
      const saved = await persist(practice).catch((reason: unknown) => {
        releaseMicrophone();
        throw reason;
      });
      if (awaitingQuestion(saved)) await ask(saved);
    });
  }

  const messageText = error || (records.error ? errorText(records.error) : "");
  const showCard = topic.part === 2 && (session?.phase === "prepare" || session?.phase === "long-turn");
  const showMessages = session?.messages ?? [];
  return <section className="card speaking-practice" aria-label="口语对话">
    <header className="speaking-toolbar">
      {session && <div className="speaking-pace">
        <b>{statuses[session.phase]}</b>
        {!finished && <span className="time" role="timer" aria-label="剩余练习时间">{formatClock(Math.ceil(remaining / 1000) * 1000)}</span>}
        {session.part === 2 && !finished && session.phase !== "follow-up" && <span className="muted">总剩余 {formatClock(speakingLimits[2].totalMs - elapsed)}</span>}
        {isAnswerPhase && session.phase !== "long-turn" && <span className="muted">{speakingRoundCount(session)} / {speakingLimits[session.part].rounds} 轮</span>}
        {session.endReason && <span className="muted">{endLabels[session.endReason]}</span>}
      </div>}
      <div className="table-actions speaking-actions">
        {/* 2026-11-21：自动连接期间只提示状态，取消单独的麦克风按钮。 */}
        {recorder.microphone === "opening" && <span className="muted" role="status">正在连接麦克风…</span>}
        {sessions.length > 1 && <select aria-label="口语练习记录" value={session?.id} disabled={Boolean(operation) || recorder.state !== "idle"} onChange={(event) => {
          // 2026-11-21：录音连接随练习切换释放。
          // 2026-11-21：切换到其他练习时重置自动连接归属。
          releaseMicrophone();
          setSelectedId(event.currentTarget.value); setInput(""); setError(""); setNow(Date.now());
          // 2026-11-21：切换问答存档时释放未提交的临时录音。
          setVoiceDraft(undefined);
          stopVoice();
          // 2026-11-21：切换练习时停止上一场的录音。
          recordedAudio.stop();
        }}>{sessions.map((item) => <option key={item.id} value={item.id}>{new Date(item.startedAt).toLocaleString()} · {statuses[item.phase]}</option>)}</select>}
        {/* 2026-11-21：在开始按钮左侧选择下一场的考官音色。 */}
        {(!session || finished) && <>
          <select aria-label="考官音色" value={nextVoice} disabled={!enabled || voicePreference.isPending || voiceChange.isPending || Boolean(operation)}
            onChange={(event) => {
              const voice = event.currentTarget.value;
              if (isExaminerVoice(voice)) voiceChange.mutate(voice);
            }}>
            {Object.entries(examinerVoices).map(([voice, name]) => <option key={voice} value={voice}>{name}</option>)}
          </select>
          <button className="button primary" type="button"
            disabled={!enabled || records.isPending || voicePreference.isPending || voiceChange.isPending || Boolean(records.error || operation)} onClick={begin}>
            {finished ? "开始新一轮" : "开始对话"}
          </button>
        </>}
        {session && !finished && <button className="button secondary" type="button" disabled={Boolean(operation) || recorder.state !== "idle"} onClick={() => {
          // 2026-11-21：点击结束即释放麦克风，保存记录无需维持录音连接。
          // 2026-11-21：手动结束与计时结束共享释放流程。
          releaseMicrophone();
          stopVoice();
          // 2026-11-21：提前结束时停止正在回放的录音。
          recordedAudio.stop();
          // 2026-11-21：手动结束后丢弃未提交的转写与试听。
          previewAudio.current?.pause();
          void run("正在保存练习…", async () => {
            await persist(finishSpeaking(session, "manual", Date.now()));
            if (mounted.current) { setInput(""); setVoiceDraft(undefined); }
          });
        }}>结束练习</button>}
      </div>
    </header>
    {messageText && <p className="notice danger" role="alert">{messageText}</p>}
    {showCard && <section className="speaking-cue"><h3>题卡</h3><p lang="en">{topic.cueCard || topic.title}</p></section>}
    <details className="speaking-reference" key={session?.id ?? "reference"}>
      <summary>查看题目</summary>
      <div className="speaking-reference-body" lang="en">
        {!showCard && topic.part === 2 && topic.cueCard && <p>{topic.cueCard}</p>}
        {showMessages.some((item) => item.role === "assistant") && <><h3 lang="zh">考官已问</h3><ol>
          {showMessages.flatMap((item, index) => item.role === "assistant" ? [<li key={index}>{item.content}</li>] : [])}
        </ol></>}
        {!!topic.questions.length && <><h3 lang="zh">题库参考题</h3><ol>{topic.questions.map((question, index) => <li key={index}>{question}</li>)}</ol></>}
      </div>
    </details>
    <div className="speaking-transcript" ref={transcript} role="log" aria-label="口语练习记录" aria-live="polite">
      {/* 2026-11-21：考官通过右键控制文字，用户语音回答同时显示录音和文字。 */}
      {session && <SpeakingMessages key={session.id} messages={showMessages} finished={finished} hasVoice={hasVoice}
        canPlay={recorder.state === "idle"} playingQuestion={playingQuestion} playingAudio={recordedAudio.playing}
        onQuestion={play} onAudio={(audioId) => {
          stopVoice();
          previewAudio.current?.pause();
          void recordedAudio.play(session.id, audioId);
        }} />}
      {operation && <p className="muted" role="status">{operation}</p>}
    </div>
    {session && replyNeeded && !operation && <button type="button" className="button secondary speaking-retry" onClick={() => void run("考官正在准备问题…", () => ask(session))}>
      {showMessages.length ? "重试考官提问" : "开始考官提问"}
    </button>}
    {/* 2026-11-21：有待确认录音时继续显示预览，避免继续计时触发自动提交。 */}
    {session && isAnswerPhase && !replyNeeded && session.runningSince === null && !operation && !voiceReview && <button type="button" className="button secondary speaking-retry"
      onClick={() => void run("正在继续练习…", () => persist({ ...session, runningSince: Date.now() }))}>继续练习</button>}
    {isAnswerPhase && <form className="speaking-answer" onSubmit={(event) => { event.preventDefault(); sendText(); }}>
      {/* 2026-11-21：使用本次发送给 DeepSeek 的同一份 WAV 试听。 */}
      {voiceReview && <div className="speaking-voice-review">
        <span>试听录音</span>
        {/* 2026-11-21：试听时停止聊天中的语音播放。 */}
        <audio key={voiceReview.url} ref={previewAudio} src={voiceReview.url} aria-label="试听本次录音" controls preload="metadata"
          onPlay={() => { stopVoice(); recordedAudio.stop(); }} />
      </div>}
      {/* 2026-11-21：转写成功可校对，转写失败可手动补写后再发送。 */}
      <textarea aria-label="我的口语回答" lang="en" value={input} rows={2} placeholder={voiceReview ? "校对或补写转写内容后发送" : "输入英文回答"}
        disabled={!canAnswer || recorder.state !== "idle"} onChange={(event) => setInput(event.currentTarget.value)} />
      <div className="table-actions">
        {/* 2026-11-21：已启用麦克风后可立即录音，预览期间可重录。 */}
        {voiceReview ? <button className="button secondary" type="button" disabled={Boolean(operation) || !voiceInput || remaining <= 0}
          onClick={discardForRetake} title={remaining <= 0 ? "作答时间已到，可以校对本次转写后发送。" : undefined}>重录</button>
          : <button type="button" className={`button secondary speaking-microphone${recorder.state === "recording" ? " recording" : ""}`}
          disabled={recorder.state === "finishing" || (recorder.state === "idle" && (!canAnswer || !voiceInput || voicing || recorder.microphone !== "ready"))}
          title={!voiceInput ? "语音转写使用 DeepSeek 官方连接。" : recorder.microphone === "ready"
            ? "按住说话，松开后转写" : "麦克风就绪后可录音"}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            // 2026-11-21：录制前先停止历史录音，避免回放声进入麦克风。
            recordedAudio.stop();
            void recorder.start();
          }} onPointerUp={() => recorder.stop()} onPointerCancel={() => recorder.stop(false)} onLostPointerCapture={() => recorder.stop()}
          onKeyDown={(event) => {
            if (event.key !== " " && event.key !== "Enter") return;
            event.preventDefault();
            // 2026-11-21：键盘开始录音时同样停止历史回放。
            if (!event.repeat) {
              recordedAudio.stop();
              void recorder.start();
            }
          }} onKeyUp={(event) => {
            if (event.key !== " " && event.key !== "Enter") return;
            event.preventDefault();
            recorder.stop();
          }} onBlur={() => recorder.stop(false)}>
          {/* 2026-11-21：按实际收到音频、收尾的状态反馈。 */}
          {/* 2026-11-21：连接状态在顶部显示，作答区只显示本轮录音状态。 */}
          <Mic size={16} aria-hidden="true" />{recorder.state === "recording" ? "录音中 · 松开转写"
            : recorder.state === "finishing" ? "正在收尾…" : "按住说话"}
        </button>}
        <button className="button primary" type="submit" disabled={!canAnswer || !input.trim() || recorder.state !== "idle"}>发送</button>
      </div>
      {!voiceInput && models.isSuccess && <p className="muted">按住说话使用 DeepSeek 官方连接，当前可输入文字。</p>}
    </form>}
  </section>;
}
