# 四科数据可用性矩阵

**AVAILABLE** 当前可直接使用。**DERIVABLE** 可由现有字段按清晰口径推导。**RUNTIME_ONLY** 只保留运行时状态。**PARTIAL** 依赖题源、覆盖、证据粒度或完整性。**MISSING** 核实当前未采集或未实现。**NOT_APPLICABLE** 该判断项不适用于此科。**UNKNOWN** 无法通过现有证据验证。表中的“可用于 AI”指有安全、合法的数据连接时能否作为输入，现有产品未接入教师分析。

| 数据项 | Listening | Reading | Speaking | Writing | 数据来源 | 持久化方式 | 是否可直接用于 AI 分析 | 缺失项 | 相关源码 |
|---|---|---|---|---|---|---|---|---|---|
| 原始题目 | AVAILABLE | AVAILABLE | AVAILABLE | AVAILABLE | 默认或绑定题库 | 文件 JSON/HTML/PDF，记录保存部分引用 | 可定位当前题库时可用 | 历史没有不可变题面，参考件结构不齐 | `listeningExport.ts`、`banks.ts`、`speaking.ts`、`writing.ts` |
| 题目唯一 ID | PARTIAL | PARTIAL | PARTIAL | PARTIAL | `bankId/examId/questionId`、`part:id`、`task:questionId` | 题库和成绩/会话 | 可用作当前命名空间内的键 | 不同源全局唯一与内容版本未定义 | `listening.ts`:103–167、`types.ts`:6–54、`speaking.ts`:44、`writing.ts`:34–59 |
| 题型与分类 | AVAILABLE | PARTIAL | AVAILABLE | AVAILABLE | 听力 sctype/场景，阅读 kind/细类启发式，口语 Part/category，写作 Task/图表/话题 | 文件、部分客观题 details/成绩分类 | 可用，阅读细类须标注置信度 | 无统一分类，未掌握全部原题因素 | `listeningExport.ts`:95–170、`scoring.ts`:78–93、`WritingPractice.tsx`:12–47 |
| 标准答案 | AVAILABLE | AVAILABLE | NOT_APPLICABLE | NOT_APPLICABLE | 听力答案导出、阅读 answerKey | 题库文件，逐题详情存提交时答案 | 可用于客观评分事实 | 旧题库/历史样本可缺，范文不能代作唯一答案 | `listeningExport.ts`:65–82、`types.ts`:35–45,65–96 |
| 题库解析 | PARTIAL | PARTIAL | MISSING | PARTIAL | 听力 analysis，阅读 passageNotes/items，写作原文件 note/范文 | 文件，通常不复制到成绩 | 可作参考，可核对来源 | 听力 pageId 在当前 DTO 被丢弃，读解析非全覆盖，写作 note 未接入 | `listeningExport.ts`:197–206、`AnswerReview.tsx`、`writing.ts` |
| 原文／参考题卡 | AVAILABLE | AVAILABLE | AVAILABLE | NOT_APPLICABLE | 听力句子/合并原文，阅读 passage，口语 Part 2 cueCard | 文件 | 可，保留出处并缩减长度 | 听到答题/读到答题映射不全；非 Part 2 无题卡 | `listeningExport.ts`:212–230、`types.ts`:35–55、`speaking.ts` |
| 图片／图表 | PARTIAL | PARTIAL | NOT_APPLICABLE | PARTIAL | 本地引用，听力部分、阅读少量、写作部分 | 图片文件、相对路径；运行时 blob URL | 文字模型不能直接消费，当前 app 能读 bytes | 缺视觉接口与版本证据 | `folderBanks.ts::useFolderMedia`、`WritingExercise.tsx::writingContent` |
| 真题音频 | AVAILABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | 256 节 mp3/兼容单节本机文件 | 文件，手动选取仅用于运行时 | 当前只可转人工/ASR 途径，文本补全不能接 | 无读取音频理解的教师模型 | `ListeningSection.tsx::loadSection/ListeningMedia` |
| 音频时间戳 | PARTIAL | NOT_APPLICABLE | MISSING | NOT_APPLICABLE | 听力句级 start/end，254/256 节每句格式有效。口语 ASR 不接时间戳 | 听力文件；口语 durationMs 仅片段长度 | 有效的时间段可定位句子 | 题↔句稳定锚点、口语词级或句级对齐 | `listeningExport.ts`:212–229、`llm/asr.rs` |
| 用户答案 | AVAILABLE | AVAILABLE | PARTIAL | AVAILABLE | 客观题 answers，口语 user messages，作文 answer | SQLite 成绩或文档 | 可，但空白/非完整记录需单列 | 旧历史可能无答卷；样本口语无人作答 | `types.ts`:75–114、`speakingPractice.ts`:11–42、`writing.ts`:25–32 |
| 用户作文 | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | AVAILABLE | 编辑器 submit | 写作提交 answer | 可做内容、组织、语言分析 | 草稿、编辑版本、用时 | `WritingExercise.tsx`:64–99 |
| 用户录音 | NOT_APPLICABLE | NOT_APPLICABLE | PARTIAL | NOT_APPLICABLE | 口语发送语音后录音附件 | SQLite Base64，可由 audioId 读 bytes | 需合格音频分析通道 | 文本回答无音频、样本无录音、发音引擎缺失 | `useSpeakingRecorder.ts`、`store/speaking.rs`:84–128 |
| 转录文本 | NOT_APPLICABLE | NOT_APPLICABLE | PARTIAL | NOT_APPLICABLE | DeepSeek ASR 后用户确认文本 | 语音消息 content，关联 audioId | 可作文本证据并标注来源 | 原始转写、置信度、编辑 diff、标点/停顿准确度 | `SpeakingPractice.tsx`:319–352、`llm/asr.rs` |
| 判题结果／客观得分 | AVAILABLE | AVAILABLE | NOT_APPLICABLE | NOT_APPLICABLE | scoreListeningExport / scoreReading | 正式 points/possible/details | 可直接用作计算口径 | 不等于官方 40 题分或能力结论 | `listeningExport.ts`:31–60、`scoring.ts`:95–138 |
| 分项评分 / 总估分 | NOT_APPLICABLE | NOT_APPLICABLE | MISSING | MISSING | 仅现有 Prompt 原型 | 无正式结果存储 | 尚不可读取 | Band 依据、证据、模型与版本 | `llm.rs`、`data/skill-docs/` |
| 答题时长 | AVAILABLE | PARTIAL | AVAILABLE | RUNTIME_ONLY | 听力活动时长；阅读总时长及归属；口语阶段/回合；写作时钟 | 听阅记录及草稿、口语会话 | 可，时长定义不同需保留单位和口径 | 写作用时、听力逐题用时，历史阅读覆盖可缺 | `usePracticeClock.ts`、`readingTiming.ts`、`speakingPractice.ts`、`WritingExercise.tsx` |
| 答案修改记录 | MISSING | MISSING | MISSING | MISSING | 只有当前快照/确认文本 | 无事件/版本日志 | 不可重建变化 | 修改前后、操作时间、回答稿本 | `ReadingAttempt.tsx`、`ListeningSection.tsx`:667–685、`SpeakingPractice.tsx`、`WritingExercise.tsx` |
| 重新播放、暂停行为 | PARTIAL | RUNTIME_ONLY | RUNTIME_ONLY | RUNTIME_ONLY | 听力草稿位置、界面状态及口语播放 | 听力草稿带最后状态切片；无行为日志 | 仅可识别时钟覆盖与草稿位置 | 重放次数、停顿序列、按题媒体使用 | `ListeningSection.tsx`、`usePracticeClock.ts`、`SpeakingMessages.tsx` |
| 用户自评错因 | MISSING | PARTIAL | MISSING | MISSING | 阅读自由笔记/复习质量反馈 | annotations / review-plans | 阅读可用作自述线索，未结构化 | 统一自评错因或结构化标签 | `ReadingNotes.tsx`、`readingReview.ts` |
| 重复练习标识 | DERIVABLE | DERIVABLE | DERIVABLE | DERIVABLE | 同题 ID、不同 session ID、时间排序 | 保留多条正式记录 | 可，限现有可见历史及可比题源 | 无独立标志、跨版本/删历史的不确定性 | `listening.ts`、`banks.ts`、`records.ts`、`writing.ts` |
| 历史 AI 诊断 | MISSING | MISSING | MISSING | MISSING | 学习诊断占位 | 无 | 不可 | 单次和长期报告、结果版本、证据 | `App.tsx`:320–325、`llm.rs` |
| 薄弱点标签及历史证据 | MISSING | MISSING | MISSING | MISSING | 现有题型/错误可成为证据候选 | 无薄弱点模型或关联 | 客观错题可聚合，不能直接读取标签 | 跨科分类、可信度、证据关系 | `types.ts`、`StudyOverview.tsx` |
| 历史专项训练及复测 | MISSING | MISSING | MISSING | MISSING | 针对训练占位；词汇复习非该链路 | 无专项目标、记录或回写 | 不可 | 目标关联、引擎、作答证据、复测比较 | `App.tsx`:323–325、`readingReview.ts` |
| 学习目标 | AVAILABLE | AVAILABLE | AVAILABLE | AVAILABLE | 考试日期与四科目标 Band | SQLite settings，`ielts-exam-plan` | 可用于建议背景；值可为空 | 无能力基线或分科规划 | `examPlan.ts`:5–52、`ExamPlanSettings.tsx`:12–22,83–142 |
| 用户可用学习时间 | MISSING | MISSING | MISSING | MISSING | 活动热图是过去的提交日期 | 无配置 | 不可把活动当可用时间 | 日/周配额、偏好日程 | `LearningActivity.tsx`、`ExamPlanSettings.tsx` |
| 教师调用的 token、成本和版本 | MISSING | MISSING | MISSING | MISSING | 未接入教师请求。当前考官单条消息留有模型名 | 无教师费用、提示词或评分版本记录 | 无分析参考 | usage、成本、Prompt 快照和证据版本 | [AI](07_AI_INFRASTRUCTURE.md) |
| 实际提供方可用性、题库资料授权 | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | 本次仅核对源码和公开规范 | 无可靠的运行/授权证据 | 需外部证据 | 当前服务运行特性与第三方资料授权 | [AI](07_AI_INFRASTRUCTURE.md) · [风险](10_GAPS_AND_RISKS.md) |
