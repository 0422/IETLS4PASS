// 2026-11-21：将本地 Kokoro Worker 接入练习页，一场只加载一次并缓存已合成的问题。
import type { ExaminerVoice, KokoroReply, KokoroTask } from "../domain/kokoroSpeech";
// 2026-11-23：每个 Worker 绑定当前模型目录，切换后清理旧语音缓存。
import { kokoroDirectoryVersion, resourceBase } from "./resourceDirectories";

interface Pending {
  resolve: (value: KokoroReply) => void;
  reject: (reason: Error) => void;
  timer: number;
}

export function createKokoroSpeech() {
  let worker: Worker | undefined;
  let requestId = 0;
  // 2026-11-23：记录当前线程使用的目录版本。
  let directoryVersion = kokoroDirectoryVersion();
  const pending = new Map<number, Pending>();
  const memo = new Map<string, Promise<ArrayBuffer>>();

  function close(reason = new Error("口语练习已离开。")) {
    worker?.terminate();
    worker = undefined;
    for (const request of pending.values()) {
      window.clearTimeout(request.timer);
      request.reject(reason);
    }
    pending.clear();
    memo.clear();
  }

  // 2026-11-23：下一次播报时使用更改后的模型和音色。
  function refreshDirectory() {
    const current = kokoroDirectoryVersion();
    if (directoryVersion === current) return;
    close(new Error("Kokoro 模型目录已更新。"));
    directoryVersion = current;
  }

  function send(task: KokoroTask): Promise<KokoroReply> {
    // 2026-11-23：预热也从新的模型目录开始。
    refreshDirectory();
    return new Promise((resolve, reject) => {
      if (!worker) {
        const next = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
        next.onmessage = ({ data }: MessageEvent<KokoroReply>) => {
          const request = pending.get(data.id);
          if (!request) return;
          window.clearTimeout(request.timer);
          pending.delete(data.id);
          if (data.error) request.reject(new Error(data.error));
          else request.resolve(data);
        };
        next.onerror = (event) => {
          if (worker === next) close(new Error(event.message || "Kokoro 后台线程无法启动。"));
        };
        worker = next;
      }
      const id = ++requestId;
      const timer = window.setTimeout(() => close(new Error("Kokoro 合成超时。")), 45_000);
      pending.set(id, { resolve, reject, timer });
      // 2026-11-23：模型和音色由桌面资源通道读取，运行库仍可使用已打包的位置。
      worker.postMessage({ id, ...task, modelBase: new URL(resourceBase("kokoro"), window.location.href).href });
    });
  }

  function synthesize(text: string, voice: ExaminerVoice) {
    // 2026-11-23：读取缓存前核对当前模型目录。
    refreshDirectory();
    const key = `${voice}\n${text}`;
    const existing = memo.get(key);
    if (existing) return existing;
    const result = send({ type: "synthesize", text, voice }).then(({ wav }) => {
      if (!wav?.byteLength) throw new Error("Kokoro 没有生成考官语音。");
      return wav;
    });
    memo.set(key, result);
    if (memo.size > 24) {
      const first = memo.keys().next().value;
      if (first !== undefined) memo.delete(first);
    }
    void result.catch(() => { if (memo.get(key) === result) memo.delete(key); });
    return result;
  }

  return { warm: () => send({ type: "load" }), synthesize, close };
}
