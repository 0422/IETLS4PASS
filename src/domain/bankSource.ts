// 2026-11-19：解析上游登记数据与本地 HTML 题源，识别媒体和独立听力套题。
import type { Answer, Answers, Category, ExamEntry, ReadingExam, ReadingGroup } from "./types";
// 2026-11-19：听力扫描按剑雅 Section 文件名识别分节。
import { cambridgeIdentity, listeningScene } from "./listening";
// 2026-11-20：导出目录登记标题和题面状态，精听原文随本节打开。
import { parseListeningExport } from "./listeningExport";

export type LocalEntry = {
  examId: string;
  title: string;
  category: Category | "P4";
  frequency?: string;
  // 2026-11-19：听力目录可登记结构化 JSON 和仅带音频的静听资料。
  kind: "generated" | "converted" | "html" | "pdf" | "listening-json" | "audio";
  scene?: string;
  file?: string;
  explanation?: string;
  pdf?: string;
  audio?: string;
  // 2026-11-20：精听导出可能只有录音和原文，题面及答案需独立判断。
  exportedListening?: { hasQuestions: boolean; hasAnswers: boolean };
};

export interface FolderCatalog {
  title: string;
  folderId: string;
  entries: LocalEntry[];
  files: string[];
  aliases?: Record<string, string>;
  // 2026-11-19：文件目录索引记录最近成功扫描的版本。
  revision?: string;
}

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const stem = (path: string) => baseName(path).replace(/\.[^.]+$/, "");
const isHtml = (path: string) => /\.html?$/i.test(path);
const isPdf = (path: string) => /\.pdf$/i.test(path);
const audioPattern = /\.(mp3|m4a|wav|ogg|aac|flac|mp4)$/i;

export function safeRelative(value: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(value.replace(/\\/g, "/")); } catch { return undefined; }
  if (/^(?:\/|[\w+.-]+:)/.test(decoded) || /[\x00-\x1f?#:]/.test(decoded)) return undefined;
  const parts: string[] = [];
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(segment);
  }
  return parts.length ? parts.join("/") : undefined;
}

export function findResource(files: string[], hint?: string, directory = "") {
  if (!hint) return undefined;
  const paths = [directory ? safeRelative(`${directory}/${hint}`) : undefined, safeRelative(hint)];
  for (const path of paths) {
    if (!path) continue;
    const exact = files.find((file) => file.toLowerCase() === path.toLowerCase());
    if (exact) return exact;
    const suffix = files.filter((file) => file.toLowerCase().endsWith(`/${path.toLowerCase()}`));
    if (suffix.length === 1) return suffix[0];
  }
  const base = baseName(hint.replace(/\\/g, "/")).toLowerCase();
  const names = files.filter((file) => baseName(file).toLowerCase() === base);
  return names.length === 1 ? names[0] : undefined;
}

function scanContainer(text: string, start: number) {
  if (start < 0 || !/[{\[]/.test(text[start])) return undefined;
  const stack: string[] = [];
  let quote = "";
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
    else if (char === "}" || char === "]") {
      if (stack.pop() !== char) return undefined;
      if (!stack.length) return text.slice(start, index + 1);
    }
  }
}

export function registeredJson<T>(text: string, marker: RegExp): T {
  const match = marker.exec(text);
  const start = match ? text.indexOf(match[1], match.index + match[0].length - 1) : -1;
  const body = scanContainer(text, start);
  if (!body) throw new Error("找不到可读取的题库登记数据。");
  return JSON.parse(body) as T;
}

function category(path: string): LocalEntry["category"] | undefined {
  // 2026-11-19：原版和用户自备目录可使用 P1、Part 1 或 Passage 1 命名。
  const value = path.match(/(?:^|[ /_\-[(])(?:p|part|passage)[ _-]?([1-4])(?=[^0-9]|$)/i)?.[1];
  return value ? `P${value}` as LocalEntry["category"] : undefined;
}

export function associatedFile(files: string[], source: string, pattern: RegExp) {
  const candidates = files.filter((file) => parent(file).toLowerCase() === parent(source).toLowerCase() && pattern.test(file));
  return candidates.find((file) => stem(file).toLowerCase() === stem(source).toLowerCase())
    ?? candidates.find((file) => /^audio\./i.test(baseName(file))) ?? (candidates.length === 1 ? candidates[0] : undefined);
}

type LegacyEntry = Partial<ExamEntry> & {
  id?: string;
  title?: string;
  category?: string;
  script?: string;
  filename?: string;
  pdfFilename?: string;
  audioFilename?: string;
  sourcePath?: string;
  path?: string;
  scene?: string;
};

export function sourceEntries(manifest: Record<string, LegacyEntry> | LegacyEntry[], files: string[], directory: string, kind: "reading" | "listening") {
  const entries = Object.entries(manifest).flatMap(([key, item]): LocalEntry[] => {
    if (!item || typeof item !== "object") return [];
    const examId = item.examId ?? item.id ?? key;
    const title = item.title ?? item.filename ?? examId;
    // 2026-11-19：命名明确的 Section 比笼统的目录分篇更具体。
    const section = kind === "listening" ? cambridgeIdentity(item.filename ?? "")?.section ?? cambridgeIdentity(title)?.section : undefined;
    const part = section ? `P${section}` as LocalEntry["category"] : category(item.category ?? "") ?? category(item.path ?? "") ?? category(title);
    if (!/^[\w.-]{1,120}$/.test(examId) || !part || (kind === "reading" && part === "P4")) return [];
    const sourceHint = item.sourcePath || (item.filename ? `${item.path ?? ""}/${item.filename}`.replace(/^\/+/, "") : "");
    const file = findResource(files, item.script?.replace(/^\.\//, ""), directory) ?? findResource(files, sourceHint);
    const pdf = findResource(files, item.pdfFilename, file ? parent(file) : item.path ?? "");
    const audio = findResource(files, item.audioFilename, file ? parent(file) : item.path ?? "")
      ?? (file && associatedFile(files, file, audioPattern));
    if (!file && !pdf && !audio) return [];
    // 2026-11-19：索引记录中的场景和 JSON 题源交由听力工作区使用。
    return [{ examId, title, category: part, frequency: item.frequency, scene: item.scene,
      kind: file?.toLowerCase().endsWith(".json") && kind === "listening" ? "listening-json"
        : item.script ? "generated" : file ? "html" : "pdf", file, pdf, audio }];
  });
  return entries;
}

async function pathId(path: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path.toLowerCase()));
  return [...new Uint8Array(hash)].slice(0, 14).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// 2026-11-20：匹配导出的剑雅书号、Test 和 Section，无需改写原文件名或依赖总索引。
export async function discoverListeningExports(files: string[], rootLabel: string, read: (file: string) => Promise<string>) {
  const paths = new Map(files.map((file) => [file.toLowerCase(), file]));
  const entries = await Promise.all(files.map(async (file): Promise<LocalEntry | undefined> => {
    const match = /(?:^|\/)(剑雅\s*\d{1,3})\/Test[ _-]*(\d{1,2})\/(Test[ _-]*\d{1,2}[_ -]+Section[ _-]*[1-4])\.json$/i.exec(`${rootLabel}/${file}`);
    if (!match) return undefined;
    const label = `${match[1]} ${match[3]}`;
    const expected = cambridgeIdentity(label);
    if (!expected?.section || expected.test !== Number(match[2])) return undefined;
    try {
      const source = parseListeningExport(JSON.parse((await read(file)).replace(/^\uFEFF/, "")), label);
      if (!source) return undefined;
      const name = baseName(source.audioFile);
      const matchingAudio = name && audioPattern.test(name)
        ? paths.get(`${parent(file) ? `${parent(file)}/` : ""}${name}`.toLowerCase()) : undefined;
      const audio = matchingAudio ?? paths.get(file.replace(/\.json$/i, ".mp3").toLowerCase());
      const title = `剑雅${expected.book} Test ${expected.test}-Section ${expected.section}`;
      return { examId: `local-${await pathId(file)}`, title: source.subtitle ? `${title} ${source.subtitle}` : title,
        category: `P${expected.section}` as LocalEntry["category"], kind: "listening-json", file, audio,
        scene: listeningScene(parent(file), rootLabel),
        exportedListening: { hasQuestions: Boolean(source.part || source.questionText || source.questionBlocks.length), hasAnswers: source.hasAnswers } };
    } catch {
      // 单份资料读错时保留同目录其他可用条目。
      return undefined;
    }
  }));
  return entries.filter((entry): entry is LocalEntry => entry !== undefined);
}

export async function discoverEntries(files: string[], kind: "reading" | "listening", rootLabel = "") {
  // 2026-11-19：听力从同目录、同名的 JSON、HTML、PDF 和音频合并一个 Section。
  if (kind === "listening") return discoverListeningSections(files, rootLabel);
  // 2026-11-19：听力已走独立扫描，阅读保留原来目录选择行为。
  const published = files.some((file) => /(^|\/)ReadingPractice\//i.test(file));
  const pool = published ? files.filter((file) => /(^|\/)ReadingPractice\//i.test(file)) : files;
  const inferPart = (file: string) => category(file) ?? category(rootLabel);
  const htmls = pool.filter((file) => isHtml(file) && inferPart(file) && !/(?:unified|explanation|解析)\.html?$/i.test(file));
  const pdfs = new Set(htmls.flatMap((file) => associatedFile(pool, file, /\.pdf$/i) ?? []));
  const candidates = [...htmls, ...pool.filter((file) => isPdf(file) && inferPart(file) && !pdfs.has(file))];
  return Promise.all(candidates.map(async (file): Promise<LocalEntry | undefined> => {
    const part = inferPart(file);
    if (!part || part === "P4") return undefined;
    return {
      examId: `local-${await pathId(file)}`, title: stem(file), category: part,
      kind: isPdf(file) ? "pdf" : "html", file: isPdf(file) ? undefined : file,
      pdf: isPdf(file) ? file : associatedFile(pool, file, /\.pdf$/i),
      frequency: file.match(/超高频|次高频|高频|中频|低频/)?.[0],
    };
  })).then((entries) => entries.filter((entry) => entry !== undefined));
}

// 2026-11-19：支持形如「租房/剑雅16 Test 4-Section 1.json」的目录结构。
async function discoverListeningSections(files: string[], rootLabel: string) {
  const sections = new Map<string, { category: LocalEntry["category"]; json?: string; html?: string; pdf?: string; audio?: string }>();
  const published = files.some((file) => /(^|\/)ListeningPractice\//i.test(file));
  const pool = published ? files.filter((file) => /(^|\/)ListeningPractice\//i.test(file)) : files;
  for (const file of pool) {
    const identity = cambridgeIdentity(baseName(file));
    const part = identity?.section ? `P${identity.section}` as LocalEntry["category"] : category(file) ?? category(rootLabel);
    if (!part) continue;
    const type = isHtml(file) && !/(?:unified|explanation|解析)\.html?$/i.test(file) ? "html"
      : isPdf(file) ? "pdf" : /\.json$/i.test(file) && identity?.section ? "json" : audioPattern.test(file) ? "audio" : undefined;
    if (!type) continue;
    const key = `${parent(file)}/${stem(file)}`.toLowerCase();
    const group = sections.get(key) ?? { category: part };
    group[type] ??= file;
    sections.set(key, group);
  }
  const groups = [...sections.values()];
  const usedAudio = new Set(groups.flatMap((group) => {
    const file = group.json ?? group.html ?? group.pdf;
    return file ? group.audio ?? associatedFile(pool, file, audioPattern) ?? [] : [];
  }));
  const usedPdfs = new Set(groups.flatMap((group) => {
    const file = group.json ?? group.html;
    return file ? group.pdf ?? associatedFile(pool, file, /\.pdf$/i) ?? [] : [];
  }));
  return Promise.all(groups.flatMap((group): Promise<LocalEntry>[] => {
    const file = group.json ?? group.html;
    const main = file ?? group.pdf ?? group.audio;
    if (!main || (!file && (group.pdf ? usedPdfs.has(main) : usedAudio.has(main)))) return [];
    const scene = listeningScene(parent(main), rootLabel);
    return [(async () => ({
      examId: `local-${await pathId(group.html ?? main)}`, title: stem(main), category: group.category,
      // 2026-11-19：目录未标明场景时直接保留为空。
      scene,
      kind: group.json ? "listening-json" : group.html ? "html" : group.pdf ? "pdf" : "audio",
      file, pdf: group.pdf ?? (file ? associatedFile(pool, file, /\.pdf$/i) : undefined), audio: group.audio ?? associatedFile(pool, main, audioPattern),
    }))()];
  }));
}

function questionIdentity(source: string | null | undefined) {
  // 2026-11-19：原版组合题允许套题前缀及同一组答案控件使用联合题号。
  const match = source?.split("::").at(-1)?.match(/^(?:question[_-]?|q[_-]?)?(\d+)(?:[_-](?:input|answer|\d+))*$/i);
  return match ? `q${Number(match[1])}` : undefined;
}

function literalAnswers(script: string, suiteId?: string) {
  const values: Answers = {};
  for (const match of script.matchAll(/\b(?:correctAnswers|answer_?key|answerMap|answers|suiteAnswers)\s*(?::|=)\s*(\{)/gi)) {
    let source = scanContainer(script, match.index + match[0].length - 1);
    if (!source) continue;
    let isolated = false;
    if (suiteId && /^[\w.-]+$/.test(suiteId)) {
      const escaped = suiteId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nested = new RegExp(`[,{]\\s*["']?${escaped}["']?\\s*:\\s*\\{`).exec(source);
      if (nested) {
        const section = scanContainer(source, nested.index + nested[0].length - 1);
        if (section) { source = section; isolated = true; }
      }
    }
    const stringLiteral = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/;
    const pair = new RegExp(`(?:[{,]\\s*)["']?((?:[\\w.-]+::)?(?:q(?:uestion)?[_-]?)?\\d+(?:[_-]\\d+)*)["']?\\s*:\\s*(${stringLiteral.source}|\\[[^\\[\\]{}]*\\])(?=\\s*[,}])`, "gi");
    for (const [, key, raw] of source.matchAll(pair)) {
      const prefixed = key.includes("::");
      if (suiteId && !isolated && (!prefixed || key.split("::")[0] !== suiteId)) continue;
      if (!suiteId && prefixed) continue;
      const id = questionIdentity(key);
      const readString = (literal: string) => {
        if (literal.startsWith('"')) { try { return JSON.parse(literal) as string; } catch { return ""; } }
        return literal.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      };
      const value: Answer = raw.startsWith("[")
        ? [...raw.matchAll(new RegExp(stringLiteral.source, "g"))].map(([literal]) => readString(literal)).filter(Boolean)
        : readString(raw);
      if (id && value.length) values[id] = value;
    }
  }
  return values;
}

export function localImageRefs(html: string, files: string[], directory: string, media: Record<string, string>) {
  if (!/<img\b/i.test(html)) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const image of template.content.querySelectorAll("img")) {
    const source = image.getAttribute("src") ?? "";
    if (/^\s*(?:[\w+.-]+:|\/\/)/.test(source)) { image.removeAttribute("src"); continue; }
    const path = findResource(files, source, directory);
    if (!path || !/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(path)) { image.removeAttribute("src"); continue; }
    const placeholder = Object.keys(media).find((key) => media[key] === path) ?? `media/local-${Object.keys(media).length}`;
    media[placeholder] = path;
    image.setAttribute("src", placeholder);
  }
  return template.innerHTML;
}

export function legacyHtmlPapers(html: string, entry: LocalEntry, files: string[], kind: "reading" | "listening") {
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  const scripts = [...root.querySelectorAll("script")].map((script) => script.textContent ?? "");
  // 2026-11-19：只传脚本文本，避免数组下标被误当成套题标识。
  const globalAnswers = Object.assign({} as Answers, ...scripts.map((script) => literalAnswers(script)));
  const title = root.querySelector("title, h1")?.textContent?.trim() || entry.title;
  // 2026-11-19：跟随原版 enhancer 读取组合题源的常见容器。
  const selector = "[data-suite-id], .suite, .suite-container, .test-page, .practice-test, .test-set";
  const independently = [...root.querySelectorAll<HTMLElement>(selector)].filter((group) =>
    group.querySelector("input[name], select[name], textarea[name]") && !group.parentElement?.closest(selector));
  const scopes: (DocumentFragment | HTMLElement)[] = kind === "listening" && independently.length > 1 ? independently : [root];
  const media: Record<string, string> = {};
  const directory = parent(entry.file ?? "");
  const papers = scopes.map((scope, index) => {
    const sectionTitle = scopes.length > 1 ? scope.querySelector("h2,h3,h4,legend")?.textContent?.trim() || `第 ${index + 1} 套` : title;
    const suite = scope instanceof HTMLElement ? scope.dataset.suiteId || scope.id || `set${index + 1}` : undefined;
    const keys = scopes.length === 1 ? { ...globalAnswers } : Object.assign({} as Answers, ...scripts.map((script) => literalAnswers(script, suite)));
    const groupScripts = [...scope.querySelectorAll("script")].map((script) => script.textContent ?? "");
    // 2026-11-19：套题内部脚本按文本读取。
    Object.assign(keys, ...groupScripts.map((script) => literalAnswers(script)));
    const ids = new Set<string>();
    const multi = new Set<string>();
    for (const control of scope.querySelectorAll("input,select,textarea")) {
      const id = questionIdentity(control.getAttribute("name")) ?? questionIdentity(control.getAttribute("data-q"))
        ?? questionIdentity(control.getAttribute("id"));
      if (!id) continue;
      const type = control.getAttribute("type") ?? "text";
      if (!["text", "radio", "checkbox", "search"].includes(type)) continue;
      ids.add(id);
      if (type === "checkbox") multi.add(id);
      control.setAttribute("name", id);
      const marked = control.getAttribute("data-answer")?.trim();
      if (marked && (type !== "radio" && type !== "checkbox")) keys[id] = marked;
      if ((control.hasAttribute("data-correct") && control.getAttribute("data-correct") !== "false")
        || marked?.toLowerCase() === "true" && (type === "radio" || type === "checkbox")) {
        const value = control.getAttribute("value");
        if (value && type === "radio") keys[id] = value;
        const previous = keys[id];
        if (value && type === "checkbox") keys[id] = [...new Set([...(Array.isArray(previous) ? previous : []), value])];
      }
    }
    scope.querySelectorAll("script,style,link,iframe,button").forEach((element) => element.remove());
    const article = kind === "reading" ? scope.querySelector<HTMLElement>("article, .passage, #passage, .reading-passage, #left") : undefined;
    const passageHtml = article?.innerHTML ?? "";
    article?.remove();
    const body = document.createElement("div");
    body.append(scope.cloneNode(true));
    const content = localImageRefs(body.innerHTML, files, directory, media);
    const questionOrder = [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const graded = questionOrder.length > 0 && questionOrder.every((id) => Object.hasOwn(keys, id));
    const group: ReadingGroup = { groupId: "legacy", kind: "other", questionIds: questionOrder, bodyHtml: content };
    const exam: ReadingExam = {
      examId: scopes.length > 1 ? `${entry.examId}-${index + 1}` : entry.examId,
      meta: { title: sectionTitle, category: entry.category === "P4" ? "P3" : entry.category },
      passage: { blocks: [{ blockId: "source-passage", kind: "html", html: localImageRefs(passageHtml, files, directory, media) }] },
      questionGroups: [group], questionOrder, answerKey: keys,
      scoringGroups: [...multi].map((id) => ({
        groupId: `checkbox-${id}`, kind: kind === "listening" ? "listening-set" : "multi_choice",
        questionIds: [id], bodyHtml: '<input type="checkbox">',
      })),
    };
    return { exam, graded };
  });
  const audioSource = root.querySelector("audio[src], audio source[src]")?.getAttribute("src") ?? undefined;
  return { papers, media, audio: entry.audio ?? findResource(files, audioSource, directory) };
}
