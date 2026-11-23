// 2026-11-19：检查 Windows 发布输出的内置题库、词表、许可与 NSIS 文件指纹。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const assetsOnly = process.argv[2] === "--assets-only";
const config = JSON.parse(await readFile(new URL("src-tauri/tauri.conf.json", root), "utf8"));
// 2026-11-21：以相同结构验证开发数据和发布数据中的阅读与词汇文件。
const data = new URL(assetsOnly ? "data/" : "dist/data/", root);
const assets = new URL("reading/", data);
const vocabulary = new URL("vocabulary/", data);
const json = async (relative) => JSON.parse(await readFile(new URL(relative, assets), "utf8"));
const index = await json("index.json");
assert.equal(index.schemaVersion, "IETLS4PASSBankV1");
assert.equal(index.entries.length, 239);
let explanations = 0;
for (const { examId, hasExplanation } of index.entries) {
  const asset = await json(`reading/${examId}.json`);
  assert.equal(asset.exam.examId, examId);
  assert.equal(Boolean(asset.explanation), hasExplanation, examId);
  explanations += Number(hasExplanation);
}
assert.equal(explanations, 238);
// 2026-11-21：验证词表和阅读词典来自独立的词汇目录。
const wordJson = async (relative) => JSON.parse(await readFile(new URL(relative, vocabulary), "utf8"));
const words = await wordJson("ielts_core.json");
assert.ok(Array.isArray(words) && words.length > 0, "ielts_core");
const dictionary = await wordJson("ecdict.json");
assert.equal(Object.keys(dictionary.entries).length, 20_229);
assert.match(await readFile(new URL("ECDICT_LICENSE.txt", vocabulary), "utf8"), /MIT License/i);
assert.match(await readFile(new URL(config.bundle.licenseFile, new URL("src-tauri/", root)), "utf8"), /GENERAL PUBLIC LICENSE/);
const images = await readdir(new URL("media/", assets));
assert.equal(images.length, 4);
console.log(`阅读 ${index.entries.length} 篇，解析 ${explanations} 份，题图 ${images.length} 张，ECDICT ${Object.keys(dictionary.entries).length} 项。`);

if (!assetsOnly) {
  assert.ok((await stat(new URL("dist/index.html", root))).size > 0);
  const directory = new URL("src-tauri/target/release/bundle/nsis/", root);
  const installers = (await readdir(directory)).filter((name) => name.endsWith("-setup.exe") && name.includes(`_${config.version}_`));
  assert.ok(installers.length, `找不到 ${config.version} 的 NSIS 安装程序。`);
  for (const name of installers) {
    const file = new URL(name, directory);
    const hash = createHash("sha256");
    for await (const part of createReadStream(file)) hash.update(part);
    console.log(`${name}  ${(await stat(file)).size} bytes  SHA-256 ${hash.digest("hex")}`);
  }
}
