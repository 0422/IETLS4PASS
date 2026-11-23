<!-- 2026-11-19：记录工程文件新增原因和标准 JSON 配置的变更。 -->
# 迁移修改说明

## 2026-11-19

- `package.json`、`pnpm-lock.yaml`、`tsconfig.json` 和 `vite.config.ts` 建立独立的前端入口。沿用 Della CRM 的前端依赖锁定版本，开发端口使用 1422。
- `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、构建脚本及图标建立 Windows Tauri 应用。应用标识为 `dev.ietls4pass.desktop`，数据库文件为 `ietls4pass.db`。
- `src-tauri/capabilities/main.json` 将核心权限限定到主窗口。桌面配置区分开发与发布的内容安全策略，开发模式允许 Vite 本机热更新。图标为本项目生成的书本图案。
- `src-tauri/migrations/001_practice.sql` 和 Rust 命令保存成绩、草稿、设置和词汇状态，并在事务中处理备份及恢复。
- `scripts/convert-reading-bank.mjs` 将上游阅读资源和词表转换成 `public/banks/main/` 下的 JSON，保留原始资源内容和可追溯标识。
- `src/` 以 React 和 HashRouter 重建桌面工作区，移植 TypeScript 阅读评分、练习表单、题库浏览、记录、总览和设置。

## 第二轮 · 2026-11-19

- `src-tauri/migrations/002_reading_writers.sql` 与 `src-tauri/src/store/reading.rs` 增加草稿写者校验、冻结提交、中断事务和文章复习更新。数据库保留第一轮表结构与已有用户数据。
- 阅读工作区新增题目和题组关联前台时长、暂停恢复、题目标记、原文高亮、笔记与回放。有可靠评分的新练习可生成文章复习计划。
- 套题增加频率抽题、经典及驻足推进、共享倒计时、提前结束和用户可选的超时自动结束。
- 用户已通过第一轮依赖安装和桌面启动。第二轮编译和业务验收由用户进行。

## 第三轮 · 2026-11-19

- 增加 SQLite 第 3 版目录绑定和 Rust 原生选目录、打开 PDF 的调用。沿用 Della CRM 的 dialog 2.8.4 和 opener 2.7.3。
- 新增原版阅读、听力索引与本地媒体加载，兼容可辨识的静态旧 HTML 题源。已转换索引和原版使用说明见 `folderBanks.ts`、`bankSource.ts` 及上游 `libraryDiscovery.js`、`listeningRecordBridge.js`。
- 阅读模拟可跨篇保持草稿，最后统一提交。组合听力按原版 `practice-page-enhancer.js` 的常用容器识别子套题，成绩按父子记录保存。
- 移植 ECDICT、词汇轮内复习、完整练习成就规则、重点阅读进度和错题雷达。核对上游 `vocabSessionView.js`、`achievementManager.js` 和 `legacyViewBundle.js`。
- 用 CSS 重建 Melody、Academic 和 XiaoDai 动态背景，原有颜色主题仍可独立选择。

## 第四轮 · 2026-11-19

- `004_backup_diagnostics.sql` 增加回退点、诊断配置和事件表，SQLite 升级至版本 4。`store/backup.rs` 处理 SHA-256、恢复预览、合并及覆盖事务。
- `legacyWorkspace.ts` 和 `legacyImport.ts` 依据原版数据核的校验规则导入 v2 快照，继续支持 v1 成绩文件。支持迁移可确认的阅读草稿、作答与批注、词汇状态、复习计划和成就，同时保留原版学习资料字段。
- 设置页新增恢复与诊断入口。目录题库可在原生选择器中重新绑定到备份中的原 ID。诊断使用固定操作和结果，支持设置、清理及本机导出。
- `tauri.conf.json` 配置当前用户 NSIS、中英文和 WebView2 下载引导，复用项目许可。`Cargo.toml` 和 `Cargo.lock` 复用编译依赖已锁定的 SHA-256 版本。`verify-release.mjs` 检查发布目录中的默认资源并输出安装程序指纹。
