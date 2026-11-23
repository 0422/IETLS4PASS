// 2026-11-19：以前台单调时钟记录选择区间，遇到长时间不可观测区间时标记部分计时。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReadingTiming, ReadingTimingUnit } from "../../domain/types";

type Seed = { timing: ReadingTiming; known: Set<string> };
type Timer = {
  seed: Seed;
  unit: ReadingTimingUnit | null;
  anchor: number | null;
  totals: Map<string, number>;
  unallocated: number;
  gap: boolean;
};

export function useReadingTiming(seed: Seed | undefined, eligible: boolean, boundary: () => void) {
  const ref = useRef<Timer>();
  const available = useRef(false);
  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;
  const [selected, setSelected] = useState<ReadingTimingUnit | null>(null);
  // 2026-11-19：明确区分具备计时资格与当前正在累积。
  const [accruing, setAccruing] = useState(false);

  const checkpoint = useCallback(() => {
    const timer = ref.current;
    if (!timer || timer.anchor === null) return;
    const now = performance.now();
    const delta = now - timer.anchor;
    timer.anchor = now;
    if (!Number.isFinite(delta) || delta < 0 || delta > 5_000) {
      timer.gap = true;
      timer.unit = null;
      setSelected(null);
    } else if (timer.unit) {
      timer.totals.set(timer.unit.id, (timer.totals.get(timer.unit.id) ?? 0) + delta);
    } else timer.unallocated += delta;
  }, []);

  useLayoutEffect(() => {
    if (!seed || ref.current) return;
    ref.current = {
      seed, unit: null, anchor: null, totals: new Map(seed.timing.units.map((unit) => [unit.id, unit.durationMs ?? 0])),
      unallocated: seed.timing.unallocatedMs, gap: false,
    };
  }, [seed]);

  useEffect(() => {
    const timer = ref.current;
    if (!timer) return;
    let pageAvailable = true;
    const transition = () => {
      checkpoint();
      available.current = eligible && pageAvailable && document.visibilityState === "visible" && document.hasFocus();
      setAccruing(available.current);
      timer.anchor = available.current ? performance.now() : null;
      timer.unit = null;
      setSelected(null);
      boundaryRef.current();
    };
    const hide = () => { pageAvailable = false; transition(); };
    const show = () => { pageAvailable = true; transition(); };
    transition();
    window.addEventListener("blur", transition);
    window.addEventListener("focus", transition);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    document.addEventListener("visibilitychange", transition);
    document.addEventListener("freeze", hide);
    document.addEventListener("resume", show);
    const heartbeat = window.setInterval(checkpoint, 1_000);
    return () => {
      checkpoint();
      available.current = false;
      timer.anchor = null;
      timer.unit = null;
      window.clearInterval(heartbeat);
      window.removeEventListener("blur", transition);
      window.removeEventListener("focus", transition);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      document.removeEventListener("visibilitychange", transition);
      document.removeEventListener("freeze", hide);
      document.removeEventListener("resume", show);
    };
  }, [checkpoint, eligible, seed]);

  const select = useCallback((ids: string[]) => {
    const timer = ref.current;
    if (!timer || !available.current || timer.anchor === null) return;
    checkpoint();
    const unit = ids.length ? timer.seed.timing.units.find((candidate) => candidate.durationMs !== null
      && timer.seed.known.has(candidate.id) && ids.every((id) => candidate.questionIds.includes(id))) ?? null : null;
    if (timer.unit?.id === unit?.id) return;
    timer.unit = unit;
    setSelected(unit);
    boundaryRef.current();
  }, [checkpoint]);

  const snapshot = useCallback((finalized = false): ReadingTiming | undefined => {
    const timer = ref.current;
    if (!timer) return undefined;
    checkpoint();
    if (finalized) {
      available.current = false;
      setAccruing(false);
      timer.anchor = null;
      timer.unit = null;
      setSelected(null);
    }
    const units = timer.seed.timing.units.map((unit) => ({
      ...unit, durationMs: unit.durationMs === null ? null : Math.floor(timer.totals.get(unit.id) ?? 0),
    }));
    const unallocatedMs = Math.floor(timer.unallocated);
    return {
      ...timer.seed.timing, units, unallocatedMs, finalized,
      totalMs: units.reduce((total, unit) => total + (unit.durationMs ?? 0), unallocatedMs),
      reasons: [...new Set([...timer.seed.timing.reasons, ...(timer.gap ? ["clock-gap" as const] : [])])],
    };
  }, [checkpoint]);

  return { selected, accruing, select, snapshot };
}
