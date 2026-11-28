// 2026-11-23：学习活动支持日历热力图、四科提交筛选与历史区段展开。
import { CalendarDays, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { activityBlocks, activityBounds, activityShortcuts, addLocalDays } from "../domain/learningActivity";
import type { ActivityBlock, ActivityRange } from "../domain/learningActivity";
import { dayKey } from "../domain/records";
// 2026-11-27：月历外观和交互由学习活动和考试计划共用。
import { calendarWeekdays, MonthCalendar, startOfLocalMonth } from "./MonthCalendar";

const dateLabel = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" });
const heatLevels = ["0 次", "1 次", "2 次", "3 次", "4 次及以上"];

function localTime(date: Date) {
  return [date.getHours(), date.getMinutes()].map((value) => String(value).padStart(2, "0")).join(":");
}

type RangeDraft = {
  kind: ActivityRange["kind"];
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  followNow: boolean;
};

function rangeDraft(range: ActivityRange, now: Date, earliest: number): RangeDraft {
  const { start, end } = activityBounds(range, now, earliest);
  return { kind: range.kind, startDate: dayKey(start), startTime: localTime(start), endDate: dayKey(end), endTime: localTime(end),
    followNow: range.kind === "custom" && range.end === null };
}

// 2026-11-23：快捷范围和日期时间字段先编辑，确定后才更新热力图。
function ActivityRangePicker({ range, now, earliest, onApply, onCancel }: {
  range: ActivityRange;
  now: Date;
  earliest: number;
  onApply: (value: ActivityRange) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => rangeDraft(range, now, earliest));
  const [active, setActive] = useState<"start" | "end">("start");
  const [month, setMonth] = useState(() => startOfLocalMonth(activityBounds(range, now, earliest).start));
  const [error, setError] = useState("");
  const endDate = draft.followNow ? dayKey(now) : draft.endDate;
  const endTime = draft.followNow ? localTime(now) : draft.endTime;
  const selected = active === "start" ? draft.startDate : endDate;

  function showMonth(value: string) {
    const date = new Date(`${value}T00:00`);
    if (Number.isFinite(date.valueOf())) setMonth(startOfLocalMonth(date));
  }

  function focusBoundary(boundary: "start" | "end") {
    if (active === boundary) return;
    setActive(boundary);
    showMonth(boundary === "start" ? draft.startDate : endDate);
  }

  function setField(field: "startDate" | "startTime" | "endDate" | "endTime", value: string) {
    setDraft((previous) => ({ ...previous, kind: "custom", [field]: value }));
    setError("");
    if (field === "startDate" || field === "endDate") showMonth(value);
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.kind !== "custom") {
      onApply({ kind: draft.kind });
      return;
    }
    const start = Date.parse(`${draft.startDate}T${draft.startTime}:00`);
    // 2026-11-23：自定义结束时间包含选中分钟内的记录。
    const end = draft.followNow ? null : Date.parse(`${endDate}T${endTime}:59.999`);
    if (!Number.isFinite(start) || (end !== null && !Number.isFinite(end))) {
      setError("请选择有效的开始和结束时间。");
      return;
    }
    if (start > (end ?? Date.now())) {
      setError("结束时间需晚于开始时间。");
      return;
    }
    onApply({ kind: "custom", start, end });
  }

  return <form id="activity-range-picker" className="activity-range-picker" role="dialog" aria-label="选择学习活动时间范围"
    noValidate onSubmit={apply}>
    <div className="activity-shortcuts" role="group" aria-label="快捷时间范围">
      {activityShortcuts.map(({ kind, label }) => <button key={kind} type="button" className="button secondary"
        aria-pressed={draft.kind === kind} onClick={() => {
          const value = rangeDraft({ kind }, now, earliest);
          setDraft(value);
          setActive("start");
          showMonth(value.startDate);
          setError("");
        }}>{label}</button>)}
    </div>
    <div className="activity-range-body">
      <div className="activity-range-fields">
        <fieldset className="activity-range-field" data-active={active === "start"}>
          <legend>开始时间</legend>
          <input aria-label="开始日期" type="date" value={draft.startDate} onFocus={() => focusBoundary("start")}
            onChange={(event) => setField("startDate", event.currentTarget.value)} />
          <input aria-label="开始时刻" type="time" value={draft.startTime} onFocus={() => focusBoundary("start")}
            onChange={(event) => setField("startTime", event.currentTarget.value)} />
        </fieldset>
        <fieldset className="activity-range-field" data-active={active === "end"} disabled={draft.followNow}>
          <legend>结束时间</legend>
          <input aria-label="结束日期" type="date" value={endDate} onFocus={() => focusBoundary("end")}
            onChange={(event) => setField("endDate", event.currentTarget.value)} />
          <input aria-label="结束时刻" type="time" value={endTime} onFocus={() => focusBoundary("end")}
            onChange={(event) => setField("endTime", event.currentTarget.value)} />
        </fieldset>
        <label className="activity-follow-now"><input type="checkbox" checked={draft.followNow} onChange={(event) => {
          const followNow = event.currentTarget.checked;
          setDraft((previous) => ({ ...previous, kind: "custom", endDate, endTime, followNow }));
          if (followNow) focusBoundary("start");
          setError("");
        }} />结束时间跟随当前时刻</label>
      </div>
      {/* 2026-11-27：共用月历，保留学习活动的日期区间着色和起止日期切换。 */}
      <MonthCalendar month={month} selected={selected} label={`选择${active === "start" ? "开始" : "结束"}日期`}
        range={{ start: draft.startDate, end: endDate }} onMonthChange={setMonth}
        onSelect={(date) => setField(active === "start" ? "startDate" : "endDate", date)} />
    </div>
    {error && <p className="notice danger" role="alert">{error}</p>}
    <div className="activity-range-actions">
      <button type="button" className="button secondary" onClick={onCancel}>取消</button>
      <button type="submit" className="button primary">确定</button>
    </div>
  </form>;
}

// 2026-11-23：月份与周列对齐，每格使用当天的真实提交数。
function ActivityCalendar({ block, counts }: { block: ActivityBlock; counts: ReadonlyMap<string, number> }) {
  const from = dayKey(block.firstDay);
  const through = dayKey(block.lastDay);
  const weeks = block.weeks.map((week, index) => {
    const days = Array.from({ length: 7 }, (_, row) => {
      const date = addLocalDays(week, row);
      const key = dayKey(date);
      const visible = key >= from && key <= through;
      return { date, key, visible, count: visible ? counts.get(key) ?? 0 : 0 };
    });
    const month = days.find((day) => day.visible && day.date.getDate() === 1)
      ?? (index === 0 ? days.find((day) => day.visible) : undefined);
    return { days, month };
  });
  const total = weeks.reduce((sum, week) => sum + week.days.reduce((subtotal, day) => subtotal + day.count, 0), 0);
  return <div className="activity-calendar-block">
    <div className="activity-calendar-caption">
      <b>{dateLabel.format(block.firstDay)} 至 {dateLabel.format(block.lastDay)}</b><span className="muted">{total} 次提交</span>
    </div>
    <div className="activity-calendar-scroll">
      <div className="heatmap" role="group" aria-label="每天的提交次数" style={{ "--activity-weeks": weeks.length } as CSSProperties}>
        {[0, 2, 4, 6].map((row) => <span key={row} className="activity-weekday" style={{ gridRow: row + 2, gridColumn: 1 }}>周{calendarWeekdays[row]}</span>)}
        {weeks.map(({ days, month }, col) => <div className="activity-week" key={days[0].key}>
          {month && <span className="activity-month" style={{ gridColumn: col + 2, gridRow: 1 }}>{month.date.getMonth() + 1}月</span>}
          {days.map(({ key, visible, count }, row) => visible
            ? <span key={key} className={`heat-cell heat-${Math.min(4, count)}`} role="img" aria-label={`${key}，${count} 次提交`}
              title={`${key} · ${count} 次提交`} style={{ gridColumn: col + 2, gridRow: row + 2 }} />
            : <span key={key} className="heat-cell heat-empty" aria-hidden="true" style={{ gridColumn: col + 2, gridRow: row + 2 }} />)}
        </div>)}
      </div>
    </div>
  </div>;
}

export function LearningActivity({ submittedDates }: { submittedDates: string[] }) {
  const [range, setRange] = useState<ActivityRange>({ kind: "recent" });
  const [now, setNow] = useState(() => new Date());
  const [visibleBlocks, setVisibleBlocks] = useState(1);
  const [open, setOpen] = useState(false);
  const toolbar = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const times = useMemo(() => submittedDates.map((date) => Date.parse(date)).filter(Number.isFinite), [submittedDates]);

  // 2026-11-23：跟随当前时刻的范围随时间及窗口重新聚焦刷新。
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !toolbar.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const earliest = times.reduce((first, time) => Math.min(first, time), Infinity);
  const { start, end } = activityBounds(range, now, earliest);
  const { blocks, hasEarlier } = activityBlocks(start, end, visibleBlocks);
  const counts = new Map<string, number>();
  const activeDays = new Set<string>();
  for (const time of times) {
    const key = dayKey(new Date(time));
    if (time <= now.getTime()) activeDays.add(key);
    if (time >= start.getTime() && time <= end.getTime()) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let cursor = activeDays.has(dayKey(now)) ? now : addLocalDays(now, -1);
  let streak = 0;
  while (activeDays.has(dayKey(cursor))) {
    streak += 1;
    cursor = addLocalDays(cursor, -1);
  }
  const rangeLabel = activityShortcuts.find(({ kind }) => kind === range.kind)?.label
    ?? (range.kind === "custom" ? "自定义" : "最近 53 周");

  function closePicker() {
    setOpen(false);
    trigger.current?.focus();
  }

  return <section className="card activity">
    <div className="section-heading activity-toolbar" ref={toolbar}>
      <h2><CalendarDays size={19} aria-hidden="true" />学习活动</h2>
      <div className="activity-toolbar-actions">
        <span className="muted">连续学习 <b>{streak} 天</b></span>
        <button ref={trigger} type="button" className="button secondary" aria-haspopup="dialog" aria-expanded={open}
          aria-controls={open ? "activity-range-picker" : undefined} aria-label={`时间范围，${rangeLabel}`} onClick={() => {
            setNow(new Date());
            setOpen(!open);
          }}><CalendarDays size={15} aria-hidden="true" />{rangeLabel}<ChevronDown size={14} aria-hidden="true" /></button>
      </div>
      {open && <ActivityRangePicker range={range} now={now} earliest={earliest} onCancel={closePicker} onApply={(value) => {
        setNow(new Date());
        setRange(value);
        setVisibleBlocks(1);
        closePicker();
      }} />}
    </div>
    {blocks.map((block) => <ActivityCalendar key={dayKey(block.lastDay)} block={block} counts={counts} />)}
    <div className="activity-calendar-footer">
      {hasEarlier && <button type="button" className="text-button" onClick={() => setVisibleBlocks((count) => count + 1)}>展开更早记录</button>}
      {visibleBlocks > 1 && <button type="button" className="text-button" onClick={() => setVisibleBlocks(1)}>收起较早记录</button>}
      <div className="activity-heat-legend" aria-label="颜色表示当日提交次数">
        <span>少</span>{heatLevels.map((label, index) => <span className={`heat-cell heat-${index}`} key={label} role="img" aria-label={label} title={label} />)}<span>多</span>
      </div>
    </div>
  </section>;
}
