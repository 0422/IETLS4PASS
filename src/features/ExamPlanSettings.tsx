// 2026-11-27：日志页维护考试计划，窗口顶部使用同一份本机设置。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { daysUntilExam, emptyExamPlan, examSkills, overallExamBand, parseExamDate, readExamPlan } from "../domain/examPlan";
import type { ExamPlan } from "../domain/examPlan";
import { dayKey } from "../domain/records";
import { desktop, desktopAvailable, documentsKey, errorText } from "../services/desktop";
import type { Document } from "../services/desktop";
import { MonthCalendar, startOfLocalMonth } from "./MonthCalendar";

const examPlanId = "ielts-exam-plan";
const settingsKey = documentsKey("settings");
const bandOptions = Array.from({ length: 19 }, (_, index) => index / 2);
const dateLabel = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" });

function useExamPlan() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => desktop.documents<unknown>("settings"),
    enabled: desktopAvailable(),
    select: (documents) => readExamPlan(documents.find(({ id }) => id === examPlanId)?.value),
  });
}

// 2026-11-27：日期选择沿用学习活动的弹出月历和关闭操作。
function ExamDatePicker({ value, disabled, onSelect }: {
  value: string | null; disabled: boolean; onSelect: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfLocalMonth(new Date()));
  const row = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const calendarId = useId();
  const selectedDate = parseExamDate(value);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !row.current?.contains(event.target)) setOpen(false);
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

  const displayedDate = selectedDate ? dateLabel.format(selectedDate) : "选择日期";
  return <div className="exam-plan-date" ref={row}>
    <span>计划考试日期</span>
    <button ref={trigger} type="button" className="button secondary" disabled={disabled} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? calendarId : undefined} aria-label={`计划考试日期，${displayedDate}`}
      onClick={() => {
        if (!open) setMonth(startOfLocalMonth(selectedDate ?? new Date()));
        setOpen(!open);
      }}>
      <CalendarDays size={15} aria-hidden="true" />{displayedDate}<ChevronDown size={14} aria-hidden="true" />
    </button>
    {selectedDate && <button type="button" className="text-button" disabled={disabled} onClick={() => {
      setOpen(false);
      onSelect(null);
    }}>清除日期</button>}
    {open && <div id={calendarId} className="activity-range-picker exam-date-popover" role="dialog" aria-label="选择计划考试日期">
      <MonthCalendar month={month} selected={value} label="计划考试日期" onMonthChange={setMonth}
        onSelect={(date) => {
          setOpen(false);
          trigger.current?.focus();
          if (date !== value) onSelect(date);
        }} />
    </div>}
  </div>;
}

// 2026-11-27：目标总分即时更新，已保存的考试日期同步到窗口顶部。
export function ExamPlanSettings() {
  const cache = useQueryClient();
  const settings = useExamPlan();
  const save = useMutation({
    mutationFn: (plan: ExamPlan) => desktop.put("settings", examPlanId, plan),
    onSuccess: async (_, plan) => {
      await cache.cancelQueries({ queryKey: settingsKey });
      cache.setQueryData<Document<unknown>[]>(settingsKey, (documents) => [
        ...(documents ?? []).filter(({ id }) => id !== examPlanId), { collection: "settings", id: examPlanId, value: plan },
      ]);
      // 2026-11-27：同步同一集合中并行保存的其他设置。
      void cache.invalidateQueries({ queryKey: settingsKey });
    },
  });
  const saved = settings.data ?? emptyExamPlan;
  const plan = (save.isPending || save.isError) ? save.variables ?? saved : saved;
  const disabled = !settings.data || save.isPending;
  const overall = overallExamBand(plan.bands);
  return <section className="card settings-card exam-plan-settings">
    <h2>考试计划</h2>
    <div className="exam-plan-bands" role="group" aria-label="目标分数">
      {examSkills.map(({ key, label }) => <label key={key}>{label}
        <select aria-label={`${label}目标分数`} value={plan.bands[key] ?? ""} disabled={disabled}
          onChange={(event) => {
            const value = event.currentTarget.value;
            save.mutate({ ...plan, bands: { ...plan.bands, [key]: value === "" ? null : Number(value) } });
          }}>
          <option value="">—</option>
          {bandOptions.map((band) => <option key={band} value={band}>{band.toFixed(1)}</option>)}
        </select>
      </label>)}
      <div className="exam-plan-overall">
        <span>总分</span><output aria-label="目标总分">{overall === null ? "—" : overall.toFixed(1)}</output>
      </div>
    </div>
    <ExamDatePicker value={plan.date} disabled={disabled} onSelect={(date) => save.mutate({ ...plan, date })} />
    {settings.error && <p className="notice danger" role="alert">{errorText(settings.error)}</p>}
    {save.isError && <div className="notice danger table-actions" role="alert">
      <span>保存考试计划失败。{errorText(save.error)}</span>
      {save.variables && <button className="text-button" type="button" onClick={() => {
        if (save.variables) save.mutate(save.variables);
      }}>重试保存</button>}
    </div>}
  </section>;
}

// 2026-11-27：只在已设置考试日期时运行本地零点更新。
export function ExamCountdown() {
  const date = useExamPlan().data?.date;
  return date ? <ExamCountdownText date={date} /> : null;
}

function ExamCountdownText({ date }: { date: string }) {
  const [today, setToday] = useState(() => dayKey(new Date()));
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      const now = new Date();
      setToday(dayKey(now));
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      timer = window.setTimeout(refresh, midnight.getTime() - now.getTime());
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const days = daysUntilExam(date, today);
  return <span className="window-exam-countdown" role="status">{days < 0 ? "考试日期已过" : `考试还有 ${days} 天`}</span>;
}
