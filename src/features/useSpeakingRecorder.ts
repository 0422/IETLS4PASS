// 2026-11-21：按住录音，松开发送 16 kHz 单声道 16-bit WAV。
import { useEffect, useRef, useState } from "react";

// 2026-11-21：以独立脚本部署录音处理器，使用应用的同源脚本策略。
const workletUrl = new URL("./speakingAudio.js?no-inline", import.meta.url).href;
const sampleRate = 16_000;
const maxSeconds = 120;

export interface SpeakingAudio {
  bytes: Uint8Array;
  durationMs: number;
  // 2026-11-21：收尾和转写等待时间不计入作答。
  endedAt: number;
}

//   // 2026-11-21：松手后等待音频线程确认，并为装置异常保留超时收尾。
//
//   // 2026-11-21：切换话题或关麦时取消收尾定时器。
//     // 2026-11-21：结束或取消后释放音频端口。

// 2026-11-21：麦克风和音频处理器在本场练习中复用，单次录音独立收集。
type MicrophoneStatus = "off" | "opening" | "ready";
type CaptureStatus = "idle" | "recording" | "finishing";

interface Microphone {
  context: AudioContext;
  stream: MediaStream;
  recorder?: AudioWorkletNode;
  source?: MediaStreamAudioSourceNode;
  readyTimer?: number;
}

interface Capture {
  id: number;
  parts: Float32Array[];
  samples: number;
  endedAt?: number;
  flushTimer?: number;
}

type RecorderMessage =
  | { type: "ready" }
  | { type: "samples"; id: number; samples: Float32Array }
  | { type: "finished"; id: number };

function closeMicrophone(device?: Microphone) {
  if (!device) return;
  window.clearTimeout(device.readyTimer);
  if (device.recorder) {
    device.recorder.port.onmessage = null;
    device.recorder.onprocessorerror = null;
    device.recorder.port.close();
    device.recorder.disconnect();
  }
  device.source?.disconnect();
  device.stream.getTracks().forEach((track) => track.stop());
  if (device.context.state !== "closed") void device.context.close().catch(() => undefined);
}

// 2026-11-21：音频结果携带松手时间，供作答计时使用。
// 2026-11-21：编码使用本场设备的采样率，录音块和麦克风连接分开保存。
function audioFrom(capture: Capture, endedAt: number, inputRate: number): SpeakingAudio {
  const samples = new Float32Array(capture.samples);
  let cursor = 0;
  for (const part of capture.parts) { samples.set(part, cursor); cursor += part.length; }
  const count = Math.min(sampleRate * maxSeconds, Math.floor(samples.length * sampleRate / inputRate));
  const bytes = new Uint8Array(44 + count * 2);
  const wav = new DataView(bytes.buffer);
  const marker = (offset: number, text: string) => bytes.set(Array.from(text, (value) => value.charCodeAt(0)), offset);
  marker(0, "RIFF"); wav.setUint32(4, bytes.length - 8, true); marker(8, "WAVE");
  marker(12, "fmt "); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
  wav.setUint32(24, sampleRate, true); wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); marker(36, "data"); wav.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * inputRate / sampleRate);
    const end = Math.max(start + 1, Math.floor((i + 1) * inputRate / sampleRate));
    let total = 0;
    for (let index = start; index < end; index++) total += samples[index] ?? 0;
    const value = Math.max(-1, Math.min(1, total / (end - start)));
    wav.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  // 2026-11-21：一次转写和试听共用同一份音频及其时间信息。
  return { bytes, durationMs: Math.round(count * 1000 / sampleRate), endedAt };
}

//   // 2026-11-21：收尾时保持录音操作锁定，直到收到最后一批样本。
//
//
//   // 2026-11-21：最后一批样本或收尾超时到达后，只处理一次录音。
//
//
//     // 2026-11-21：前一次录音仍在收尾时不再打开麦克风。
//       // 2026-11-21：收到实际音频后才提示「录音中」，收到结束确认后才发送转写。
//

// 2026-11-21：启用一次后按住即可录音，关麦或退出时统一释放连接。
export function useSpeakingRecorder(onAudio: (audio: SpeakingAudio) => void, onError: (message: string) => void) {
  const callbacks = useRef({ onAudio, onError });
  callbacks.current = { onAudio, onError };
  const device = useRef<Microphone>();
  const capture = useRef<Capture>();
  const opening = useRef(false);
  const generation = useRef(0);
  const nextCaptureId = useRef(0);
  const [microphone, setMicrophone] = useState<MicrophoneStatus>("off");
  const [state, setState] = useState<CaptureStatus>("idle");

  function release() {
    generation.current++;
    opening.current = false;
    window.clearTimeout(capture.current?.flushTimer);
    capture.current = undefined;
    const current = device.current;
    device.current = undefined;
    closeMicrophone(current);
  }

  function disable() {
    release();
    setState("idle");
    setMicrophone("off");
  }

  function finish(current: Capture) {
    if (capture.current !== current) return;
    window.clearTimeout(current.flushTimer);
    capture.current = undefined;
    setState("idle");
    if (current.endedAt === undefined || !device.current) return;
    const audio = audioFrom(current, current.endedAt, device.current.context.sampleRate);
    if (audio.durationMs > 0) {
      callbacks.current.onAudio(audio);
      return;
    }
    callbacks.current.onError("没有收到录音，请按住说话后再松开。");
  }

  function stop(send = true) {
    const current = capture.current;
    const recorder = device.current?.recorder;
    if (!current || !recorder) return false;
    if (current.endedAt !== undefined) return true;
    if (!send) {
      recorder.port.postMessage({ type: "cancel", id: current.id });
      finish(current);
      return false;
    }
    current.endedAt = Date.now();
    setState("finishing");
    current.flushTimer = window.setTimeout(() => finish(current), 500);
    recorder.port.postMessage({ type: "finish", id: current.id });
    return true;
  }

  function start() {
    const recorder = device.current?.recorder;
    if (!recorder || opening.current || capture.current) return;
    const current: Capture = { id: ++nextCaptureId.current, parts: [], samples: 0 };
    capture.current = current;
    recorder.port.postMessage({ type: "start", id: current.id });
    setState("recording");
  }

  async function enable() {
    if (opening.current || device.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      callbacks.current.onError("当前环境无法使用麦克风。你可以输入文字回答。");
      return;
    }
    opening.current = true;
    const attempt = ++generation.current;
    setMicrophone("opening");
    let stream: MediaStream | undefined;
    function fail(message: string) {
      if (generation.current !== attempt) return;
      if (!device.current) stream?.getTracks().forEach((track) => track.stop());
      disable();
      callbacks.current.onError(message);
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      if (generation.current !== attempt) { stream.getTracks().forEach((track) => track.stop()); return; }
      const context = new AudioContext();
      const current: Microphone = { context, stream };
      device.current = current;
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", () => fail("麦克风已断开，请检查设备后重新启用。"), { once: true });
      }
      // 2026-11-21：等待实际音频到达后再允许按住说话，异常时可以重新启用。
      current.readyTimer = window.setTimeout(() => fail("麦克风未就绪，请检查设备后重试。"), 5000);
      await context.audioWorklet.addModule(workletUrl);
      if (generation.current !== attempt) return;
      await context.resume();
      if (generation.current !== attempt) return;

      const source = context.createMediaStreamSource(stream);
      const recorder = new AudioWorkletNode(context, "speaking-audio");
      current.source = source;
      current.recorder = recorder;
      recorder.onprocessorerror = () => fail("麦克风录音处理失败，请重新启用。");
      recorder.port.onmessage = ({ data }: MessageEvent<RecorderMessage>) => {
        if (generation.current !== attempt) return;
        if (data.type === "ready") {
          window.clearTimeout(current.readyTimer);
          opening.current = false;
          setMicrophone("ready");
          return;
        }
        const take = capture.current;
        if (!take || data.id !== take.id) return;
        if (data.type === "finished") {
          finish(take);
          return;
        }
        take.parts.push(data.samples);
        take.samples += data.samples.length;
        if (take.samples >= context.sampleRate * maxSeconds) stop();
      };
      source.connect(recorder).connect(context.destination);
    } catch {
      fail("无法启用麦克风。请检查麦克风权限或使用文字回答。");
    }
  }

  useEffect(() => release, []);
  return { microphone, state, enable, disable, start, stop };
}
