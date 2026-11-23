<!-- 2026-11-18：整理 IELTS-practice 技术栈迁移分析、实施边界和用户规则，供 IETLS4PASS 新会话接续。 -->
# IETLS4PASS 迁移分析与实施交接

编写日期：2026-11-18。本文是迁移前的交接方案，尚未开始创建应用或迁移代码。

## 1. 用户目标与当前状态

用户希望将开源项目 <https://github.com/sallowayma-git/IELTS-practice> 迁移到与 Della CRM 相同的技术栈，在 `E:\workspace\IETLS4PASS` 下建立独立项目。

目录名称严格使用用户给出的 `IETLS4PASS`，不要自行改成 `IELTS4PASS`。技术栈参考项目位于 `E:\workspace\DellaCRM`。

当前已经完成的工作：

- 查看原项目说明、入口、打包脚本和部分数据注册实现，分析技术栈与迁移工作。
- 读取 Della CRM 的实际依赖配置、Tauri 配置、React 入口、部分路由和 SQLite 调用实现。
- 在 2026-11-18 检查时，`E:\workspace\IETLS4PASS` 已存在且为空，未发现该目录自己的 `AGENTS.md`。
- 用户本轮明确授权整理迁移交接文档，打算在目标目录重新打开会话后开始迁移。

当前尚未完成的工作：下载完整上游源码、确定上游提交、安装依赖、创建新应用、转换题库、迁移历史数据、运行检查或编译。

本文中的功能清单主要依据上游 README；不是逐项运行后的验收结论。部分源码未能通过网页完整取得，新会话应在克隆后核对实际实现。不要把本文中的候选目录、数据表或命令名当成已经存在的实现。

本文最初生成于 Della CRM 工作区，因为当时会话仅有该目录的写入权限。将本文复制到 `E:\workspace\IETLS4PASS\IETLS4PASS-MIGRATION.md` 后，新会话从目标目录读取即可。

## 2. 必须延续的用户规则

1. 读取、查找、搜索等只读操作不需要逐次确认，但需要告知用户读取了哪些文件。
2. 新建、编辑、删除文件等写操作必须先得到用户确认。用户对明确任务范围的确认持续有效，不要对已获授权的同一范围反复询问。
3. 需要删除或替换的代码先注释保留，不直接删除。
4. 新增代码前加注释说明“日期 + 本次修改原因”，使用实际修改当天的日期。
5. 标准 JSON 不支持注释，应保持合法 JSON，将新增或修改原因记入对应的修改说明文档；先向用户说明这种记录方式。
6. 修改后不要自行编译。向用户说明改了什么，由用户在本机编译。
7. 不自行运行 `pnpm build`、`pnpm tauri build`、`pnpm tauri dev`、`cargo build`、`cargo check`、`cargo test`、`tsc` 等编译或涉及编译的流程。尤其 `tauri dev` 会触发 Rust 编译，不能当成普通界面预览直接启动。
8. 验收用例与检查命令可以准备并交给用户执行。尚未执行的检查必须明确写为“未运行”，不能把代码审阅当成运行通过。
9. 表格分隔行使用 `|---|---|` 形式，有几列就使用几个分隔单元。
10. 技术说明默认面向初学者，先说明用途、输入输出和结果判断依据，再解释算法与代码。项目细节必须核对源码，区分原版事实与新方案。

本轮授权范围是生成交接文档。新会话应以用户在新会话中的启动消息确认实际实施范围；可使用本文末尾提供的启动指令。

## 3. 已核实的技术栈

| 层面 | 上游默认 main 分支 | Della CRM / 新项目目标 |
|---|---|---|
| 界面 | HTML、原生 JavaScript，使用 DOM 与全局对象组织部分功能 | React 18 + TypeScript |
| 样式 | CSS，README 描述为 HeroUI 风格；入口引用 Three.js | Tailwind CSS 4 + 自定义 CSS + Lucide 图标 |
| 构建 | Node.js 自定义脚本生成 JS bundle | Vite 6 + pnpm |
| 页面组织 | 主界面、练习页面与跨窗口消息 | React Router 6，沿用 HashRouter 模式 |
| 数据请求状态 | 浏览器内服务与数据层封装 | TanStack Query 5 管理异步数据读取与刷新 |
| 运行方式 | 静态网页，本地或静态托管，无需服务端进程 | Tauri 2 桌面应用，Rust 提供本地能力 |
| 持久化 | IndexedDB 为核心；localStorage 用于旧数据迁移及少量兼容状态；sessionStorage 保存会话草稿 | SQLite，由 Rust 的 rusqlite 访问 |

Della CRM 的 `package.json` 声明 React / React DOM `^18.3.1`、React Router `^6.30.1`、Vite `^6.0.0`、TypeScript `^5.6.0`、Tailwind CSS `^4.0.0`、TanStack Query `^5.0.0`、Tauri JS API / CLI `^2.0.0`。包管理器为 `pnpm@10.32.1`，Node.js 要求 `>=20.19.0`。

Rust 工程使用 edition 2021、Tauri 2、rusqlite `0.41` 并启用 bundled SQLite，另外已有 serde、serde_json 等依赖。以上是配置声明；确切解析版本要读取锁文件确认，不要盲目升级到最新大版本。

Della CRM 的主入口实际使用 `QueryClientProvider` 和 `HashRouter`。SQLite 示例通过 `rusqlite::Connection` 访问独立的 `dellacrm.db`。新项目应使用自己的应用标识和数据库。

业务分工建议：React 负责展示与交互；TypeScript 领域模块负责评分、统计和会话规则；Rust 负责数据库、文件系统与桌面接口。无需把所有 JavaScript 业务算法重写成 Rust。

## 4. 默认迁移范围与功能清单

默认以 `main` 分支为迁移基线，按阶段覆盖该分支的现有功能。第一条阅读流程只是阶段性交付，不代表整个迁移完成。新会话克隆后应把下表细化为可追踪的功能对应表。

| 模块 | 需要保留的能力 | 验收关注点 |
|---|---|---|
| 学习总览 | 练习数量、平均表现、学习时长、连续学习状态、分类进度 | 与历史记录和原版统计口径一致 |
| 题库浏览 | 阅读/听力分类、P1/P2/P3 等筛选、搜索、排序、状态与进度 | 题目身份和显示进度可追溯 |
| 题库管理 | 本地题库导入、配置切换、刷新索引 | 导入与重复导入、缺失资源提示可用 |
| 阅读练习 | 打开题目、作答、计时、提交、结果保存 | 同题同答案的评分与原版一致 |
| 阅读复盘 | 答案对比、解析、定位高亮、阅读背题 | 富文本、图片、定位关系与原题一致 |
| 听力扩展 | 自备资源导入、P1—P4 结构、练习结果进入统一历史 | 音频与题目关联正确，缺失资源有明确状态 |
| 套题 | 顺序完成多个单元，汇总成绩和耗时，保留中断时已完成结果 | 子记录归并、重复提交与中断处理一致 |
| 历史记录 | 类型筛选、搜索、详情、答案对比、批量管理、Markdown 导出 | 记录身份与原始作答完整 |
| 统计与错题分析 | 趋势、热力图、重点题库进度、错题题型分布、阅读专项统计 | 时间范围、重复作答、套题去重和加权计算一致 |
| 草稿与中断记录 | 草稿恢复、中断记录查看、过期与数量策略 | 草稿、中断记录和正式成绩保持各自语义 |
| 词汇 | 内置词表、词汇练习与复习调度 | 调度状态和学习记录能够持久化 |
| 成就与界面 | 成就徽章、主题与动态背景相关表现 | 明确每项的保留、适配和验收状态 |
| 数据管理 | 本地备份、恢复、JSON 导入导出、数据完整性检查、重置 | 完成导出再导入后，关键数据一致 |
| 诊断 | 错误记录、诊断查看与报告导出 | 日志用途与学习数据备份分开 |

听力说明：公开仓库与普通发布包默认不包含完整听力音频、题源、PDF、`ListeningPractice/` 目录和预生成听力索引。新项目应实现自备资源的接入能力，不能承诺迁移后自动拥有这些资源，也不要因为没有公开听力素材而伪造题库。

上游另有 `feature/multi-device-easy-deploy` 多设备同步服务器版，以及 README 标注为开发中的 `IELTS-WRITING-FEAT` AI 功能分支。本文默认迁移的是 main；跨分支功能需要单独核对与确认。

用户目前要求统一技术栈，未明确要求逐像素复制原界面或采用 Della CRM 的全部视觉设计。默认保留雅思业务流程与关键展示信息，用 React 重建桌面界面；重大视觉变更应提出具体方案。

## 5. 建议的工程结构

```text
E:\workspace\IETLS4PASS\
├─ IETLS4PASS-MIGRATION.md       本交接文档
├─ upstream\IELTS-practice\     固定版本的原项目源码参考
├─ docs\
│  ├─ upstream-baseline.md      来源、分支、commit 与资源范围
│  ├─ migration-status.md       功能映射、完成情况和待办
│  ├─ data-contracts.md         题库、成绩、草稿与备份格式
│  ├─ acceptance.md             用户可执行的验收步骤
│  └─ change-log.md             修改日期与原因，含 JSON 配置说明
├─ scripts\                    题库转换与数据校验工具
├─ public\banks\               随应用提供的静态题库与关联资源
├─ src\
│  ├─ app\                     根容器、路由与导航
│  ├─ components\              通用组件
│  ├─ features\                library / reading / listening / records 等
│  ├─ domain\                  类型、评分、统计、会话和词汇调度
│  └─ services\                Tauri 调用封装与查询接口
└─ src-tauri\
   ├─ src\                     commands / domain / infrastructure
   ├─ migrations\              SQLite 表结构版本迁移
   ├─ capabilities\            实际需要的桌面权限
   ├─ Cargo.toml
   └─ tauri.conf.json
```

候选独立配置：产品名 `IETLS4PASS`，包名 `ietls4pass`，应用标识 `dev.ietls4pass.desktop`，开发端口 `1422`，数据库名 `ietls4pass.db`。这些是待落地的建议值，创建前检查冲突即可，不需要为普通命名选择反复询问用户。

参考 Della CRM 的工程配置、路由和 Rust 数据访问模式。新项目的业务数据、应用目录和配置应独立；复制配置时检查应用标识、端口及路径，避免把 CRM 的 `.data`、数据库、密钥、客户资料、构建输出或依赖目录带入新项目。

`upstream` 用于源码追溯，不应整体作为新应用运行资源打包。运行时资源应通过明确的转换与复制流程进入新项目资源目录。

## 6. 实施阶段

### 阶段一：获取上游并核对基线

在确认目标工作区可写、且用户授权开始迁移后，将 main 源码获取到 `upstream\IELTS-practice`。若该目录已有内容，先检查，不覆盖或删除。

下面是可采用的命令，本轮没有执行：

```powershell
git clone --branch main --single-branch https://github.com/sallowayma-git/IELTS-practice.git "E:\workspace\IETLS4PASS\upstream\IELTS-practice"
git -C "E:\workspace\IETLS4PASS\upstream\IELTS-practice" rev-parse HEAD
```

将来源 URL、分支、实际 commit、获取日期和资源范围写入 `docs/upstream-baseline.md`。README 指出部分运行 ZIP 或发布标签树可能不含开发脚本，需核对取得的检出包含实际源码与转换所需资源。

优先读取：

- 原项目实际的 `AGENTS.md`（如存在）、README、LICENSE、`index.html` 和 `scripts/build-bundles.mjs`。
- `js/utils/answerMatchCore.js`、`js/utils/answerComparisonUtils.js` 等实际评分与答案规范化入口。
- `js/core/practiceRecorder.js`、`js/data/practiceRecordSource.js`、`js/data/v2/` 等实际数据模型。
- `js/runtime/readingExamRegistry.js`、阅读题库 manifest、代表性题目资产和解析资产。
- `js/app/` 中会话与套题逻辑、阅读运行时、听力记录桥接模块。
- `js/services/readingAnalytics.js`、计时与统计模块、词汇调度模块。
- 实际存在的阅读统计与计时约定文档、测试与样例数据。

上述是依据先前目录和 bundle 清单列出的核对入口，具体以实际 commit 为准。若路径改变，搜索后定位对应模块，不因文件名变化跳过业务核对。

保留原项目 LICENSE、版权头和来源记录。代码来源与题库、音频、PDF 等素材来源分别记录，不把代码许可当作所有素材的授权说明。

### 阶段二：初始化独立工程

建立 React / TypeScript / Vite / Tailwind / Tauri / Rust 配置和基础布局，注册题库、练习、历史、统计、词汇和设置等页面入口。复用 Della CRM 的配置模式时按新应用调整。

先搭建统一的 Tauri 调用封装、错误类型和 SQLite 版本迁移入口。TanStack Query 用于读取与刷新异步数据；当前题目输入、暂停状态等短期交互由 React 状态管理，避免每次击键都触发数据库请求。

数据库与应用数据路径在新项目内独立定义；发布版使用该应用自己的数据目录。浏览器预览没有 Rust 后端时应清楚标明可用范围，不使用假保存来冒充真实持久化。

安装依赖会写文件，应属于用户明确授权的实施范围；网络或依赖受限时如实说明，不用跳过检查来宣称工程已运行。

### 阶段三：题库适配与阅读完整流程

先选择能覆盖不同题型、图片和解析结构的代表性阅读资产，确认数据格式，再实现转换工具。随后覆盖整个基线题库，不能把少数样例当作完整题库交付。

原项目的 `readingExamRegistry.js` 已观察到 `register(id, payload)` 数据注册接口，可作为定位阅读结构化数据的入口。应进一步核对实际 payload，不预设全部资源都是简单 JSON。

转换过程保留来源题目 ID、题型、题组、文章富文本、选项、标准答案、可接受答案、解析、定位关系和资源路径。为自定义题库增加稳定的来源标识，保证不同题库中同名题目不会混淆。

阅读页面实现文章、题目、答题状态、计时、提交、评分和结果展示。评分规则先按原实现整理，再提取为 TypeScript 领域函数；同题同答案必须能与原版对照。

首个阶段性闭环：题库列表 → 打开阅读 → 作答与计时 → 提交 → SQLite 保存 → 历史详情 → 重启后仍可查看。

### 阶段四：历史、统计和恢复

迁移历史详情、搜索、筛选、批量操作、Markdown 导出、学习总览、错题分析、趋势、热力图和阅读专项统计。

按原版核对以下口径：重复提交如何计数、不同篇章数如何计算、套题子篇如何去重、时间范围如何应用、分类与题型缺失如何展示。根据目前 README，阅读专项统计涉及按总得分 / 总分计算加权正确率，不能自行改成各次正确率的简单平均。

保留正式成绩、可恢复草稿和中断记录的区别。当前 README 描述中断记录不计入正式练习数量、正确率、趋势、成就和题库完成度；具体过期、数量限制及恢复路径在固定源码中再次核对。

计时数据区分整次练习耗时、前台有效时长和题目/题组关联时长。原版未提供的精确分题时间不要通过平均分配伪造；历史数据缺字段时展示覆盖范围。

### 阶段五：补齐剩余功能

依次迁移套题、自备听力资源接入、词汇调度与复习、阅读背题、成就、主题与动态背景、题库配置、备份恢复、重置及诊断。

套题与听力继续写入同一套历史模型，保留来源、类型、会话和父子关系。新界面优先在应用内通过路由组织练习；确有需要的独立窗口使用 Tauri 窗口与明确的消息协议适配。不要假定浏览器的 `window.open` / `postMessage` 在桌面容器中可直接照搬。

听力资源缺失时保留导入入口和明确状态。音频、PDF、图片的本地路径、选择器及资源读取在目标平台逐项验收。

### 阶段六：交付与用户验收

更新功能映射表，逐项标记“待实现 / 已实现未运行 / 用户验证通过 / 存在限制”。每次汇报区分代码完成与运行验证。

准备具有实际业务意义的验收用例：原版与新版评分对照、真实题库资源完整性、草稿恢复、套题重复归并、统计口径和备份往返一致性。测试代码遵循用户注释规则，执行由用户安排，不能自行触发编译。

最终交付应包括源码、依赖配置、数据库迁移、资源转换工具、来源记录、迁移状态、运行说明、验收步骤及已知限制。不得只完成桌面框架或少数阅读样例就将整体迁移标记为完成。

## 7. 数据与文件处理建议

数据层先明确用途与读写边界，再确定表结构。以下为候选划分，需根据原版字段调整：

| 数据类别 | 用途 | 设计要点 |
|---|---|---|
| 题库配置与索引 | 查找题目、关联资源、切换来源 | 保留原 ID 与来源命名空间，索引可重新生成 |
| 练习记录与作答 | 记录正式结果及原始答案 | 保留题目类型、得分、总分、时间、评分版本和提交身份 |
| 草稿与中断状态 | 恢复作答、查看未完成记录 | 与正式成绩分开，明确过期与清理规则 |
| 套题会话与子项 | 跟踪套题进度与成绩归并 | 使用稳定会话 ID，重复保存可识别，事务处理关联写入 |
| 词汇与复习状态 | 支持记忆调度和复习历史 | 核对原版状态机与调度字段 |
| 设置与主题 | 保存用户偏好和题库选择 | 设置版本化，不绑定 CRM 数据 |
| 备份元数据 | 查找备份、记录恢复结果 | 备份文件不递归包含自身，不直接复制正在写入的数据库文件 |

题库、解析和媒体可使用文件存储，SQLite 保存用户数据和必要索引；不要求把所有 HTML、音频、PDF 都塞入数据库。

随应用提供的题库与用户后续导入的资源应有明确存放位置。导入功能通过原生文件选择与 Rust 文件接口实现，浏览器的文件夹句柄不能直接当成可迁移路径保存。

旧浏览器数据迁移以原项目导出的 JSON 为入口，先验证结构与版本，再在事务中导入。遇到重复记录、未知题目或缺失字段，提供可追踪结果；不通过复制浏览器内部 IndexedDB 目录完成迁移。

实现备份恢复时考虑 SQLite 一致性，采用合适的数据库备份方式或逻辑导出。恢复前完成校验，再处理替换或合并，避免部分导入后界面宣称成功。

显示得分、总分、正确率和耗时时写明含义与单位。不要新增没有来源依据的雅思 Band 换算或自动达标判定。

## 8. 给用户执行的验收清单

以下是后续验收目标，本轮均未运行：

- [ ] 新应用名称、标识、端口和数据库独立。
- [ ] 默认题库能够搜索、筛选、排序，题目数量与所选基线资源相符。
- [ ] 各实际题型的相同答案在原版与新版得到一致评分。
- [ ] 阅读提交、解析、答案对比和定位高亮正确。
- [ ] 重复提交、刷新与恢复不会无意产生重复成绩。
- [ ] 重启后记录、设置、词汇与草稿保留。
- [ ] 中断记录和草稿不会被误计入正式统计。
- [ ] 套题完整完成和中途退出的归并规则正确。
- [ ] 时间、题型、分类及搜索筛选下的统计口径一致。
- [ ] 自备听力资源能接入，缺失音频或 PDF 有明确状态。
- [ ] JSON 导出再导入后，关键记录与设置一致。
- [ ] 备份恢复、数据重置和诊断记录遵守各自数据边界。
- [ ] 源码与资源的来源记录、说明文档和迁移状态齐全。

## 9. 已查阅文件与来源

本地 Della CRM 已查阅的主要文件：

- `E:\workspace\DellaCRM\README.md`
- `E:\workspace\DellaCRM\package.json`
- `E:\workspace\DellaCRM\vite.config.ts`
- `E:\workspace\DellaCRM\tsconfig.json`
- `E:\workspace\DellaCRM\src\main.tsx`
- `E:\workspace\DellaCRM\src\app\App.tsx`
- `E:\workspace\DellaCRM\src\styles.css`（定向检索）
- `E:\workspace\DellaCRM\src\services\llm\index.ts`
- `E:\workspace\DellaCRM\src\services\llm\client.ts`
- `E:\workspace\DellaCRM\src-tauri\Cargo.toml`
- `E:\workspace\DellaCRM\src-tauri\tauri.conf.json`
- `E:\workspace\DellaCRM\src-tauri\src\lib.rs`（定向检索）
- `E:\workspace\DellaCRM\src-tauri\src\infrastructure\llm_store.rs`（存储相关部分）

上游主要来源：

- [GitHub 仓库](https://github.com/sallowayma-git/IELTS-practice)
- [中文 README：功能、分支、存储与资源范围](https://github.com/sallowayma-git/IELTS-practice/blob/main/README.zh-CN.md)
- [英文 README](https://github.com/sallowayma-git/IELTS-practice/blob/main/README.md)
- [页面入口 index.html](https://github.com/sallowayma-git/IELTS-practice/blob/main/index.html)
- [自定义 bundle 脚本与源码清单](https://github.com/sallowayma-git/IELTS-practice/blob/main/scripts/build-bundles.mjs)
- [阅读数据注册接口](https://github.com/sallowayma-git/IELTS-practice/blob/main/js/runtime/readingExamRegistry.js)

这些链接跟随 main 变化。实际实施以阶段一记录的 commit 为准。

## 10. 新会话启动指令

用户将本文放到目标目录，并以 `E:\workspace\IETLS4PASS` 为工作区打开新会话后，可以直接发送下面这段话。发送即明确授权所列实施范围，不需要对范围内每次新建文件重复确认：

> 请读取 `E:\workspace\IETLS4PASS\IETLS4PASS-MIGRATION.md`，延续其中的用户规则、分析和迁移方案，开始将 <https://github.com/sallowayma-git/IELTS-practice> 的 main 分支迁移为独立的 IETLS4PASS 桌面项目。
>
> 我确认允许在 `E:\workspace\IETLS4PASS` 内获取原项目源码，以及创建和修改本次迁移所需的代码、配置、转换工具和文档；读取 `E:\workspace\DellaCRM` 的工程配置作为参考。需要替换的旧代码先注释保留，新增代码加日期和原因注释；标准 JSON 的原因写入修改说明。不要直接删除既有文件或代码。
>
> 技术栈采用 React 18、TypeScript、Vite 6、Tailwind CSS 4、React Router 6、TanStack Query、Lucide、Tauri 2、Rust 和 SQLite。先核对工作区权限、目标目录现状和实际源码，记录上游 commit，再按文档分阶段实施，最终覆盖 main 的现有功能。阶段性阅读流程完成后继续推进其余模块，并持续维护迁移状态。
>
> 不要自行安装依赖、编译或启动会触发编译的程序；将依赖安装、检查、编译和运行命令交给我执行。请先告知读取了哪些文件及第一阶段的具体改动范围，然后开始已授权的工作。

如果用户修改这段启动指令，以新消息中明确的授权和约束为准。新会话不得把旧会话的写入权限假定为新工作区权限，应核对实际环境。
