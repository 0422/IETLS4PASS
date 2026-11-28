// 2026-11-19：移植上游成就阈值，以正式练习和实际日期推算解锁。
// 2026-11-23：成就和总览按同一批正式提交统计。
import { usableScore } from "./records";
import type { PracticeRecord } from "./types";

export interface Unlock { unlockedAt: string | null }
export const badges = [
  ["first_step", "迈出第一步", "完成第一次练习"],
  ["practice_bronze", "初出茅庐", "累计完成 10 次练习"],
  ["practice_silver", "渐入佳境", "累计完成 50 次练习"],
  ["practice_gold", "百炼成钢", "累计完成 100 次练习"],
  ["practice_platinum", "千锤百炼", "累计完成 200 次练习"],
  ["streak_bronze", "持之以恒", "连续学习 3 天"],
  ["streak_silver", "习惯养成", "连续学习 7 天"],
  ["streak_gold", "意志如铁", "连续学习 30 天"],
  ["streak_platinum", "长期主义", "连续学习 60 天"],
  ["reading_first", "开卷第一篇", "完成 1 篇阅读练习"],
  ["reading_bronze", "火眼金睛（铜）", "累计完成 10 次阅读练习"],
  ["reading_silver", "火眼金睛（银）", "累计完成 50 次阅读练习"],
  ["reading_gold", "火眼金睛（金）", "累计完成 100 次阅读练习"],
  ["listening_first", "开耳第一篇", "完成 1 篇听力练习"],
  ["listening_bronze", "顺风耳（铜）", "累计完成 10 次听力练习"],
  ["listening_silver", "顺风耳（银）", "累计完成 50 次听力练习"],
  ["listening_gold", "顺风耳（金）", "累计完成 100 次听力练习"],
  ["balanced_foundation", "双线推进", "阅读与听力各完成 10 次"],
  ["balanced_advanced", "均衡进阶", "阅读与听力各完成 30 次"],
  ["time_focus_60", "专注一小时", "累计练习记录用时达 60 分钟"],
  ["time_focus_300", "沉浸五小时", "累计练习记录用时达 300 分钟"],
  ["time_focus_1000", "深度备考", "累计练习记录用时达 1,000 分钟"],
  ["accuracy_stable", "稳中有进", "10 次练习后平均正确率达到 70%"],
  ["accuracy_elite", "高分稳定", "20 次练习后平均正确率达到 85%"],
  ["accuracy_perfect", "神射手", "一次练习获得满分"],
  ["perfect_three", "三次满分", "累计 3 次练习获得满分"],
  ["perfect_ten", "十全十美", "累计 10 次练习获得满分"],
  ["speed_demon", "唯快不破", "一次练习在 5 分钟内超过 80%"],
  ["speed_three", "快速稳定", "3 次练习在 5 分钟内超过 80%"],
  ["speed_ten", "闪电节奏", "10 次练习在 5 分钟内超过 80%"],
] as const;

export function projectAchievements(records: PracticeRecord[]) {
  const candidates = new Map<string, Unlock>();
  const set = (id: string, timestamp: string | null) => {
    if (!candidates.has(id)) candidates.set(id, { unlockedAt: timestamp });
  };
  const items = records.map((record) => {
    const ms = Date.parse(record.submittedAt);
    return { record, ms, date: Number.isFinite(ms) ? new Date(ms).toISOString() : null };
  }).sort((a, b) => (a.date ? a.ms : Infinity) - (b.date ? b.ms : Infinity));
  for (const [id, threshold] of [["first_step", 1], ["practice_bronze", 10], ["practice_silver", 50], ["practice_gold", 100], ["practice_platinum", 200]] as const) {
    if (items.length >= threshold) set(id, items[threshold - 1].date);
  }
  const reading = items.filter(({ record }) => record.kind === "reading");
  const listening = items.filter(({ record }) => record.kind === "listening");
  for (const [group, entries] of [["reading", reading], ["listening", listening]] as const) {
    for (const [suffix, threshold] of [["first", 1], ["bronze", 10], ["silver", 50], ["gold", 100]] as const) {
      if (entries.length >= threshold) set(`${group}_${suffix}`, entries[threshold - 1].date);
    }
  }
  for (const [suffix, threshold] of [["foundation", 10], ["advanced", 30]] as const) {
    if (reading.length >= threshold && listening.length >= threshold) {
      const values = [reading[threshold - 1].date, listening[threshold - 1].date];
      set(`balanced_${suffix}`, values.every(Boolean) ? values.sort()[1] : null);
    }
  }

  let cumulativeMs = 0;
  let cumulativeAccuracy = 0;
  let perfect = 0;
  let fast = 0;
  const days = new Map<string, string>();
  items.forEach(({ record, date }, index) => {
    const accuracy = usableScore(record) ? (record.points ?? 0) / (record.possible ?? 1) : 0;
    const ms = typeof record.elapsedMs === "number" && Number.isFinite(record.elapsedMs) ? Math.max(0, record.elapsedMs) : 0;
    cumulativeMs += ms;
    cumulativeAccuracy += accuracy;
    for (const threshold of [60, 300, 1_000]) if (cumulativeMs >= threshold * 60_000) set(`time_focus_${threshold}`, date);
    if (index + 1 >= 10 && cumulativeAccuracy / (index + 1) >= 0.7) set("accuracy_stable", date);
    if (index + 1 >= 20 && cumulativeAccuracy / (index + 1) >= 0.85) set("accuracy_elite", date);
    if (accuracy === 1) {
      perfect += 1;
      set("accuracy_perfect", date);
      if (perfect === 3) set("perfect_three", date);
      if (perfect === 10) set("perfect_ten", date);
    }
    if (accuracy > 0.8 && ms > 0 && ms <= 300_000) {
      fast += 1;
      set("speed_demon", date);
      if (fast === 3) set("speed_three", date);
      if (fast === 10) set("speed_ten", date);
    }
    if (date && !days.has(date.slice(0, 10))) days.set(date.slice(0, 10), date);
  });
  let last = -Infinity;
  let streak = 0;
  for (const [day, date] of days) {
    const current = Date.parse(`${day}T00:00:00.000Z`);
    streak = current - last === 86_400_000 ? streak + 1 : 1;
    last = current;
    for (const [id, threshold] of [["streak_bronze", 3], ["streak_silver", 7], ["streak_gold", 30], ["streak_platinum", 60]] as const) {
      if (streak === threshold) set(id, date);
    }
  }
  return candidates;
}
