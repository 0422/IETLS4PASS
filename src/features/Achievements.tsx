// 2026-11-19：从正式记录生成成就，并把首次有效解锁时间保存到 SQLite。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, LockKeyhole } from "lucide-react";
import { useEffect, useMemo } from "react";
import { badges, projectAchievements } from "../domain/achievements";
import type { Unlock } from "../domain/achievements";
import { dateText } from "../domain/records";
import { desktop, desktopAvailable, documentsKey, errorText, recordsKey } from "../services/desktop";

function useUnlocks() {
  return useQuery({ queryKey: documentsKey("achievements"), queryFn: () => desktop.documents<Unlock>("achievements"), enabled: desktopAvailable() });
}

export function AchievementProjection() {
  const cache = useQueryClient();
  const records = useQuery({ queryKey: recordsKey, queryFn: desktop.records, enabled: desktopAvailable() });
  const saved = useUnlocks();
  const projected = useMemo(() => projectAchievements(records.data ?? []), [records.data]);
  useEffect(() => {
    if (!saved.data || !projected.size) return;
    const current = new Map(saved.data.map(({ id, value }) => [id, value]));
    const changes = [...projected].filter(([id, next]) => {
      const previous = current.get(id);
      return previous === undefined || (next.unlockedAt !== null && (!previous.unlockedAt || next.unlockedAt < previous.unlockedAt));
    });
    if (changes.length) void Promise.all(changes.map(([id, value]) => desktop.put("achievements", id, value)))
      .then(() => cache.invalidateQueries({ queryKey: documentsKey("achievements") })).catch(() => {});
  }, [cache, projected, saved.data]);
  return null;
}

export function Achievements() {
  const saved = useUnlocks();
  const lookup = new Map((saved.data ?? []).map(({ id, value }) => [id, value]));
  // 2026-11-23：学习成就作为独立视图，直接展示所有成就及解锁状态。
  return <section className="card achievements" aria-label="学习成就">
    <h2><Award size={19} aria-hidden="true" />已解锁 {saved.isLoading ? "—" : badges.filter(([id]) => lookup.has(id)).length} / {badges.length}</h2>
    {saved.error && <p className="notice danger" role="alert">{errorText(saved.error)}</p>}
    <div className="milestone-list">{badges.map(([id, title, info]) => <div key={id} className="milestone">
      <b>{title}</b><span>{info}</span>
      {lookup.has(id) ? <small>已解锁 · {dateText(lookup.get(id)?.unlockedAt ?? undefined)}</small>
        : <small><LockKeyhole size={12} />待解锁</small>}
    </div>)}</div>
  </section>;
}
