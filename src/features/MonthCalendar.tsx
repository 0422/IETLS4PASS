// 2026-11-27：学习活动和考试计划共用月份切换及日期选取界面。
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addLocalDays, startOfLocalWeek } from "../domain/learningActivity";
import { dayKey } from "../domain/records";

export const calendarWeekdays = ["一", "二", "三", "四", "五", "六", "日"];
const dateLabel = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" });

export function startOfLocalMonth(value: Date) {
  const date = new Date(value);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function MonthCalendar({ month, selected, label, range, onMonthChange, onSelect }: {
  month: Date;
  selected: string | null;
  label: string;
  range?: { start: string; end: string };
  onMonthChange: (month: Date) => void;
  onSelect: (date: string) => void;
}) {
  const gridStart = startOfLocalWeek(month);
  function moveMonth(offset: number) {
    const next = new Date(month);
    next.setMonth(next.getMonth() + offset);
    onMonthChange(next);
  }
  return <div className="activity-picker-calendar" role="group" aria-label={label}>
    <div className="activity-picker-month">
      <button type="button" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={16} aria-hidden="true" /></button>
      <b aria-live="polite">{month.getFullYear()}年{month.getMonth() + 1}月</b>
      <button type="button" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={16} aria-hidden="true" /></button>
    </div>
    <div className="activity-picker-days">
      {calendarWeekdays.map((day) => <span key={day} aria-hidden="true">{day}</span>)}
      {Array.from({ length: 42 }, (_, index) => {
        const date = addLocalDays(gridStart, index);
        const key = dayKey(date);
        return <button key={key} type="button" aria-label={dateLabel.format(date)} aria-pressed={key === selected}
          data-outside-month={date.getMonth() !== month.getMonth()} data-in-range={range && key >= range.start && key <= range.end}
          onClick={() => onSelect(key)}>{date.getDate()}</button>;
      })}
    </div>
  </div>;
}
