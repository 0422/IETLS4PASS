// 2026-11-19：提取上游 ECDICT 词条与 MIT 许可，保留原英语释义、词形和音标。
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("..", import.meta.url));
const source = resolve(process.argv[2] ?? resolve(project, "IELTS-practice-main"), "assets/wordlists");
// 2026-11-21：转换词典及许可统一放在词汇数据目录。
const target = resolve(project, "data/vocabulary");
const input = await readFile(resolve(source, "ecdict_reading.bundle.js"), "utf8");
const data = input.match(/dictionaries\.ecdict\s*=\s*\{\s*source:\s*(\{.*?\}),\s*entries:\s*(\[.*\])\s*\};/);
if (!data) throw new Error("无法识别上游 ECDICT 登记格式。");
const rows = JSON.parse(data[2]);
const entries = Object.fromEntries(rows.map((row) => [row.w, row]));
await mkdir(target, { recursive: true });
await writeFile(resolve(target, "ecdict.json"), JSON.stringify({ source: JSON.parse(data[1]), entries }) + "\n");
await copyFile(resolve(source, "ECDICT_LICENSE.txt"), resolve(target, "ECDICT_LICENSE.txt"));
console.log(`已转换 ${Object.keys(entries).length} 项 ECDICT 阅读词汇。`);
