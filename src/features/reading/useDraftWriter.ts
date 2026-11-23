// 2026-11-19：串行合并阅读草稿快照，结束时等待最新版本已持久化。
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PracticeDraft } from "../../domain/types";
import { desktop, documentsKey, errorText } from "../../services/desktop";
import type { Document, WriterRevision } from "../../services/desktop";

export function useDraftWriter(draftId: string, writerId: string | undefined) {
  const cache = useQueryClient();
  const revision = useRef(0);
  const inFlight = useRef<Promise<void>>();
  const latest = useRef<{ draft: PracticeDraft; revision: number }>();
  const [savedAt, setSavedAt] = useState<string>();
  const [failure, setFailure] = useState("");
  const owned = useRef(true);

  const save = useCallback(async (draft: PracticeDraft): Promise<WriterRevision | undefined> => {
    if (!writerId) return undefined;
    if (!owned.current) throw new Error("草稿写入权已结束，请重新打开本篇。");
    const version = ++revision.current;
    latest.current = { draft, revision: version };
    if (!inFlight.current) {
      const drain = async () => {
        try {
          while (latest.current) {
            const next = latest.current;
            latest.current = undefined;
            await desktop.saveReading(draftId, { writerId, revision: next.revision }, next.draft);
            setFailure("");
            setSavedAt(next.draft.updatedAt);
            cache.setQueryData<Document<PracticeDraft>[]>(documentsKey("drafts"), (previous) => [
              ...(previous ?? []).filter((item) => item.id !== draftId),
              { collection: "drafts", id: draftId, value: next.draft },
            ]);
          }
        } catch (error) {
          const failureText = errorText(error);
          if (failureText.includes("其他页面") || failureText.includes("版本已过期")) owned.current = false;
          latest.current = undefined;
          setFailure(failureText);
          throw error;
        } finally {
          inFlight.current = undefined;
        }
      };
      inFlight.current = drain();
    }
    await inFlight.current;
    return { writerId, revision: version };
  }, [cache, draftId, writerId]);

  return { save, savedAt, failure, owned };
}
