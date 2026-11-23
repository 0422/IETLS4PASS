// 2026-11-21：用同源 eSpeak 和 ONNX WASM 合成英式考官语音，推理放在后台线程。
import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import { phonemize } from "phonemizer";
import { kokoroWave } from "../domain/kokoroSpeech";
import type { ExaminerVoice, KokoroReply, KokoroRequest } from "../domain/kokoroSpeech";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<KokoroRequest>) => void) | null;
  postMessage: (message: KokoroReply, transfer?: Transferable[]) => void;
};

const assets = new URL(`${import.meta.env.BASE_URL}tts/kokoro/`, self.location.href);
env.wasm.numThreads = 1;
env.wasm.proxy = false;
env.wasm.wasmPaths = new URL("runtime/", assets).href;

const styleSize = 256;
const voiceFrames = 510;
const voices = new Map<ExaminerVoice, Float32Array>();
let engine: Promise<Awaited<ReturnType<typeof load>>> | undefined;
let work = Promise.resolve();

// 2026-11-23：模型文件根据系统设置读取，WASM 运行库继续走同源地址。
async function asset(file: string, modelBase: string) {
  const response = await fetch(new URL(file, modelBase));
  if (!response.ok) throw new Error(`读取 Kokoro 资源失败：${file}（HTTP ${response.status}）`);
  return response;
}

// 2026-11-23：配置、分词器和 ONNX 模型来自同一个有效目录。
async function load(modelBase: string) {
  const [model, tokenizer, parameters] = await Promise.all([
    // 2026-11-23：配置文件通过当前模型根目录取用。
    asset("config.json", modelBase).then((file) => file.json()) as Promise<{ model_type: string }>,
    asset("tokenizer.json", modelBase).then((file) => file.json()) as Promise<{
      normalizer: { pattern: { Regex: string } }; model: { vocab: Record<string, number> };
    }>,
    asset("tokenizer_config.json", modelBase).then((file) => file.json()) as Promise<{ pad_token: string; model_max_length: number }>,
  ]);
  const vocabulary = tokenizer.model.vocab;
  const boundary = vocabulary[parameters.pad_token];
  if (model.model_type !== "style_text_to_speech_2" || !Number.isInteger(boundary) || parameters.model_max_length < 3) {
    throw new Error("Kokoro 模型与分词配置不匹配。");
  }
  // 2026-11-23：推理读取所选目录内的 ONNX 文件。
  const session = await InferenceSession.create(new URL("onnx/model_quantized.onnx", modelBase).href, {
    executionProviders: ["wasm"],
  });
  return { session, vocabulary, boundary, maxTokens: parameters.model_max_length - 2,
    unsupported: new RegExp(tokenizer.normalizer.pattern.Regex, "gu") };
}

// 2026-11-23：音色与模型使用同一个根目录。
async function voiceData(voice: ExaminerVoice, modelBase: string) {
  const cached = voices.get(voice);
  if (cached) return cached;
  const file = await asset(`voices/${voice}.bin`, modelBase);
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== voiceFrames * styleSize * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error("Kokoro 音色文件大小不匹配。");
  }
  const data = new Float32Array(bytes);
  voices.set(voice, data);
  return data;
}

async function questionPhones(text: string) {
  const prepared = text.trim().replace(/[‘’]/g, "'").replace(/\s+/g, " ")
    .replace(/\bMr\./gi, "Mister").replace(/\bMrs\./gi, "Missus").replace(/\bDr\./gi, "Doctor");
  const pieces = prepared.split(/([,;:.!?—…]+)/u);
  const sounded = await Promise.all(pieces.map((piece, index) => {
    if (index % 2 || !piece.trim()) return piece;
    return phonemize(piece.trim(), "en-gb").then((sounds) => sounds.join(" "));
  }));
  return sounded.join(" ").replace(/\s+([,;:.!?—…])/gu, "$1")
    .replace(/r/g, "ɹ").replace(/x/g, "k").replace(/ɬ/g, "l").replace(/ʲ/g, "j").trim();
}

async function reply(request: KokoroRequest) {
  try {
    // 2026-11-23：从请求携带的模型根目录初始化当前 Worker。
    const ready = await (engine ??= load(request.modelBase).catch((reason: unknown) => {
      engine = undefined;
      throw reason;
    }));
    if (request.type === "load") {
      worker.postMessage({ id: request.id });
      return;
    }
    const data = await voiceData(request.voice, request.modelBase);
    const phones = (await questionPhones(request.text)).replace(ready.unsupported, "");
    const ids = Array.from(phones, (phone) => ready.vocabulary[phone]).filter(Number.isInteger);
    if (!ids.length || ids.length > ready.maxTokens) throw new Error("这条考官问题无法转换为 Kokoro 音素。");
    // 2026-11-21：音色矩阵按音素长度索引，模型输入与 v1.0 的 ONNX 导出一致。
    const offset = Math.min(ids.length, voiceFrames - 1) * styleSize;
    const tokens = new BigInt64Array([ready.boundary, ...ids, ready.boundary].map(BigInt));
    const result = await ready.session.run({
      input_ids: new Tensor("int64", tokens, [1, tokens.length]),
      style: new Tensor("float32", data.slice(offset, offset + styleSize), [1, styleSize]),
      speed: new Tensor("float32", new Float32Array([1]), [1]),
    });
    const samples = result.waveform?.data;
    if (!(samples instanceof Float32Array) || !samples.length) throw new Error("Kokoro 没有生成可播放的音频。");
    const wav = kokoroWave(samples);
    worker.postMessage({ id: request.id, wav }, [wav]);
  } catch (reason) {
    worker.postMessage({ id: request.id, error: reason instanceof Error ? reason.message : String(reason) });
  }
}

worker.onmessage = ({ data }) => { work = work.then(() => reply(data)); };
