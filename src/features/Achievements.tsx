// 2026-11-19：从正式记录生成成就，并把首次有效解锁时间保存到 SQLite。
import { useQuery, useQueryClient } from "@tanstack/react-query";
// 2026-11-27：总览成就卡使用折叠箭头，并支持旧链接定位。
import { Award, ChevronRight, LockKeyhole } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
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

// 2026-11-27：成就独立页面改为总览底部的折叠区块。
export function Achievements({ reveal }: { reveal: boolean }) {
  const saved = useUnlocks();
  const lookup = new Map((saved.data ?? []).map(({ id, value }) => [id, value]));
  const details = useRef<HTMLDetailsElement>(null);
  // 2026-11-27：通过旧链接进入时展开并滚动到成就卡，普通总览默认折叠。
  useLayoutEffect(() => {
    const disclosure = details.current;
    if (!disclosure) return;
    disclosure.open = reveal;
    if (reveal) disclosure.scrollIntoView({ block: "start" });
  }, [reveal]);

  return <details className="card study-achievements" ref={details}>
    {/* 2026-11-27：折叠时也显示已解锁数量。 */}
    <summary>
      <ChevronRight className="study-achievements-chevron" size={16} aria-hidden="true" />
      <Award size={19} aria-hidden="true" />
      <span>学习成就</span>
      <small>已解锁 {saved.isLoading ? "—" : badges.filter(([id]) => lookup.has(id)).length} / {badges.length}</small>
    </summary>
    {saved.error && <p className="notice danger" role="alert">{errorText(saved.error)}</p>}
    <div className="milestone-list">{badges.map(([id, title, info]) => <div key={id} className="milestone">
      <b>{title}</b><span>{info}</span>
      {lookup.has(id) ? <small>已解锁 · {dateText(lookup.get(id)?.unlockedAt ?? undefined)}</small>
        : <small><LockKeyhole size={12} />待解锁</small>}
    </div>)}</div>
  </details>;
}
