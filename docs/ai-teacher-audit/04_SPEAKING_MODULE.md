# 口语题库、语音和评分能力

## 真实话题数据

**VERIFIED** 默认 `data/speaking/Part {1,2,3}/artifex-part-{n}.json`，三份 `format:"ietls4pass-speaking-v1"`，根 `part:number`、`source:"Artifex / ielts_with_questions.json"`、`topics[]`。实查 62/64/64，共 190。Part 2 实样普遍带字符串 Cue Card，不是拆分的标题/子问题结构。`questions[]` 可为空（如 `artifex-8520`），由题卡构成有效输入。Part 1/3 是问题数组；未发现参考答案字段。根源与话题的 `book/difficulty` 为标签，没有独立题目版本、学季、生效期或内容 hash。用户背景描述的更上游来源和授权不由此标签证明。

```json
{
  "format":"ietls4pass-speaking-v1",
  "part":1,
  "source":"Artifex / ielts_with_questions.json",
  "topics":[{"id":"artifex-6651","category":"个人信息类","title":"Neighbours","book":"剑雅14 Test 3","questions":["[截短]"]}]
}
```

同一数据结构在 Part 2 的真实样本 `id:"artifex-8520", book:"剑雅19 Test 2", category:"人物", questions:[], cueCard:"[截短]"`，Part 3 示例 `artifex-8446` 下有 6 个问题。`SpeakingTopic.part` 由文件根层注入，`speakingTopicId(topic) = "part:id"`。`mergeSpeakingTopics` 按此标识去重，无目录 ID 命名空间，替换或重号会影响历史话题对应。`useSpeakingCatalog` 经 IPC 找 speaking 目录、扫描 revision、读与解析 JSON，支持 Part、分类、关键字。`/speaking-practice` 是季度口语空页，现有数据加载和对话在真题 `/speaking` 内。 [speaking.ts:5–57](../../src/domain/speaking.ts) · [SpeakingBank.tsx:21–136](../../src/features/SpeakingBank.tsx) · [App.tsx:312–325](../../src/app/App.tsx)

## 练习流程、计时与历史

| 能力 | 现状 |
|---|---|
| 真题、题卡 | VERIFIED 详细路由 `/speaking?part=<n>&topic=<part:id>`。Part 2 准备和长答阶段显示题卡，其余问题可通过「查看题目」展开。语音可用时，考官条以播放为主，可经右键显示文本。若不能合成，能看文字 |
| 文本作答和追问 | VERIFIED `begin → persist → ask`。`ask` 送题卡/参考问答、阶段及会话角色历史，到统一文本 IPC。`firstQuestion` 将响应转一条问题，记录 model；用户 `submit` 先落盘，再依据 `awaitingQuestion` 请求下一问。没有复用固定题库题号标记动态提问 |
| 状态和时限 | VERIFIED 本地 `speakingLimits` 为 P1 300 秒/4 答，P2 240 秒/2 次追问答（另含准备最多 60 秒，长陈述最多 120 秒），P3 300 秒/5 答。Part 1/3 从考官问题准备完起计，等待模型和文本确认可暂停。结束原因为 `time/rounds/manual`。这些轮数是本软件规则，官方页面仅用时段及形式描述，不据此认定固定轮次。[IELTS 官方口语流程](https://www.ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-speaking) |
| 麦克风和语音作答 | VERIFIED 合格活动连接下随会话准备麦克风，按住录音、松开结束。`useSpeakingRecorder` 使用 getUserMedia / AudioContext / AudioWorklet，组件停止和清理轨道。录音预览、重录和转写后编辑，再点击发送。存在失败提示和文字路径。当前不是双工流式语音 |
| 音频历史 | VERIFIED 已发送语音附存录音，`useSpeakingPlayback` 取二进制原声并通过 blob URL 播放。考官保存文字与可选 `examinerVoice`，从话题会话回看可重新合成，全局口语记录页只展示考官文字。当前数据库没有可播放的用户录音样本，实际设备播放 **UNKNOWN** |
| 历史存储与列表 | VERIFIED `SpeakingSession` 按 UUID + revision 更新，`startedAt/updatedAt`、阶段/毫秒时长、结束原因、消息数组持久化。已结束且含用户消息才算正式，含回答的历史在 `/records/speaking/:id` 展示。话题内也可切会话。退出时暂存进行中状态；临时未确认的录音与文字随组件状态存在 |
| 口语评分/建议 | NOT_IMPLEMENTED 考官提示词明确不评分，当前没有发音分析、分项评分、总体估分、建议或历史评分。发音纠正页是占位 |

代码链见 `SpeakingPractice.tsx:51–81,136–178,226–349,368–430`、`speakingPractice.ts:8–137`、`useSpeakingRecorder.ts:57–212`、`SpeakingMessages.tsx:27–161`。

## 原声、转写与 TTS

**VERIFIED** 录音是 RIFF/WAVE 单声道 PCM，16 kHz、16-bit。前端按设备采样率重采样/量化，最大 120 秒。每个语音回答记录本地计算的 `durationMs`、会话内 `elapsedMs` 和 `audioId`；文本回答的 durationMs 是两次状态之间的活动时间，不能当语音时长。`sendAudio` 传 Uint8Array 到 Rust，`llm/asr.rs::transcribe_speaking_audio` 要求活动连接为 DeepSeek 官方 HTTPS，整段 WAV multipart 发至公开 ASR 端点，Rust 只解析 `text`。接口虽文档提供请求 ID 和服务端时长，当前实现均丢弃。未锁定转写模型版本，服务内部模型为 **UNKNOWN**。未接置信度、逐词/逐句时间戳、对齐、停顿记录。 [ASR 源码](../../src-tauri/src/llm/asr.rs) · [DeepSeek ASR 官方接口](https://api-docs.deepseek.com/api/asr/)

**VERIFIED** 确认发送才把 `SpeakingMessage.content`（可人工校对的最终转写）与 `audioId` 一起保存。原始转写与修订 diff 没有分别保存。音频存于 SQLite `workspace_documents/speaking-audio` 的 `{sessionId,wav}`，Base64，没有每段音频文件路径。`save_speaking_session` 校验版本/音频归属并用事务写消息和录音；`read_speaking_audio` 核对会话中引用再返回二进制。音频引用能确定到消息和会话题目；当前没有独立问答 ID/音频对齐，按消息顺序与阶段归因。备份含录音附件。 [store/speaking.rs:20–152](../../src-tauri/src/store/speaking.rs)

**VERIFIED** 考官 TTS 用 Kokoro（浏览器 Worker 中 ONNX Runtime Web + phonemizer）优先，系统 SpeechSynthesis 为回退；这是读出模型生成的问题。保存的是音色选择，不是考官 PCM。当前目录存在 Kokoro 子目录，模型品质、延迟与当前进程实际选择未运行验证。[SpeakingPractice.tsx:189–269](../../src/features/SpeakingPractice.tsx) · [kokoroSpeech.ts](../../src/services/kokoroSpeech.ts) · [kokoro.worker.ts](../../src/services/kokoro.worker.ts)

## 评分证据边界及接入

官方 Speaking 分为流利度与连贯性、词汇、语法、发音四个等权维度，单个 Part 证据不涵盖全场。已存在 `data/skill-docs/ielts-speaking-ai-teacher.md`，含四维标准、证据约束和示例，尚未接入模型，也没有运行时评分表。当前文本可评价词汇、语法、话题切合和部分结构连贯。有原声才可能评估可懂度、重音、节奏、发音和明显停顿，需真实音频分析或合格的特征提取。不能从转写错误推理发音等级，也不能将“等待 ASR/LLM 时长”解释为考生停顿。[IELTS 评分口径](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail) · [官方 Speaking Band Descriptors](https://ielts.org/cdn/ielts-guides/ielts-speaking-band-descriptors.pdf)

**PARTIAL 接入可能性** 以 `saveSpeakingSession` 成功返回后刚从非 finished 变 finished，且 `isSubmittedSpeakingSession` 成立为共同完成边界，覆盖手动结束、时间和轮次。以 session UUID 回读消息，再用 topicId 加载当前资料、逐条通过 audioId 读取录音。显示位置适合结束态及 `SpeakingRecordDetail`。实践时须避免重复返回时反复请求；录音历史、原始转写、模型评分要求的音频能力、隐私同意均是独立约束。本机样本五场只有考官，无法用以验收用户音频和评分。
