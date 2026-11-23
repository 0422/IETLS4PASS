// 2026-11-23：页面只按资源类型和相对文件取用数据，桌面端集中解析实际目录。
import { convertFileSrc } from "@tauri-apps/api/core";
import { desktopAvailable } from "./desktop";

export function resourceBase(kind: "reading" | "vocabulary" | "kokoro") {
  if (desktopAvailable()) return `${convertFileSrc(kind, "study-data")}/`;
  return kind === "kokoro"
    ? `${import.meta.env.BASE_URL}tts/kokoro/`
    : `${import.meta.env.BASE_URL}data/${kind}/`;
}

export function resourceFile(kind: "reading" | "vocabulary", relative: string) {
  return resourceBase(kind) + relative.split("/").map(encodeURIComponent).join("/");
}

// 2026-11-23：切换模型目录时重新加载推理线程和音色缓存。
let modelDirectoryVersion = 0;
export const kokoroDirectoryVersion = () => modelDirectoryVersion;
export function notifyKokoroDirectoryChanged() {
  modelDirectoryVersion += 1;
}
