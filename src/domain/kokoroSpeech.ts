// 2026-11-21：固定两种英式考官音色，作为会话、设置和合成线程的共同标识。
export const examinerVoices = {
  bf_emma: "Emma · 英式女声",
  bm_george: "George · 英式男声",
} as const;

export type ExaminerVoice = keyof typeof examinerVoices;
export const defaultExaminerVoice: ExaminerVoice = "bf_emma";

export function isExaminerVoice(value: unknown): value is ExaminerVoice {
  return value === "bf_emma" || value === "bm_george";
}

export type KokoroTask = { type: "load" } | { type: "synthesize"; text: string; voice: ExaminerVoice };
// 2026-11-23：Worker 通过调用方解析出的资源入口访问模型。
export type KokoroRequest = KokoroTask & { id: number; modelBase: string };
export type KokoroReply = { id: number; wav?: ArrayBuffer; error?: string };

// 2026-11-21：Kokoro 返回 24 kHz 浮点采样，将其转换为浏览器可播放的 WAV。
export function kokoroWave(samples: Float32Array): ArrayBuffer {
  const rate = 24_000;
  const pcmBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + pcmBytes);
  const header = new DataView(buffer);
  header.setUint32(0, 0x52494646);
  header.setUint32(4, 36 + pcmBytes, true);
  header.setUint32(8, 0x57415645);
  header.setUint32(12, 0x666d7420);
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  header.setUint32(36, 0x64617461);
  header.setUint32(40, pcmBytes, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    header.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}
