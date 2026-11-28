# UI、状态和接入位置

状态以源码和数据为据。下面路径为 React Router 地址，在桌面上由 HashRouter 装入。未运行 UI，也未从旧截图推断当前交互质量。

| 页面及路由 | 组件/子组件 | 请求及状态 | 实现和可选分析呈现位置 |
|---|---|---|---|
| 听力题库 `/listening?view=order&book=20` 或场景参数 `scene` | `src/features/Listening.tsx::Listening/ListeningCatalogRow/ListeningActions` | 读 listening 索引/保存草稿/成绩，`useFolderBankSync`；URL 控制视图 | VERIFIED 按章/场景、答题、最近结果、详解、精听。列表可在已有结果处提示分析是否可用，当前无状态字段 |
| 听力作答 `/listening?section=<row.id>&mode=practice`（可 restart） | `ListeningSection.tsx::SectionAttempt/ListeningMedia/ListeningQuestionPaper`，共享 `ReadingPaper`、高亮 | `loadSection` 读本机题源与音频，React state/ref 保存开始、暂停与输入，IPC 更新草稿 | VERIFIED 先开始、进度/跳题、未答确认、交卷与着色。接入点是成功提交回调而非播放器或草稿 |
| 听力结果/解析 | 同页提交状态、`mode=result` → `ListeningResultPage`，`mode=review` → `ListeningExplanation`，`AnswerReview`；`mode=listen`/侧栏调用 `ListeningIntensive` | 最近结果来自正式成绩，不改草稿。详解读实际题源，精听用音频和句时间 | VERIFIED 题库详解可不答就看。全局某次 `/records/:id` 仅用历史判分，不加载听力题面或解析。后续诊断适合具体尝试结果及历史，每条绑定原 record ID |
| 阅读目录/季度阅读 `/library` | `Library.tsx`，得分页浮层 | 默认索引/可选目录，成绩、草稿、计划 query | VERIFIED 筛分篇/进度/搜索/排序，练习、续做、背题、得分历史、回放。没有另一个独立季度数据加载器。PDF 可参考 |
| 阅读答题 `/reading/:bankId/:examId` | `ReadingPractice` 是 `ReadingWorkspace` 别名，`OpenReading/ReadingAttempt/ReadingPaper/ReadingNotes/ReadingDictionary` | `readingAsset`、`open_reading_draft`，React state 和写者事务 | VERIFIED 读/答、计时、高亮、笔记、字典、提交渲染本次结果。接入候选 `ReadingAttempt.submit` 的 `await desktop.saveRecord` 成功分支 |
| 阅读详解/回放 | `mode=study` 读题库，`mode=replay&record=<id>` 进 `ReadingReplay`，`AnswerReview`/`ReadingTimingPanel` | 题库/记录/复习计划/批注，基于 ID | VERIFIED 显示原卷和本次答案、证据定位、保存批注、复习反馈；后续报告可与题库解析并列，不覆盖解析或个人笔记 |
| 口语目录和对话 `/speaking?part=<n>&topic=<part:id>` | `SpeakingBank.tsx::SpeakingBank/SpeakingDetail`、`SpeakingPractice.tsx`、`SpeakingMessages` | 目录、活动模型、设置、会话 query，播放/录音状态和 TTS Worker | VERIFIED 分类、Cue Card、AI 考官、文字/按住录音、确认发送和追问。后续诊断可读已结束会话。季度口语 `/speaking-practice` 仅空状态 |
| 口语历史 `/records/speaking/:id` | `Records.tsx::SpeakingRecordDetail/SpeakingRecordReview` | 会话集合查 ID，只展示符合完成条件者，音频 IPC | VERIFIED 文本和录音回放/Markdown 导出。此页对考官使用显示文本路径。后续可挂证据化反馈和分项分析 |
| 写作 `/writing-practice?task=1` 或 `2`，详情 `folder/question/mode=model` | `WritingPractice.tsx` → `WritingExercise.tsx`，`WritingText` | 目录 query、写作提交 query、媒体 bytes，编辑器与计时组件状态 | VERIFIED 题型话题筛选、题面图、范文、计词、提交/重新作答。接入候选 `save.onSuccess(_, value)` 使用 value.id。无写作批改页 |
| 写作历史 `/records/writing/:id` | `Records.tsx::WritingRecordDetail` | 写作提交集合按 document ID 查 | VERIFIED 展示当次原文及提交信息、导出 Markdown。该全局历史页并不加载同题资源；需另按 Task/ID 回溯。报告/逐句定位都未接入 |
| 总览、历史 `/`、`/records`、`/records/:id` | `StudyViews/Overview/LearningActivity/Achievements`、`Records/RecordDetail/RecordAnswers` | 三路记录查询、题库进度，在前端投影。URL 路由/组件内科目和搜索，热图范围为客户端状态 | VERIFIED 提交次数、题库进度、时间热图、成就、历史与导出/删除。练习经验是折叠空状态，适合经验摘要入口 |
| AI考官 · 学习诊断 `/ai-examiner/diagnosis` | `src/app/App.tsx:320–322` 内联 section | 无业务请求/状态 | NOT_IMPLEMENTED UI 只有「暂无学习诊断」。可承接多科时间范围、报告入口；当前没有数据协议 |
| AI考官 · 针对训练 `/ai-examiner/training` | `src/app/App.tsx:323–325` 内联 section | 无业务请求/状态 | NOT_IMPLEMENTED UI 只有「暂无针对训练」。训练推荐、训练任务、作答与复测都未接入 |
| Prompt、模型、考试目标 | `/prompts`、`/settings/ai-models`、`/settings/logs` | `PromptDocuments`、`AiModelSettings`、`LogSettings/ExamPlanSettings` | VERIFIED Prompt 编辑、模型切换、日志及目标。不是诊断配置界面。`/pronunciation` 也是占位 |

主要路由和导航为 `src/app/App.tsx:41–80,295–345`。进入详情的常用查询键见 `Listening.tsx:26–93`、`ReadingWorkspace.tsx:15–75`、`SpeakingBank.tsx:51–80`、`WritingPractice.tsx:52–111`。各子组件及持久化链见 [听力](02_LISTENING_MODULE.md)、[阅读](03_READING_MODULE.md)、[口语](04_SPEAKING_MODULE.md)、[写作](05_WRITING_MODULE.md)。

## 四科分析交接点比较

| 科目 | 现有一次练习的完成条件 | 正式写入后可获取 | 实际边界缺失 |
|---|---|---|---|
| 听力 | `commit_listening_section` 承认最后草稿并事务写分 | 尝试 UUID、十项判分、答卷、bank/exam、用时。当前题库可补答案源、字幕/图片/音频 | 无稳定问题到录音句关系，题库同节最新的回看与全局指定历史是两种入口 |
| 阅读 | `save_record` 成功返回成绩，原草稿和写者清理 | UUID、单篇 ID、判分、冻结答案、部分时长与批注。到当前题源找原文与解析 | 前台时长不能当阅读效率标定，旧导入可能少字段 |
| 口语 | `save_speaking_session` 从进行中进入 finished，且有用户消息 | UUID、时间、题目 ID、逐轮问题/答复、可选录音引用 | 文本和录音证据可不完整；独立语音分析仍需建设；切换回来不得再次算完成 |
| 写作 | `put_document(writing-submissions)` 确认成功 | UUID、正文与 Task/ID；当前题库中的 prompt、图片和范文 | 无已保存用时或正式训练模式，视觉通道缺失 |

这些是接入候选位置。源代码未增加监听器、任务队列、UI 报告或接口。本次可验证的历史材料范围见 [数据库](06_DATABASE_AND_HISTORY.md)。
