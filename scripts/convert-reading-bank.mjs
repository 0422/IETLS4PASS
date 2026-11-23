// 2026-11-19：把上游题库注册脚本中的 JSON 转成静态资源，保留题目、解析、别名和配图。
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("..", import.meta.url));
const source = resolve(process.argv[2] ?? resolve(project, "IELTS-practice-main"));
const generated = resolve(source, "assets", "generated");
const examRoot = resolve(generated, "reading-exams");
// 2026-11-21：转换后的阅读和词表按应用的数据目录存放。
const output = resolve(project, "data", "reading");
const examIdPattern = /^p[123]-[a-z]+-\d+$/;

function jsonBlock(text, pattern, description) {
  const body = text.match(pattern)?.[1];
  if (!body) throw new Error(`找不到 ${description} 的 JSON 内容`);
  return JSON.parse(body);
}

async function readRegistration(file, id) {
  const text = await readFile(file, "utf8");
  const match = text.match(/\.register\(\s*"([^"]+)"\s*,\s*(\{[\s\S]+\})\s*\);/);
  if (!match || match[1] !== id) throw new Error(`资源登记标识不一致 ${file}`);
  const payload = JSON.parse(match[2]);
  if (payload.examId !== id) throw new Error(`资源内容标识不一致 ${file}`);
  return payload;
}

// 2026-11-21：允许核心词表写入独立的词汇目录。
async function writeJson(file, value, directory = output) {
  const target = resolve(directory, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value)}\n`, "utf8");
}

const examManifest = await readFile(resolve(examRoot, "manifest.js"), "utf8");
const exams = jsonBlock(examManifest, /const manifest = (\{[\s\S]*?\n\s*\});/, "阅读题库");
const aliases = jsonBlock(examManifest, /const RETIRED_EXAM_IDS = (\{[\s\S]*?\n\s*\});/, "阅读题目标识别名");
const explanationManifest = await readFile(resolve(generated, "reading-explanations", "manifest.js"), "utf8");
const explanations = jsonBlock(explanationManifest, /__READING_EXPLANATION_MANIFEST__ = (\{[\s\S]*?\n\s*\});/, "阅读解析");

const payloads = [];
const media = new Set();
for (const [id, item] of Object.entries(exams)) {
  if (!examIdPattern.test(id) || item.examId !== id || item.script !== `./${id}.js`) {
    throw new Error(`不支持的题目登记 ${id}`);
  }
  const exam = await readRegistration(resolve(examRoot, `${id}.js`), id);
  if (!Array.isArray(exam.passage?.blocks) || !Array.isArray(exam.questionOrder) || !exam.answerKey) {
    throw new Error(`题目缺少阅读结构 ${id}`);
  }
  const explanation = Object.hasOwn(explanations, id)
    ? await readRegistration(resolve(generated, "reading-explanations", `${id}.js`), id)
    : null;
  const sourceHtml = [
    ...exam.passage.blocks.map((block) => block.html),
    ...exam.questionGroups.flatMap((group) => [group.leadHtml, group.bodyHtml]),
  ].join("\n");
  for (const match of sourceHtml.matchAll(/\bsrc\s*=\s*["'](media\/[\w.-]+)["']/gi)) {
    media.add(match[1]);
  }
  payloads.push({
    item: { ...item, hasExplanation: Boolean(explanation) },
    exam,
    explanation,
  });
}
if (!payloads.length) throw new Error("阅读题库为空");
for (const relative of media) {
  const target = resolve(output, relative);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(examRoot, relative), target);
}
for (const { item, exam, explanation } of payloads) {
  await writeJson(`reading/${item.examId}.json`, { exam, explanation });
}
// 2026-11-19：题库转换只复制 IELTS 核心词表。
const words = JSON.parse(await readFile(resolve(source, "assets", "wordlists", "ielts_core.json"), "utf8"));
// 2026-11-21：核心词表由词汇模块的独立目录提供。
await writeJson("ielts_core.json", words, resolve(project, "data", "vocabulary"));
await writeJson("index.json", {
  schemaVersion: "IETLS4PASSBankV1",
  source: "sallowayma-git/IELTS-practice",
  aliases,
  entries: payloads.map(({ item }) => item),
});
// 2026-11-19：输出实际转换的词表名称。
console.log(`已转换 ${payloads.length} 篇阅读、${payloads.filter((entry) => entry.explanation).length} 份解析、${media.size} 张题图和 IELTS 核心词表。`);
