# 给后续架构设计者的 IETLS4PASS 上下文

## 当前目标与证据边界

IETLS4PASS 是 React 18/TypeScript/Vite + Tauri 2/Rust/rusqlite 的 Windows 桌面程序。审计基于 2026-11-28 的工作树、四科本地素材、一个 Schema 9 的只读 SQLite 用户库。开发用项目 data 目录，正式构建按各类资源目录及打包规则加载。没有账户型远程学习系统。审计未编译、没跑 UI 或外发任何作文/语音。已实现的 AI 是口语考官、ASR、TTS、模型连通性和 Prompt 管理。诊断、训练、学习经验的业务逻辑未实现。 [架构](01_PROJECT_ARCHITECTURE.md) · [核验](06_DATABASE_AND_HISTORY.md) · [AI](07_AI_INFRASTRUCTURE.md)

目标闭环是练习→单次诊断→薄弱点→阶段诊断→针对训练→复测。下面以当前事实说明各处输入及约束。长短期的具体实现、Schema、供应商和调度仍待设计。

## 数据契约和当前 API

以下为当前定义的精简组合，基于实际字段；完整原文与行号见 [源码摘录](11_KEY_SOURCE_EXTRACTS.md)。

```ts
type Answer = string | string[] | null;
type Answers = Record<string, Answer>;
interface AnswerResult {
  questionId: string; label: string; userAnswer: Answer; correctAnswer: Answer;
  points: number; possible: number; type: string;
}
interface PracticeRecord {
  id: string; kind: "reading" | "listening"; title: string;
  examId?: string; bankId?: string; category?: string;
  submittedAt: string; startedAt?: string; elapsedMs?: number;
  answers?: Answers; details?: AnswerResult[]; points: number | null; possible: number | null;
  source?: "desktop" | "legacy"; raw?: unknown;
  readingTiming?: ReadingTiming; annotations?: ReadingAnnotations; questionHighlights?: PassageHighlight[];
}
interface SpeakingMessage {
  role: "assistant" | "user"; content: string; at: string; elapsedMs: number; phase: SpeakingPhase;
  model?: string; input?: "text" | "voice"; durationMs?: number; audioId?: string;
}
interface SpeakingSession {
  id: string; revision: number; topicId: string; title: string; book?: string; part: SpeakingPart;
  startedAt: string; updatedAt: string; phase: SpeakingPhase; elapsedMs: number; phaseStartedMs: number;
  runningSince: number | null; messages: SpeakingMessage[]; endReason?: SpeakingEndReason; examinerVoice?: ExaminerVoice;
}
interface WritingSubmission {
  id: string; task: "1" | "2"; questionId: string; title: string; answer: string; submittedAt: string;
}
```

- **VERIFIED 存储** `practice_records(id, submitted_at, record_json)` 有倒序时间索引。`workspace_documents(collection,id,document_json)` 复合主键覆盖 `drafts/listening-drafts/listening/speaking-sessions/speaking-audio/writing-submissions/settings/annotations/review-plans/listening-highlights` 等。没有题库表、独立答案表、跨科尝试表、分析/训练表。`reading_draft_writers(draft_id,attempt_id,writer_id,revision)` 并发保护阅读草稿。备份包含 JSON 学习数据和录音附件，模型凭据、路径及 Markdown 在工作区备份外。[数据库](06_DATABASE_AND_HISTORY.md)
- **VERIFIED API** `desktop.records()` 对应 `list_records`；`desktop.documents<T>(collection)` 对应 `list_documents`。`saveRecord(record,draftId?,writer?,review?)` → `save_record`，`submitListeningSection(draftId,record,expected)` → `commit_listening_section`；`saveSpeakingSession(session,recording?)` → `save_speaking_session`；`put("writing-submissions",id,value)` → `put_document`。`desktop.speakingAudio(sessionId,audioId)`、`desktop.bankMedia(id,file)` 提供二进制。以上接口操作都在 Tauri 内。 [源码摘录](11_KEY_SOURCE_EXTRACTS.md)
- **VERIFIED 模型边界** `desktop.generateText(request: LlmPromptRequest): Promise<LlmCompletion>`，前端请求字段 `promptIds: string[]`、`variables?: Record<string,string>`、`messages?: LlmMessage[]`。普通消息内容为字符串，角色为 user/assistant。服务叠加 system + 业务文档，将当前加载的模型参数送 `/chat/completions`，返回 `{content,model,finishReason}`。无原生结构化输出或多模态。转写 IPC 单独接受 WAV bytes，DeepSeek 返回被提取为字符串。只有日常对话消息持久化模型名。 [AI](07_AI_INFRASTRUCTURE.md)

## 四科单次分析输入与挂接边界

| 科目 | 一次练习/保存稳定点 | 可复用的题库证据与输入 | 应降级的情况与呈现位置 |
|---|---|---|---|
| 听力 | Section；`SectionAttempt.submit.onSuccess(record)` 或已有 ID，保留草稿的 attempt UUID | `bankId+examId` 经 `listeningRows/loadSection/parseListeningExport`；结构 `{meta,listening,questions,answers,analysis}`。`questions.raw.data.navList[].scoreCode` 对题组，`answers[].accepted` 对标准答案，`sentences[].{en,start,end}` 对时间。实际答卷及成绩直接取 record | 没有逐题音频片段映射和行为轨迹；失去题源只分析有内容的历史判分。结果可在 `ListeningResultPage` 和对应全局记录展示。题库“查看”取最新分，传入明确 ID 才能固定分析对象。[听力](02_LISTENING_MODULE.md) |
| 阅读 | Passage；`ReadingAttempt.submit` 中 `saveRecord` 确认后 | `ReadingAsset {exam,explanation}`，exam 有 `passage.blocks/questionGroups/questionOrder/answerKey`，解析有 `passageNotes/questionExplanations.items`。逐题分、答案、批注、`ReadingTiming` 进记录。`readingAsset`、`showReadingLocation` 可复用 | 没有原文阅读路径、修改日志，段落定位部分启发式，兼容旧记录可能无答案或用时。区分客观错误和模型归因；显示于 `ReadingReplay/RecordDetail`。[阅读](03_READING_MODULE.md) |
| 口语 | Part，当前 finished 且含用户回答；`SpeakingPractice.persist/saveSpeakingSession` 成功状态 | 用 session UUID 读所有回合。话题 `SpeakingTopic{id,part,category,title,book?,questions,cueCard?}` 通过 `part:id` 找，LLM 考官的问题已经逐条保存，口语音频用 `{audioId,sessionId}` 查原 WAV，确认文本可编辑过 | Text-only 可作语言反馈，不能给无依据发音 Band。有音频但无声学评分器时依然需降级；当前本地样本没有用户答复。结果位置可为结束态和 `SpeakingRecordDetail`。[口语](04_SPEAKING_MODULE.md) |
| 写作 | 单 Task/一次提交；`WritingExercise.save.onSuccess(_, value)` | UUID 对正文，`task:questionId` 匹配当前题库。`WritingQuestion` 含 `prompt:{html,text},images:{url,file}[],examples`。Task 1 按相对路径读取实图 bytes；Task 2 可取题面和写作内容 | 缺写作用时、版本和可视输入。图缺失时明确限制 Task Achievement；范文只作对照。结果可放 `WritingRecordDetail` 或题目内结果视图。[写作](05_WRITING_MODULE.md) |

当前四科完成事件不需要等分析成功才保存作答。后续设计若采用异步处理，需考虑同一提交重试、模型失败与历史重跑的独立语义。无法靠稳定记录 ID 保证原题版本完整，设计必须表达当前题源、缺失题源和历史快照的差别。听阅单节/单篇得分不是官方 Band。口语四维、写作四维和 Task 权重须分别使用官方口径，报告要标明所依据的证据或适用边界。[IELTS 评分细则](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail)

## 长期诊断的十个现状问题

| 问题 | 当前答案与含义 |
|---|---|
| 1. 四科历史能统一查询吗 | PARTIAL 前端 `Records` 分别取正式分、口语会话、写作提交，再合并。没有统一后端服务或过滤集合 |
| 2. 有统一学习记录服务吗 | NOT_IMPLEMENTED 仅有 `desktop.records/documents`、`useWritingSubmissions`、`ListedPracticeRecord` 及特定科目的投影与 UI |
| 3. 有学习统计服务吗 | PARTIAL `Overview`、`LearningActivity`、`Achievements`、`readingRecordsFor` 做提交量、题库进度、热图和成就，主要为前端计算。没有后端长期指标仓 |
| 4. 时间范围能构造完整上下文吗 | PARTIAL 可在本地按时间切片并说明时间口径，缺旧题、词/句时间和 AI/专项历史。热图的范围组件可复用，不能当完整查询机制 |
| 5. 能按需检索少量原卷证据吗 | PARTIAL 题库 ID 已能逐项加载，文字解析、题号和部分定位可裁剪。无语义、时间或题型的跨科证据索引；现可从 score、type、source 命名空间自行构造有限检索 |
| 6. 数据足够支持长期诊断吗 | PARTIAL 有活动量及客观分基础，当前真实样本仅 1 条听力正式、口语无用户回复、无读写正式。当前样本和缺失字段不足以建立持续薄弱点或可信趋势 |
| 7. 必须替换四科 ID 吗 | VERIFIED 四科已各有稳定尝试/提交 UUID。可在架构设计时考虑科目+既有 ID 识别，区别题目版本；无证据需要重编号历史或改旧主键 |
| 8. 哪些不能直接比较 | 单节/单篇和全科 Band，题型分布不同或时间口径不同，旧迁移用时和新前台时长，语音和键盘口语，图片缺失的 Task 1、重复原题和陌生题、模型/Prompt 不同的结果 |
| 9. 可复用什么 | 四科查题/回看、客观题评分、口语成功条件和录音、Prompt 组合、输出展示组件、考试目标、时间范围交互、工作区备份机制 |
| 10. 尚缺什么 | 统一查询/API 及数据质量、版本化证据和评分、可评估的多模态接口、分析任务/报告存储、薄弱点证据链、训练/复测记录、结构校验、访问与保留策略 |

按题类型与来源过滤只能基于实际保留的字段和题库再关联。可聚合听阅历史正确率、按类型的错题 count/possible，并说明缺题覆盖和重复。当前没有可比较的历史口写 Band，也没有历史分析或训练可 join。跨科共性可以定义在未来的分类层，现有数据只能提供候选，如同义改写误判与语法使用需要分别回到原文/发音证据。见 [数据库](06_DATABASE_AND_HISTORY.md) · [数据矩阵](09_DATA_AVAILABILITY_MATRIX.md) · [风险](10_GAPS_AND_RISKS.md)。

## 供后续方案比较的约束

- **证据** 确定证据来源须包括原始记录 ID、题库身份及内容依据，可找到单题、原文片段、回合或作文文本区间。已有阅读 DOM 位置、听力时间戳不等价于全库稳定映射。为数据缺失和证据歧义留出口。保持题库标准答案和 AI 推断独立。[阅读](03_READING_MODULE.md) · [听力](02_LISTENING_MODULE.md)
- **结果、Prompt 与 Schema** 当前仅 Markdown Prompt 原型与 text completion，没有有效结果 Schema。后续设计可比较结构化返回、后验校验及版本策略，保留可复现的模型、Prompt、规范与证据版本。不要把 ASR 文本当发音测评，写作句区间需对应实际提交正文与版本。[AI](07_AI_INFRASTRUCTURE.md) · [源码和 Prompt](11_KEY_SOURCE_EXTRACTS.md)
- **薄弱点和训练** 需要分清单次错误、报告推断和跨样本稳定标签。现有题型、场景、Task、错题、练习来源适合作为检索信号。无现成的题→薄弱点映射、自动训练生成、难度/迁移效果或复测评估。今后需比较已有题库推荐和生成练习的安全边界，注明原题/生成资料与训练结果的关联依据。[数据矩阵](09_DATA_AVAILABILITY_MATRIX.md)
- **长上下文和外发** 先根据时间、科目、训练效果产出本地分布，明确抽样和小样本。再读取可以证明关键判断的片段。录音、作答与第三方真题均需评估外发和权利。当前没有学习时间表，考试日期和目标分只作既有输入，学习计划所需可用时间仍缺。[风险](10_GAPS_AND_RISKS.md)
- **实施顺序供估算** 可先验证一个有可靠客观证据的项目边界，再比较如何补齐证据版本和结构化结果；口语音频、Task 1 图片分别需单独验证；长周期聚合、薄弱点与训练复测需要有可追溯的单次结果作输入。这是依赖关系，不是本次确定的开发顺序或数据库方案。[接入点](08_UI_AND_INTEGRATION_POINTS.md)

**样本与运行限制** Schema 9 本机库真实统计为听力正式 1、阅读正式 0、口语正式 0、写作正式 0。工作树包含 256 节听力、239 篇阅读、190 口语题、128 写作题。应用启动、麦克风、网络模型、真实多模态支持和版权许可本次未核实。输出应显式写 UNKNOWN，不以有页面入口或某个类型就推定该业务已上线。
