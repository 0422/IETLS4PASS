// 2026-11-19：以单调时钟累计前台练习时间，暂停、切换窗口和恢复草稿时保持已累计读数。
import { useCallback, useEffect, useRef, useState } from "react";

export function usePracticeClock(initialMs: number, running: boolean) {
  const total = useRef(initialMs);
  const since = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(initialMs);
  const elapsed = useCallback(() => Math.max(0, Math.floor(total.current
    + (since.current === null ? 0 : performance.now() - since.current))), []);
  // 2026-11-23：在同一道写作题开始新一次作答时重置计时。
  const reset = useCallback(() => {
    total.current = 0;
    if (since.current !== null) since.current = performance.now();
    setElapsedMs(0);
  }, []);

  useEffect(() => {
    function sync() {
      total.current = elapsed();
      since.current = running && document.visibilityState === "visible" && document.hasFocus() ? performance.now() : null;
      setElapsedMs(total.current);
    }
    sync();
    window.addEventListener("blur", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    const clock = window.setInterval(() => setElapsedMs(elapsed()), 500);
    return () => {
      total.current = elapsed();
      since.current = null;
      window.clearInterval(clock);
      window.removeEventListener("blur", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [elapsed, running]);

  return { elapsedMs, elapsed, reset };
}

export function formatClock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const parts = [Math.floor(seconds / 60), seconds % 60];
  return parts.map((value) => String(value).padStart(2, "0")).join(":");
}
