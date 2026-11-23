// 2026-11-19：只记录固定操作标识和结果，SQLite 不可用时保留最近的内存事件。
import { invoke, isTauri } from "@tauri-apps/api/core";

type Result = "error" | "ok";
interface Event { occurredAt: string; operation: string; result: Result }
interface Preference { enabled: boolean; detailedUntil: string | null }
interface NativeReport { version: string; preference: Preference; events: Event[] }

let preference: Preference = { enabled: true, detailedUntil: null };
const memory: Event[] = [];
let startupFailureRecorded = false;

export function reportDiagnostic(operation: string, result: Result = "error") {
  if (!isTauri() || !preference.enabled || (result === "ok" && Date.now() >= Date.parse(preference.detailedUntil ?? ""))) return;
  if (result === "ok" && !preference.detailedUntil) return;
  const event = { operation, result, occurredAt: new Date().toISOString() };
  void invoke<boolean>("record_diagnostic", { operation, result }).catch(() => {
    if (!preference.enabled || result !== "error") return;
    memory.unshift(event);
    if (memory.length > 200) memory.length = 200;
  });
}

export async function diagnosticReport() {
  try {
    const report = await invoke<NativeReport>("diagnostic_report");
    preference = report.preference;
    if (!preference.enabled) memory.length = 0;
    return { ...report, storage: "sqlite" as const, memory: [...memory] };
  } catch {
    if (preference.enabled && !startupFailureRecorded) {
      startupFailureRecorded = true;
      memory.unshift({ operation: "startup", result: "error", occurredAt: new Date().toISOString() });
      if (memory.length > 200) memory.length = 200;
    }
    return { version: null, preference, events: [], storage: "memory" as const, memory: [...memory] };
  }
}

export async function configureDiagnostics(enabled: boolean, detailed: boolean) {
  preference = await invoke<Preference>("configure_diagnostics", { enabled, detailed });
  if (!enabled) memory.length = 0;
}

export async function clearDiagnostics(persistent: boolean) {
  if (persistent) await invoke("clear_diagnostics");
  memory.length = 0;
}
