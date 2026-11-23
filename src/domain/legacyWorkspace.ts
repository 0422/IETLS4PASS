// 2026-11-19：校验原版快照，转换可识别的学习资料并保留原版数据字段。
import type { Backup, Document } from "../services/desktop";
import { badges } from "./achievements";
import { legacyAnnotations, legacyAnswers, legacyBank, legacyPracticeRecords, legacyTiming } from "./legacyImport";
import { reviewPlanId } from "./readingReview";
import type { ReviewPlan } from "./readingReview";
import type { PracticeDraft, PracticeRecord, WordProgress } from "./types";

type Dict = Record<string, unknown>;
const isObject = (value: unknown): value is Dict => value !== null && typeof value === "object" && !Array.isArray(value);
const object = (value: unknown): Dict => isObject(value) ? value : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown) => typeof value === "string" ? value : "";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const validId = (value: string) => value.length > 0 && new TextEncoder().encode(value).length <= 240 && !/[\x00-\x1f\x7f-\x9f]/.test(value);
const canonicalExam = (bank: string | undefined, exam: string, aliases: Record<string, string>) =>
  bank === "main" && Object.hasOwn(aliases, exam) ? aliases[exam] : exam;
const stores = ["practiceSummaries", "practiceDetails", "practiceAnnotations"] as const;
const envelopeLayers = new Set([
  "practice.reviewPlans", "settings.values", "library.configurations", "library.importedIndexes", "library.activeConfigurationId",
  "recovery.activeSessions", "recovery.drafts", "recovery.readingTiming", "recovery.interrupted", "recovery.rejectedCompletions", "recovery.windowSession",
  "backups.entries", "backups.settings", "backups.exportHistory", "backups.importHistory",
  "vocab.words", "vocab.userConfig", "vocab.lists", "vocab.readingState", "vocab.readingVocabWords", "vocab.readingBookshelfExams",
  "preferences.values", "goals.items", "achievements.manual", "achievements.progress",
  "system.migrations", "system.operationJournal", "system.entityRevisions", "system.readingViewToken",
]);
const arrayLayers = new Set([
  "practice.reviewPlans", "library.configurations", "recovery.activeSessions", "recovery.drafts", "recovery.readingTiming",
  "recovery.interrupted", "recovery.rejectedCompletions", "backups.entries", "backups.exportHistory", "backups.importHistory",
  "vocab.words", "vocab.readingVocabWords", "vocab.readingBookshelfExams", "goals.items",
]);

function iso(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const stamp = new Date(value);
  return Number.isFinite(stamp.valueOf()) ? stamp.toISOString() : "";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function checksum(value: unknown) {
  const input = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function checkPayload(row: Dict, label: string) {
  if (!count(row.revision) || row.revision < 1 || row.revision === Number.MAX_SAFE_INTEGER
    || !str(row.operationId).trim() || !str(row.updatedAt).trim()
    || !Object.hasOwn(row, "data") || row.checksum !== checksum(row.data)) {
    throw new Error(`原版备份校验失败（${label}）。`);
  }
}

function legacyEnvelopes(root: Dict) {
  if (Number(root.schemaVersion) !== 2 || !isObject(root.envelopes) || !isObject(root.entities)
    || (root.scope !== "full" && root.scope !== "partial")) throw new Error("原版 v2 备份结构无效。");
  const { envelopes, entities } = root;
  const layers = Object.keys(entities);
  if ((root.scope === "full" || layers.length) && (layers.length !== stores.length || stores.some((store) => !Array.isArray(entities[store])))) {
    throw new Error("原版备份的成绩数据层不完整。");
  }
  if (root.checksum !== checksum({ envelopes, entities })) throw new Error("原版备份总校验值不符。");
  const data: Dict = {};
  for (const [label, value] of Object.entries(envelopes)) {
    const row = object(value);
    if (!envelopeLayers.has(label) || Number(row.schemaVersion) !== 2
      || (row.state !== "present" && (row.state !== "cleared" || row.data !== null))) {
      throw new Error(`原版备份中有无效的数据层（${label}）。`);
    }
    checkPayload(row, label);
    if (row.state === "present") {
      const valid = arrayLayers.has(label) ? Array.isArray(row.data) : label === "library.activeConfigurationId"
        ? row.data === null || typeof row.data === "string" : isObject(row.data);
      if (!valid) throw new Error(`原版备份的数据结构无效（${label}）。`);
      data[label] = row.data;
    }
  }
  const ids = stores.map((store) => {
    const seen = new Set<string>();
    for (const raw of array(entities[store])) {
      const row = object(raw);
      const id = str(row.recordId);
      const field = store === "practiceSummaries" ? "id" : "recordId";
      if (!id.trim() || object(row.data)[field] !== id || seen.has(id)) throw new Error(`原版成绩标识无效（${store}）。`);
      checkPayload(row, store);
      seen.add(id);
    }
    return seen;
  });
  if (ids.slice(1).some((set) => set.size !== ids[0].size || [...set].some((id) => !ids[0].has(id)))) {
    throw new Error("原版备份的成绩数据层标识不一致。");
  }
  return data;
}

function recoveryDraft(value: unknown, interrupted: boolean): PracticeDraft | undefined {
  const item = object(value);
  const metadata = object(item.metadata);
  const reading = interrupted ? item.type === "reading" || metadata.type === "reading" : item.kind === "reading_draft";
  const examId = str(item.examId).trim();
  const bankId = legacyBank(Object.hasOwn(item, "libraryConfigurationId") ? item.libraryConfigurationId : metadata.libraryConfigurationId);
  const sourceId = str(interrupted ? item.id || item.sessionId : item.sessionId || item.id);
  const id = `legacy-${interrupted ? "interrupted" : "draft"}:${sourceId}`;
  const updatedAt = iso(item.updatedAt) || iso(item.endTime) || iso(item.createdAt);
  if (!reading || !examId || !bankId || !sourceId || !validId(id) || !updatedAt || !isObject(item.answers)) return undefined;
  const readingTiming = legacyTiming(item.readingTiming, id, examId, bankId, false);
  return {
    id, bankId, examId, updatedAt, startedAt: iso(item.startTime),
    elapsedMs: readingTiming?.totalMs ?? (interrupted && count(item.duration) ? item.duration * 1000 : 0),
    answers: legacyAnswers(item.answers), annotations: legacyAnnotations(item), readingTiming,
    archivedAt: interrupted ? iso(item.endTime) || updatedAt : undefined,
    interruptReason: interrupted ? str(item.reason) || "archived" : undefined,
  };
}

function wordProgress(value: unknown): WordProgress | undefined {
  const { easeFactor, interval, repetitions, nextReview, lastReviewed } = object(value);
  const next = iso(nextReview);
  return next && finite(easeFactor) && easeFactor >= 1.3 && easeFactor <= 3 && count(interval) && count(repetitions)
    ? { easeFactor, interval, repetitions, nextReview: next, lastReviewed: iso(lastReviewed) } : undefined;
}

function legacyReview(value: unknown, records: Map<string, PracticeRecord>): ReviewPlan | undefined {
  const plan = object(value);
  const state = object(plan.reviewState);
  const parent = records.get(`legacy:${str(plan.recordId)}`);
  // 使用原子项位置保存的来源，兼容导出时只留有摘要的套题。
  const child = count(plan.entryIndex) ? parent?.children?.[plan.entryIndex] : parent;
  const bankId = legacyBank(plan.libraryConfigurationId);
  const examId = str(plan.examId);
  const latestCompletedAt = iso(plan.latestCompletedAt);
  const progress = wordProgress(state);
  const { reviewCount, lapseCount, lastQuality } = state;
  if (plan.unit !== "article" || state.algorithm !== "sm2-practice" || state.algorithmVersion !== 1
    || !bankId || !examId || !latestCompletedAt || !progress || !child || child.kind !== "reading" || child.examId !== examId
    || (child.bankId !== undefined && child.bankId !== bankId) || !count(reviewCount) || !count(lapseCount)
    || (lastQuality !== null && lastQuality !== "hard" && lastQuality !== "good" && lastQuality !== "easy")) return undefined;
  return {
    ...progress, revision: 1, bankId, examId, latestCompletedAt, recordId: child.id, title: child.title,
    reviewCount, lapseCount, lastQuality, lastReviewAttemptId: str(state.lastReviewAttemptId),
    appliedReviewAttemptIds: array(state.appliedReviewAttemptIds).filter((id): id is string => typeof id === "string"),
  };
}

export interface BackupInput {
  backup: Backup;
  source: "desktop" | "legacy-v2" | "legacy-records";
  ignored: number;
  archived: number;
}

export function readBackupInput(value: unknown, aliases: Record<string, string> = {}): BackupInput {
  const raw = object(value);
  if (raw.format === "ietls4pass-backup-v1") {
    if (!Array.isArray(raw.records) || !Array.isArray(raw.documents)
      || (Object.hasOwn(raw, "checksum") && typeof raw.checksum !== "string")) throw new Error("桌面备份结构无效。");
    return { backup: raw as unknown as Backup, source: "desktop", ignored: 0, archived: 0 };
  }
  const root = object(raw.data).format === "ielts-atlas-data-v2" ? object(raw.data) : raw;
  const v2 = root.format === "ielts-atlas-data-v2";
  const data = v2 ? legacyEnvelopes(root) : {};
  const history = legacyPracticeRecords(v2 ? root : value, v2);
  const documents = new Map<string, Document<unknown>>();
  function add(collection: Document<unknown>["collection"], id: string, value: unknown) {
    if (validId(id)) documents.set(`${collection}\0${id}`, { collection, id, value });
  }

  const settings = { ...object(data["preferences.values"]), ...object(data["settings.values"]) };
  const theme = settings.theme === "default" ? "system" : settings.theme;
  if (theme === "light" || theme === "dark" || theme === "system") add("settings", "theme", theme);
  const background = settings.background ?? settings.threeBackground;
  if (background === "off" || background === "melody" || background === "academic" || background === "xiaodai") {
    add("settings", "background", background);
  }

  const vocabWords = array(data["vocab.words"]);
  const vocabLists = object(data["vocab.lists"]);
  for (const [list, words] of [["ielts_core", vocabWords], ["reading", array(vocabLists["reading-highlights"])]] as const) {
    for (const item of words) {
      const word = str(object(item).word);
      const progress = wordProgress(item);
      if (word && progress) add("vocabulary", `${list}:${word}`, progress);
    }
  }
  const readingState = object(object(data["vocab.readingState"]).reading);
  const articles = new Map(array(readingState.articles).map((item) => [object(item).id, object(item)]));
  const sources = new Map(array(readingState.sources).map((item) => [object(item).id, object(item)]));
  for (const item of array(data["vocab.readingVocabWords"])) {
    const word = object(item);
    if (!str(word.word).trim()) continue;
    const associations = array(word.associations).map((item) => object(item).articleId);
    const references: Dict[] = associations.length ? associations.map((id) => articles.get(id) ?? {})
      : [{ examId: word.examId, title: word.examTitle }];
    for (const article of references) {
      const source = sources.get(article.sourceId);
      const bankId = source?.kind === "builtin" ? "main" : source?.kind === "imported" ? legacyBank(source.libraryId) ?? "" : "";
      const examId = canonicalExam(bankId, str(article.examId), aliases);
      if (!examId) continue;
      add("reading-words", JSON.stringify([word.word, bankId, examId]), {
        word: word.word, meaning: str(word.meaning), example: str(word.example), phonetic: str(word.phonetic),
        bankId, examId, title: str(article.title) || examId, selectedText: str(word.word), savedAt: iso(word.createdAt),
      });
      const progress = wordProgress(word);
      if (progress) add("vocabulary", `reading:${str(word.word)}`, progress);
    }
  }
  const records = new Map(history.records.map((record) => [record.id, record]));
  for (const value of array(data["practice.reviewPlans"])) {
    const plan = legacyReview(value, records);
    if (!plan) continue;
    const examId = canonicalExam(plan.bankId, plan.examId, aliases);
    add("review-plans", reviewPlanId(plan.bankId, examId), { ...plan, examId });
  }
  const recovered = new Map<string, PracticeDraft>();
  for (const item of array(data["recovery.drafts"])) {
    const draft = recoveryDraft(item, false);
    if (!draft || records.has(`legacy:${str(object(item).sessionId)}`)) continue;
    draft.examId = canonicalExam(draft.bankId, draft.examId, aliases);
    if (draft.readingTiming) draft.readingTiming.examId = draft.examId;
    const key = `${draft.bankId}:${draft.examId}`;
    const previous = recovered.get(key);
    if (!previous || draft.updatedAt > previous.updatedAt) recovered.set(key, draft);
  }
  for (const [key, draft] of recovered) add("drafts", key, draft);
  for (const item of array(data["recovery.interrupted"])) {
    const draft = recoveryDraft(item, true);
    if (draft) add("interrupted", draft.id, draft);
  }
  const unlocked = object(data["achievements.manual"]);
  for (const [id] of badges) {
    if (!Object.hasOwn(unlocked, id)) continue;
    const value = unlocked[id];
    if (value === true || (isObject(value) && Object.hasOwn(value, "unlockedAt"))) {
      add("achievements", id, { unlockedAt: iso(isObject(value) ? value.unlockedAt : undefined) || null });
    }
  }
  let archived = 0;
  for (const [layer, value] of Object.entries(data)) {
    if (layer.startsWith("system.") || layer.startsWith("backups.")) continue;
    add("settings", `legacy-import:${layer}`, value);
    archived++;
  }
  if (!history.records.length && !documents.size) throw new Error("备份中没有可导入的学习记录或资料。");
  function withCanonicalExam(record: PracticeRecord): PracticeRecord {
    const examId = record.kind === "reading" && record.examId ? canonicalExam(record.bankId, record.examId, aliases) : record.examId;
    return {
      ...record, examId, children: record.children?.map(withCanonicalExam),
      readingTiming: record.readingTiming && examId ? { ...record.readingTiming, examId } : record.readingTiming,
    };
  }
  return {
    backup: { format: "ietls4pass-backup-v1", records: history.records.map(withCanonicalExam), documents: [...documents.values()] },
    source: v2 ? "legacy-v2" : "legacy-records", ignored: history.ignored, archived,
  };
}
