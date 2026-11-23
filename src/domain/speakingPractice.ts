// 2026-11-21：按 Part 执行口语阶段、时长与轮次，本机保存结构化对话。
import type { SpeakingPart, SpeakingTopic } from "./speaking";
import { speakingTopicId } from "./speaking";
// 2026-11-21：每场练习记录选定的 Kokoro 音色。
import { defaultExaminerVoice } from "./kokoroSpeech";
import type { ExaminerVoice } from "./kokoroSpeech";

export type SpeakingPhase = "questions" | "prepare" | "long-turn" | "follow-up" | "finished";
export type SpeakingEndReason = "time" | "rounds" | "manual";

export interface SpeakingMessage {
  role: "assistant" | "user";
  content: string;
  at: string;
  elapsedMs: number;
  phase: SpeakingPhase;
  model?: string;
  input?: "text" | "voice";
  durationMs?: number;
  // 2026-11-21：已提交的语音回答引用本机录音附件。
  audioId?: string;
}

export interface SpeakingSession {
  id: string;
  revision: number;
  topicId: string;
  title: string;
  book?: string;
  part: SpeakingPart;
  startedAt: string;
  updatedAt: string;
  phase: SpeakingPhase;
  elapsedMs: number;
  phaseStartedMs: number;
  runningSince: number | null;
  messages: SpeakingMessage[];
  endReason?: SpeakingEndReason;
  // 2026-11-21：旧存档可缺少此字段，回放时使用默认音色。
  examinerVoice?: ExaminerVoice;
}

export const speakingLimits = {
  1: { totalMs: 300_000, rounds: 4 },
  2: { totalMs: 240_000, rounds: 2 },
  3: { totalMs: 300_000, rounds: 5 },
} as const;

// 2026-11-21：在新会话上固定考官音色，历史回放沿用该次选择。
export function startSpeakingSession(topic: SpeakingTopic, now: number, examinerVoice: ExaminerVoice = defaultExaminerVoice): SpeakingSession {
  const time = new Date(now).toISOString();
  return {
    id: crypto.randomUUID(), revision: 0, topicId: speakingTopicId(topic), title: topic.title, book: topic.book,
    part: topic.part, startedAt: time, updatedAt: time, phase: topic.part === 2 ? "prepare" : "questions",
    elapsedMs: 0, phaseStartedMs: 0, runningSince: topic.part === 2 ? now : null, messages: [],
    // 2026-11-21：只存音色标识，考官语音按需在本机合成。
    examinerVoice,
  };
}

export function speakingDeadline(session: SpeakingSession) {
  const limit = speakingLimits[session.part].totalMs;
  if (session.phase === "prepare") return Math.min(limit, session.phaseStartedMs + 60_000);
  if (session.phase === "long-turn") return Math.min(limit, session.phaseStartedMs + 120_000);
  return limit;
}

export function speakingElapsed(session: SpeakingSession, now: number) {
  const running = session.runningSince === null ? 0 : Math.max(0, now - session.runningSince);
  return Math.min(speakingDeadline(session), session.elapsedMs + running);
}

export function pauseSpeaking(session: SpeakingSession, now: number): SpeakingSession {
  return { ...session, elapsedMs: speakingElapsed(session, now), runningSince: null };
}

export function speakingRoundCount(session: SpeakingSession) {
  const phase = session.part === 2 ? "follow-up" : "questions";
  return session.messages.filter((item) => item.phase === phase && item.role === "user").length;
}

export function finishSpeaking(session: SpeakingSession, reason: SpeakingEndReason, now: number): SpeakingSession {
  return { ...pauseSpeaking(session, now), phase: "finished", endReason: reason };
}

// 2026-11-21：把答案写入会话后再确定追问或结束，转写时可恢复已暂停的时钟快照。
export function recordSpeakingAnswer(
  // 2026-11-21：确认后的文字与原录音一同关联到回答。
  session: SpeakingSession, content: string, input: "text" | "voice", now: number, duration?: number, audioId?: string,
): SpeakingSession {
  const paused = pauseSpeaking(session, now);
  const previous = paused.messages.at(-1);
  const turnStart = previous?.phase === paused.phase ? previous.elapsedMs : paused.phaseStartedMs;
  const message: SpeakingMessage = {
    role: "user", content: content.trim(), at: new Date(now).toISOString(), elapsedMs: paused.elapsedMs,
    phase: paused.phase, input, durationMs: duration ?? Math.max(0, paused.elapsedMs - turnStart),
    // 2026-11-21：键盘回答不创建音频引用。
    ...(input === "voice" && audioId ? { audioId } : {}),
  };
  const next: SpeakingSession = { ...paused, messages: [...paused.messages, message] };
  if (next.elapsedMs >= speakingLimits[next.part].totalMs) return finishSpeaking(next, "time", now);
  if (next.phase === "long-turn") return { ...next, phase: "follow-up", phaseStartedMs: next.elapsedMs };
  if (speakingRoundCount(next) >= speakingLimits[next.part].rounds) return finishSpeaking(next, "rounds", now);
  return next;
}

export function beginLongTurn(session: SpeakingSession, now: number): SpeakingSession {
  const prepared = pauseSpeaking(session, now);
  return { ...prepared, phase: "long-turn", phaseStartedMs: prepared.elapsedMs, runningSince: now };
}

export function awaitingQuestion(session: SpeakingSession) {
  const phase = session.phase;
  return (phase === "questions" || phase === "follow-up") && !session.endReason
    && session.messages.at(-1)?.role !== "assistant";
}


// 2026-11-22：口语业务只传文档标识、题目数据与对话历史。
export function examinerRequest(topic: SpeakingTopic, session: SpeakingSession) {
  const stage = session.phase === "follow-up" ? "part_2_follow_up" : topic.part === 3 ? "part_3" : "part_1";
  return {
    promptIds: ["speaking-examiner.md"],
    variables: {
      part: String(topic.part),
      stage,
      topic_reference: JSON.stringify({ topic: topic.title, cueCard: topic.part === 2 ? topic.cueCard : undefined,
        referenceQuestions: topic.questions }),
    },
    messages: session.messages.map(({ role, content }) => ({ role, content })),
  };
}
