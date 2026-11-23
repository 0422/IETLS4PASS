// 2026-11-19：沿用 Della CRM 的 Vite、React 和 Tailwind 配置模式，使用独立开发端口。
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// 2026-11-21：开发和正式构建共用 data 中的静态阅读与词汇资源。
// 2026-11-23：发布时允许仓库中没有用户自备资源。
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
// 2026-11-21：从已锁定的运行库解析 Kokoro 的 WASM 文件。
import { createRequire } from "node:module";
import type { IncomingMessage, ServerResponse } from "node:http";
// 2026-11-21：发布 Kokoro 所需的本地运行库和模型文件。
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const dataRoot = fileURLToPath(new URL("./data/", import.meta.url));
const bundledFolders = ["reading", "vocabulary"];
const contentTypes: Record<string, string> = {
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".avif": "image/avif",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
};

function studyData(): Plugin {
  return {
    name: "ietls4pass-study-data",
    configureServer(server) {
      server.middlewares.use("/data", async (request: IncomingMessage, response: ServerResponse) => {
        // 2026-11-21：开发服务只通过此路由提供阅读和词汇静态文件。
        const missing = () => { response.statusCode = 404; response.end(); };
        if (request.method !== "GET" && request.method !== "HEAD") return missing();
        try {
          const pathname = decodeURIComponent((request.url ?? "").split("?", 1)[0]);
          const [folder, ...segments] = pathname.replace(/^\//, "").split("/");
          if (!bundledFolders.includes(folder) || !segments.length || segments.some((part) => !part || part === "." || part === ".." || /[\\:\0]/.test(part))) return missing();
          const base = await realpath(join(dataRoot, folder));
          const file = await realpath(join(base, ...segments));
          const type = contentTypes[extname(file).toLowerCase()];
          const info = await stat(file);
          if (!file.startsWith(base + sep) || !type || !info.isFile()) return missing();
          response.setHeader("Content-Type", type);
          response.setHeader("Cache-Control", "no-cache");
          response.setHeader("Content-Length", info.size);
          if (request.method === "HEAD") return response.end();
          createReadStream(file).on("error", () => response.destroy()).pipe(response);
        } catch {
          missing();
        }
      });
    },
    generateBundle() {
      const emitDirectory = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const file = join(directory, entry.name);
          if (entry.isDirectory()) emitDirectory(file);
          else if (entry.isFile() && Object.hasOwn(contentTypes, extname(file).toLowerCase())) {
            const name = relative(dataRoot, file).split(sep).join("/");
            this.emitFile({ type: "asset", fileName: `data/${name}`, source: readFileSync(file) });
          }
        }
      };
      // 2026-11-23：只把实际准备好的默认阅读和词汇目录打包。
      for (const folder of bundledFolders) {
        const directory = join(dataRoot, folder);
        if (existsSync(directory)) emitDirectory(directory);
      }
    },
  };
}

// 2026-11-21：开发和打包只发布 Kokoro 推理所需的同源资源。
function kokoroAssets(): Plugin {
  // 2026-11-23：默认模型和音色也由项目 data 文件夹提供。
  const root = fileURLToPath(new URL("./data/models/kokoro/", import.meta.url));
  const require = createRequire(import.meta.url);
  const modelFiles = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx",
    "voices/bf_emma.bin", "voices/bm_george.bin"];
  const runtimeFiles = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];
  const model = new Map(modelFiles.map((name) => [name, join(root, name)]));
  const assets = () => {
    const runtime = dirname(require.resolve("onnxruntime-web"));
    return new Map([...model, ...runtimeFiles.map((file): [string, string] => [`runtime/${file}`, join(runtime, file)])]);
  };
  return {
    name: "ietls4pass-kokoro",
    configureServer(server) {
      const files = assets();
      server.middlewares.use("/tts/kokoro", async (request, response) => {
        const path = files.get((request.url ?? "").split("?")[0].replace(/^\//, ""));
        if (!path || (request.method !== "GET" && request.method !== "HEAD")) {
          response.statusCode = 404;
          return response.end();
        }
        try {
          const file = await stat(path);
          const extension = extname(path);
          response.setHeader("Content-Type", contentTypes[extension] ?? (
            extension === ".wasm" ? "application/wasm" : extension === ".mjs" ? "text/javascript" : "application/octet-stream"));
          response.setHeader("Content-Length", file.size);
          if (request.method === "HEAD") return response.end();
          createReadStream(path).on("error", () => response.destroy()).pipe(response);
        } catch {
          response.statusCode = 404;
          response.end();
        }
      });
    },
    generateBundle() {
      // 2026-11-23：允许不捆绑模型，但保留加载外置 Kokoro 所需的运行时。
      const bundleModel = [...model.values()].every((path) => existsSync(path));
      for (const [name, path] of assets()) {
        if (!bundleModel && model.has(name)) continue;
        this.emitFile({ type: "asset", fileName: `tts/kokoro/${name}`, source: readFileSync(path) });
      }
    },
  };
}

export default defineConfig({
  // 2026-11-21：静态题库从统一数据目录部署。
  // 2026-11-21：将 Kokoro 模型和运行时打包为本地资源。
  plugins: [react(), tailwindcss(), studyData(), kokoroAssets()],
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1422, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  // 2026-11-21：Kokoro 线程以 ES 模块加载同源 WASM 运行库。
  worker: { format: "es" },
  build: { target: "chrome105" },
});
