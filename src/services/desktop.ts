// 2026-11-19：集中封装 Tauri IPC、React Query 键和工作区数据读写。
import { invoke, isTauri } from "@tauri-apps/api/core";
// 2026-11-21：录音经原始二进制 IPC 传递。
import type { InvokeArgs } from "@tauri-apps/api/core";
// 2026-11-19：阅读草稿保存包含写者版本，复习记录支持原子提交。
// 2026-11-20：桌面服务保留单篇草稿和正式成绩接口。
import type { PracticeDraft, PracticeRecord } from "../domain/types";
import type { ReviewPlanChange } from "../domain/readingReview";
// 2026-11-19：本机听力草稿由独立的 Section 接口更新。
import type { ListeningDraft } from "../domain/listening";
// 2026-11-21：口语对话使用带版本的本机会话。
import type { SpeakingSession } from "../domain/speakingPractice";
// 2026-11-19：为本机操作记录可导出的结构化诊断。
import { reportDiagnostic } from "./diagnostics";

// 2026-11-19：增加独立听力资料集合和本机诊断读取。
// 2026-11-19：学习工具持久化阅读词汇和已解锁成就。
export type Collection = "drafts" | "vocabulary" | "settings" | "banks" | "listening" | "annotations" | "review-plans"
  // 2026-11-20：词表修改和删除记录独立保存，沿用工作区备份。
  // 2026-11-21：口语对话加入本机文档查询与备份。
  // 2026-11-21：备份包含单独的口语录音附件。
  | "reading-words" | "achievements" | "listening-drafts" | "vocabulary-edits" | "speaking-sessions" | "speaking-audio"
  // 2026-11-27：听力回看批注和精听原文高亮也保存在本机。
  | "listening-highlights"
  // 2026-11-23：作文正式提交作为本机文档保存和备份。
  | "writing-submissions";

// 2026-11-23：本机的资源目录与可导出的练习记录分别管理。
export type ResourceDirectoryKind = "reading" | "listening" | "speaking" | "writing" | "vocabulary" | "notes" | "prompts" | "kokoro";
export interface ResourceDirectory {
  kind: ResourceDirectoryKind;
  path: string;
  defaultPath: string;
  overridden: boolean;
  available: boolean;
  bundled: boolean;
}

export interface WriterRevision {
  writerId: string;
  revision: number;
}

// 2026-11-19：读取用户通过桌面目录选择器绑定的题库。
export interface BankFolder {
  id: string;
  // 2026-11-19：口语与阅读、听力共用目录绑定。
  // 2026-11-21：原生题库绑定新增 Writing 目录类型。
  kind: "reading" | "listening" | "speaking" | "writing";
  title: string;
  root: string;
}

export interface BankScan {
  folder: BankFolder;
  files: string[];
  skipped: number;
  // 2026-11-19：识别目录文件清单或内容变化。
  revision: string;
}

// 2026-11-21：课程笔记将文件标识与编辑版本分开返回。
export interface CourseNoteEntry {
  id: string;
  title: string;
}

export interface CourseNote {
  content: string;
  revision: string;
}

export interface WorkspaceInfo {
  database: string;
  version: number;
  check: string;
  records: number;
  documents: number;
}

// 2026-11-21：连接列表只暴露是否配置密钥，表单负责提交新的密钥内容。
export interface AiModelDraft {
  id?: number;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  // 2026-11-21：连接可保存多个模型和文本请求默认设置。
  models: string[];
  generationParameters: Record<string, unknown>;
  timeoutSeconds: number;
}

export interface AiModelConnection extends Omit<AiModelDraft, "id" | "apiKey"> {
  id: number;
  active: boolean;
  hasApiKey: boolean;
}

// 2026-11-21：业务通过统一的文本消息与结果类型调用当前模型。
export interface LlmMessage {
  // 2026-11-22：系统消息由桌面端读取 Markdown 后生成。
  role: "user" | "assistant";
  content: string;
}

// 2026-11-22：模块可指定多份提示词，编辑保存后的内容由后端即时组装。
export interface LlmPromptRequest {
  promptIds: string[];
  variables?: Record<string, string>;
  messages?: LlmMessage[];
}

export interface LlmCompletion {
  content: string;
  model: string;
  finishReason: string | null;
}

interface AiModelTest {
  model: string;
  elapsedMs: number;
  hasText: boolean;
}

export interface Document<T> {
  collection: Collection;
  id: string;
  value: T;
}

export interface Backup {
  format: "ietls4pass-backup-v1";
  records: PracticeRecord[];
  documents: Document<unknown>[];
  // 2026-11-19：新备份带校验，保留第一轮文件的兼容性。
  checksum?: string;
}

// 2026-11-19：恢复预览由 Rust 在同一套存储规则下计算。
export type RestoreMode = "merge" | "replace";
export interface RestorePreview {
  token: string;
  verified: boolean;
  incomingRecords: number;
  incomingDocuments: number;
  existingRecords: number;
  existingDocuments: number;
  conflictingRecords: number;
  conflictingDocuments: number;
}

export interface RestoreResult { addedRecords: number; addedDocuments: number; rollbackId: number | null }
export interface BackupEntry {
  id: number;
  source: "manual" | "before-replace";
  createdAt: string;
  records: number;
  documents: number;
}

export const desktopAvailable = () => isTauri();
export const recordsKey = ["practice-records"] as const;
export const documentsKey = (category: Collection) => ["documents", category] as const;

// 2026-11-21：允许音频 IPC 使用 Tauri 原始请求格式。
function call<T>(command: string, args?: InvokeArgs) {
  if (!desktopAvailable()) return Promise.reject(new Error("请在 IETLS4PASS 桌面应用中使用本机数据功能。"));
  // 2026-11-19：记录操作名和结果，调用参数与错误正文留在原调用链。
  return invoke<T>(command, args).then((value) => {
    reportDiagnostic(command, "ok");
    return value;
  }, (error: unknown) => {
    reportDiagnostic(command);
    throw error;
  });
}

export const desktop = {
  records: () => call<PracticeRecord[]>("list_records"),
  // 2026-11-19：使用草稿标识与版本校验，提交时清除对应听力草稿。
  saveListeningDraft: (draftId: string, draft: ListeningDraft, expected: Pick<ListeningDraft, "id" | "revision"> | null) =>
    call<ListeningDraft>("save_listening_draft", { draftId, draft, expected }),
  submitListeningSection: (draftId: string, record: PracticeRecord, expected: Pick<ListeningDraft, "id" | "revision">) =>
    call<PracticeRecord>("commit_listening_section", { draftId, record, expected }),
  saveRecord: (record: PracticeRecord, draftId: string | null = null, writer?: WriterRevision, review?: ReviewPlanChange) =>
    call<PracticeRecord>("save_record", { record, draftId, writer: writer ?? null, review: review ?? null }),
  // 2026-11-19：通过 SQLite 持有阅读草稿写入权，归档和提交时失效。
  openReading: (id: string, writerId: string, seed: PracticeDraft) =>
    call<{ draft: PracticeDraft; recovered: boolean }>("open_reading_draft", { id, writerId, seed }),
  saveReading: (id: string, writer: WriterRevision, draft: PracticeDraft) =>
    call<void>("save_reading_draft", { id, writer, draft }),
  applyReviewFeedback: (change: ReviewPlanChange) => call<void>("apply_review_feedback", { change }),
  // 2026-11-27：练习记录按原始来源批量删除所选记录。
  deleteRecords: (ids: string[], speakingSessionIds: string[] = [], writingSubmissionIds: string[] = []) =>
    call<void>("delete_records", { ids, speakingSessionIds, writingSubmissionIds }),
  documents: <T>(category: Collection) => call<Document<T>[]>("list_documents", { category }),
  put: <T>(category: Collection, id: string, value: T, unlessRecordId: string | null = null) =>
    call<void>("put_document", { document: { collection: category, id, value }, unlessRecordId }),
  // 2026-11-23：合并写入词条删除标记，保留原词表文件和复习记录。
  removeVocabularyWords: (ids: string[]) => call<void>("remove_vocabulary_words", { ids }),
  remove: (category: Collection, id: string) => call<void>("delete_document", { category, id }),
  export: () => call<Backup>("export_workspace"),
  // 2026-11-19：支持预览、覆盖与本地回退点管理。
  previewRestore: (backup: Backup, mode: RestoreMode) => call<RestorePreview>("preview_workspace_restore", { backup, mode }),
  applyRestore: (backup: Backup, mode: RestoreMode, token: string) => call<RestoreResult>("apply_workspace_restore", { backup, mode, token }),
  backups: () => call<BackupEntry[]>("list_workspace_backups"),
  createBackup: () => call<number>("create_workspace_backup"),
  readBackup: (id: number) => call<Backup>("read_workspace_backup", { id }),
  deleteBackup: (id: number) => call<void>("delete_workspace_backup", { id }),
  // 2026-11-19：统一暴露草稿归档和本机数据库管理命令。
  info: () => call<WorkspaceInfo>("workspace_info"),
  reset: () => call<void>("reset_workspace"),
  // 2026-11-21：设置中保存、选择和删除文本模型连接。
  aiModels: () => call<AiModelConnection[]>("list_ai_models"),
  saveAiModel: (draft: AiModelDraft) => call<void>("save_ai_model", { draft }),
  selectAiModel: (id: number) => call<void>("select_ai_model", { id }),
  deleteAiModel: (id: number) => call<void>("delete_ai_model", { id }),
  // 2026-11-21：界面切换模型，业务只传入文本消息，由后端解析当前连接。
  setAiModelVariant: (id: number, model: string) => call<void>("set_ai_model_variant", { id, model }),
  testAiModel: (id: number) => call<AiModelTest>("test_ai_model", { id }),
  // 2026-11-22：传递文档标识和变量，避免在业务中保存提示词正文。
  generateText: (request: LlmPromptRequest) => call<LlmCompletion>("generate_llm_text", { request }),
  // 2026-11-21：口语会话和录音转写独立于模型文本接口。
  // 2026-11-21：保存消息时可附上原录音，回放时按需读取 WAV。
  saveSpeakingSession: (session: SpeakingSession, recording?: string) => call<SpeakingSession>("save_speaking_session", {
    session, expectedRevision: session.revision || null, recording: recording ?? null,
  }),
  speakingAudio: (sessionId: string, audioId: string) => call<ArrayBuffer>("read_speaking_audio", { sessionId, audioId }),
  transcribeSpeakingAudio: (audio: Uint8Array) => call<string>("transcribe_speaking_audio", audio),
  // 2026-11-21：课程笔记操作通过桌面文件接口完成。
  listCourseNotes: () => call<CourseNoteEntry[]>("list_course_notes"),
  readCourseNote: (id: string) => call<CourseNote>("read_course_note", { id }),
  createCourseNote: (title: string) => call<CourseNoteEntry>("create_course_note", { title }),
  saveCourseNote: (id: string, content: string, expectedRevision: string) =>
    call<CourseNote>("save_course_note", { id, content, expectedRevision }),
  deleteCourseNote: (id: string) => call<void>("delete_course_note", { id }),
  // 2026-11-22：Prompt 文档和课程笔记共享 Markdown 读写结果格式。
  listPrompts: () => call<CourseNoteEntry[]>("list_prompt_documents"),
  readPrompt: (id: string) => call<CourseNote>("read_prompt_document", { id }),
  savePrompt: (id: string, content: string, expectedRevision: string) =>
    call<CourseNote>("save_prompt_document", { id, content, expectedRevision }),
  // 2026-11-19：本机媒体由 Rust 校验目录后读取或打开。
  // 2026-11-23：按资源类型查看与重新选择系统目录。
  resourceDirectories: () => call<ResourceDirectory[]>("list_resource_directories"),
  chooseResourceDirectory: (kind: ResourceDirectoryKind) => call<ResourceDirectory | null>("choose_resource_directory", { kind }),
  resetResourceDirectory: (kind: ResourceDirectoryKind) => call<ResourceDirectory>("reset_resource_directory", { kind }),
  bankFolders: () => call<BankFolder[]>("list_bank_folders"),
  scanBank: (id: string) => call<BankScan>("scan_bank_folder", { id }),
  bankText: (id: string, relative: string) => call<string>("read_bank_text", { id, relative }),
  bankMedia: (id: string, relative: string) => call<ArrayBuffer>("read_bank_media", { id, relative }),
  openBankPdf: (id: string, relative: string) => call<void>("open_bank_pdf", { id, relative }),
};

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function downloadFile(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
