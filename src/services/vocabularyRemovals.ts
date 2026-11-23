// 2026-11-23：词条立即隐藏，删除记录在页面之外合并保存，切页和关闭窗口时可等待写入完成。
import type { QueryClient } from "@tanstack/react-query";
import type { VocabularyEdit } from "../domain/vocabulary";
import { desktop, documentsKey, errorText } from "./desktop";
import type { Document } from "./desktop";

export const vocabularyEditsKey = documentsKey("vocabulary-edits");

const queued = new Set<string>();
const listeners = new Set<() => void>();
let pending: ReadonlySet<string> = new Set();
let problem = "";
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<boolean> | undefined;

function notify() {
  for (const listener of listeners) listener();
}

export async function applyVocabularyEdits(cache: QueryClient, changes: ReadonlyMap<string, VocabularyEdit>) {
  const query = { queryKey: vocabularyEditsKey, exact: true };
  if (cache.getQueryData(vocabularyEditsKey) === undefined) {
    await cache.invalidateQueries(query);
    return;
  }
  // 2026-11-23：取消可能还在返回旧快照的读取，只更新提交成功的条目。
  await cache.cancelQueries(query);
  cache.setQueryData<Document<VocabularyEdit>[]>(vocabularyEditsKey, (current) => current && [
    ...current.filter(({ id }) => !changes.has(id)),
    ...[...changes].map(([id, value]) => ({ collection: "vocabulary-edits" as const, id, value })),
  ]);
}

async function saveQueued(cache: QueryClient) {
  let complete = true;
  while (queued.size) {
    const ids = [...queued];
    queued.clear();
    try {
      await desktop.removeVocabularyWords(ids);
      await applyVocabularyEdits(cache, new Map<string, VocabularyEdit>(ids.map((id) => [id, { kind: "remove" }])));
    } catch (error) {
      complete = false;
      problem = `有 ${ids.length} 个词条未能从词表删除。${errorText(error)}`;
    }
    // 2026-11-23：成功后由查询缓存维持隐藏，写入失败时解除隐藏以便重试。
    const remaining = new Set(pending);
    for (const id of ids) remaining.delete(id);
    pending = remaining;
    notify();
  }
  return complete;
}

export const vocabularyRemovals = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  pending: () => pending,
  error: () => problem,
  dismissError() {
    problem = "";
    notify();
  },
  enqueue(cache: QueryClient, id: string) {
    if (pending.has(id)) return;
    queued.add(id);
    pending = new Set(pending).add(id);
    if (timer === undefined && !saving) {
      timer = setTimeout(() => { void vocabularyRemovals.flush(cache); }, 150);
    }
    notify();
  },
  flush(cache: QueryClient) {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!saving && queued.size) {
      saving = saveQueued(cache).finally(() => { saving = undefined; });
    }
    return saving ?? Promise.resolve(true);
  },
};
