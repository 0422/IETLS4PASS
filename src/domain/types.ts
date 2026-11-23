// 2026-11-19：定义上游阅读资产、正式成绩以及可恢复练习的独立数据契约。
export type Category = "P1" | "P2" | "P3";
export type Answer = string | string[] | null;
export type Answers = Record<string, Answer>;

export interface ExamEntry {
  examId: string;
  title: string;
  category: Category;
  frequency?: string;
  difficultyScore?: number;
  questionTypes?: string[];
  hasExplanation: boolean;
  // 2026-11-19：允许按本地题源文件名搜索。
  filename?: string;
  pdfFilename?: string;
}

export interface ReadingIndex {
  schemaVersion: "IETLS4PASSBankV1";
  source: string;
  aliases: Record<string, string>;
  entries: ExamEntry[];
}

export interface ReadingGroup {
  groupId: string;
  kind: string;
  questionIds: string[];
  bodyHtml: string;
  leadHtml?: string;
  allowOptionReuse?: boolean;
}

export interface ReadingExam {
  examId: string;
  meta: { title: string; category: Category; questionIntroHtml?: string };
  passage: { blocks: { blockId: string; kind: string; html?: string }[] };
  questionGroups: ReadingGroup[];
  questionOrder: string[];
  questionDisplayMap?: Record<string, string>;
  answerKey: Answers;
  // 2026-11-19：旧 HTML 的展示块与计分单元可以不同。
  scoringGroups?: ReadingGroup[];
}

export interface Explanation {
  passageNotes?: { label?: string; text?: string }[];
  questionExplanations?: {
    sectionTitle?: string;
    text?: string;
    items?: { questionId?: string; questionNumber?: number; text?: string }[];
  }[];
}

export interface ReadingAsset {
  exam: ReadingExam;
  explanation: Explanation | null;
  // 2026-11-19：本机题图和 PDF 由题库绑定提供，参考题源独立标记。
  localMedia?: Record<string, string>;
  pdfPath?: string;
  resourceOnly?: boolean;
}

export interface AnswerResult {
  questionId: string;
  label: string;
  userAnswer: Answer;
  correctAnswer: Answer;
  points: number;
  possible: number;
  type: string;
}

export interface PracticeRecord {
  id: string;
  kind: "reading" | "listening" | "suite";
  title: string;
  examId?: string;
  bankId?: string;
  category?: string;
  submittedAt: string;
  startedAt?: string;
  elapsedMs?: number;
  answers?: Answers;
  details?: AnswerResult[];
  points: number | null;
  possible: number | null;
  children?: PracticeRecord[];
  source?: "desktop" | "legacy";
  raw?: unknown;
  // 2026-11-19：附加阅读关联计时和批注，同时保留第一轮成绩兼容性。
  readingTiming?: ReadingTiming;
  annotations?: ReadingAnnotations;
  partial?: boolean;
  suiteTotal?: number;
  // 2026-11-19：套题可跨篇提交，子成绩按原篇目位置关联。
  suitePosition?: number;
}

export interface PracticeDraft {
  id: string;
  examId: string;
  bankId: string;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  answers: Answers;
  // 2026-11-19：保存暂停状态、套题位置和可重复提交的冻结结果。
  paused?: boolean;
  suiteId?: string;
  suitePosition?: number;
  readingTiming?: ReadingTiming;
  annotations?: ReadingAnnotations;
  pendingResult?: PracticeRecord;
  archivedAt?: string;
  interruptReason?: string;
}

// 2026-11-19：区分已归属、未分配和不可用的阅读前台时长。
export type TimingReason = "recovery-tail" | "legacy-draft" | "clock-gap" | "missing-mapping";

export interface ReadingTimingUnit {
  id: string;
  kind: "question" | "group";
  questionIds: string[];
  labels: string[];
  durationMs: number | null;
}

export interface ReadingTiming {
  version: 1;
  kind: "foreground-selection";
  attemptId: string;
  examId: string;
  bankId: string;
  suiteId?: string;
  suitePosition?: number;
  units: ReadingTimingUnit[];
  unallocatedMs: number;
  totalMs: number;
  reasons: TimingReason[];
  finalized?: boolean;
}

export interface PassageHighlight {
  blockId: string;
  start: number;
  end: number;
  text: string;
}

export interface ReadingAnnotations {
  notes: string;
  markedQuestions: string[];
  highlights: PassageHighlight[];
}

export interface SuiteDraft {
  id: string;
  startedAt: string;
  exams: { bankId: string; examId: string; title: string }[];
  completed: PracticeRecord[];
  // 2026-11-19：保存套题推进方式和共享倒计时状态。
  // 2026-11-19：模拟模式可跨篇作答，整套统一提交。
  flowMode?: "classic" | "stationary" | "simulation";
  activePosition?: number;
  limitSeconds?: number;
  pauseSinceMs?: number | null;
  pausedTotalMs?: number;
  stopOnTimeout?: boolean;
}

export interface Word {
  word: string;
  meaning: string;
  example?: string;
  phonetic?: string;
  // 2026-11-20：保留内置词条的词频，也允许在本机补录。
  freq?: number;
}

export interface WordProgress {
  easeFactor: number;
  repetitions: number;
  interval: number;
  nextReview: string;
  lastReviewed: string;
}
