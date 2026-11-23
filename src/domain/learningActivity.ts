// 2026-11-23：学习活动按本地日期对齐周一，长区间按 53 周分段。
export const activityShortcuts = [
  { kind: "today", label: "当天" },
  { kind: "24h", label: "近 24 小时" },
  { kind: "7d", label: "近 7 天" },
  { kind: "14d", label: "近 14 天" },
  { kind: "30d", label: "近 30 天" },
  { kind: "all", label: "全部" },
] as const;

type ActivityPreset = "recent" | (typeof activityShortcuts)[number]["kind"];

export type ActivityRange = { kind: ActivityPreset }
  | { kind: "custom"; start: number; end: number | null };

export function startOfLocalDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addLocalDays(value: Date, count: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + count);
  return date;
}

export function startOfLocalWeek(value: Date) {
  return addLocalDays(startOfLocalDay(value), -((value.getDay() + 6) % 7));
}

const weeksPerBlock = 53;

// 2026-11-23：小时快捷项按实际时间，按天快捷项从本地零点起算。
export function activityBounds(range: ActivityRange, now: Date, earliest: number) {
  const recentStart = addLocalDays(startOfLocalWeek(now), (1 - weeksPerBlock) * 7);
  const today = startOfLocalDay(now);
  switch (range.kind) {
    case "recent": return { start: recentStart, end: now };
    case "today": return { start: today, end: now };
    case "24h": return { start: new Date(now.getTime() - 86_400_000), end: now };
    case "7d": return { start: addLocalDays(today, -6), end: now };
    case "14d": return { start: addLocalDays(today, -13), end: now };
    case "30d": return { start: addLocalDays(today, -29), end: now };
    case "all": return { start: new Date(Math.min(recentStart.getTime(), earliest)), end: now };
    case "custom": return { start: new Date(range.start), end: range.end === null ? now : new Date(range.end) };
  }
}

export interface ActivityBlock {
  firstDay: Date;
  lastDay: Date;
  weeks: Date[];
}

// 2026-11-23：仅生成已展开的区段，按本地日期递增以跨过夏令时。
export function activityBlocks(start: Date, end: Date, limit: number) {
  const firstWeek = startOfLocalWeek(start);
  const blocks: ActivityBlock[] = [];
  const rangeStart = startOfLocalDay(start);
  let lastDay = startOfLocalDay(end);
  while (blocks.length < limit && lastDay >= rangeStart) {
    const lastWeek = startOfLocalWeek(lastDay);
    const blockStart = addLocalDays(lastWeek, (1 - weeksPerBlock) * 7);
    const from = blockStart < firstWeek ? firstWeek : blockStart;
    const weeks: Date[] = [];
    for (let cursor = from; cursor <= lastWeek; cursor = addLocalDays(cursor, 7)) weeks.push(cursor);
    blocks.push({ firstDay: from < rangeStart ? rangeStart : from, lastDay, weeks });
    lastDay = addLocalDays(from, -1);
  }
  return { blocks, hasEarlier: lastDay >= rangeStart };
}
