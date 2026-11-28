# AI、LLM、Prompt 与评分规范

## 已接入的调用链

| 入口 | 请求与来源 | 实际输出和落盘 |
|---|---|---|
| 口语考官 | VERIFIED `SpeakingPractice.ask → desktop.generateText(examinerRequest(topic, session)) → generate_llm_text → compose → generate_text → openai_compatible::complete`。题目标题、Part 2 Cue Card、参考问题、阶段和往返文本作为上下文 | `{content,model,finishReason}`，前端用 `firstQuestion` 取一个问题。SQLite 只存对话消息、实际模型名及回合状态，未保存完整 prompt、请求信息或诊断 |
| 连通性测试 | VERIFIED `AiModelSettings` → `desktop.testAiModel(id)` → 选定连接的相同适配器，读取 `model-connection-test.md` 为 user message，覆盖 max_tokens=256 | `{model,elapsedMs,hasText}`。只展示测试状态，无评分。适配器能检测 reasoning_content 是否非空，业务未使用推理正文 |
| 语音转写 | VERIFIED `SpeakingPractice.sendAudio` → `transcribe_speaking_audio` → DeepSeek 固定 HTTPS ASR，Bearer 与 WAV multipart，一整个文件一次请求 | 适配器仅反序列化 `{text}`。用户确认后提交文本与录音。不是 chat 多模态，也不返回时间戳或置信度 |
| 语音合成 | VERIFIED `SpeakingPractice.play` → `createKokoroSpeech`（本地 Worker / 量化 ONNX / phonemizer / 音色权重），失败可回退系统 SpeechSynthesis | 运行时音频，无评分服务。真实目录存在 config、tokenizer、量化模型及 bf_emma/bm_george 两个权重。实际推理和质量 **UNKNOWN** |

主要文件为 `src-tauri/src/llm.rs`:20–74,88–183、`llm/openai_compatible.rs`:10–90、`llm/asr.rs`:10–44、`store/ai_models.rs`:53–191、`src/services/desktop.ts`:101–120,215–230。文本和测试重用同一个传输适配器；ASR 复用当前连接/凭据和超时配置，但使用自己的协议实现。没有第二套写作、听读或教师 LLM 调用。ASR 说明只核对公开文档，未实际发送音频。[DeepSeek ASR 文档](https://api-docs.deepseek.com/guides/asr/)

## 配置、安全与功能覆盖

**VERIFIED** 前端可增删连接、选择活动连接与变体、编辑生成参数和测试。首个连接可成为活动连接。模型接口通用地支持配置的 HTTP(S) 根地址，Rust 拼接 `/chat/completions`，发送 model/messages/stream:false 和放行的 `temperature/top_p/max_tokens/thinking/reasoning_effort`。每次请求加载当前活动配置和当前 Prompt 副本，释放 DB 锁后联网，因此下次可热切换。请求中途不会自动改用新模型。实际用户模型、URL 和密钥本次未读取，活动模型可用程度为 **UNKNOWN**。`ai_models.rs`:72–171、`llm.rs`:122–155。

| 项目 | 审计状态 |
|---|---|
| 文本约定 | VERIFIED 消息只含 `role` 和字符串 `content`。前端业务不允许传 system 消息，服务从文档生成 system，并追加 user/assistant。适配器只读第一个 choice |
| 结构化输出、JSON Schema、函数调用 | NOT_IMPLEMENTED 请求范围不含 response_format、tools/tool_calls 或 JSON 校验。连接参数本身有 serde 字段与范围校验，不是教师输出 Schema。教师原型里的 JSON 是示例 |
| 流式、取消 | NOT_IMPLEMENTED 明确 stream:false。离开页面当前仅阻止把后续回调应用到已卸载 UI，未取消已经发送的 HTTP 推理。Rust 请求禁用重定向 |
| 超时、错误、重试 | VERIFIED 单请求超时 5–600 秒（默认 120），映射 HTTP 401/403/404/429 等，避免把上游错误正文交给界面。PARTIAL UI 可再次操作。适配器无自动重试、退避、熔断、稳定请求 ID |
| 多模态 | NOT_IMPLEMENTED 文本 API 无图片、音频消息或附件。独立 ASR 收音频仅做转写。模型供应商能力不能由当前 UI 或设置推知 |
| Token、成本、缓存 | NOT_IMPLEMENTED 响应不读 usage，无 token/费用汇总、调用缓存或 Prompt 分段裁剪。max_tokens 只控制生成上限；本地 TTS 资源的复用不是 LLM 结果缓存 |
| 密钥、诊断 | VERIFIED 密钥存 SQLite `ai_model_credentials.api_key TEXT`，源码没有应用层加密或系统密钥环。连接列表用 hasApiKey 表示，保存表单留空保留旧值。通用导出和诊断排除凭据表，诊断只记录操作/结果/时间。文本配置允许普通 HTTP，提供商可收到用户发送内容，明文链路与授权需后续审视 |
| 结果及版本 | PARTIAL 口语问题文字和模型名落在会话，模型连通性仅返回状态。NOT_IMPLEMENTED 无评估结果、分析版本、Prompt 版本历史、来源证据、运行记录。Markdown hash revision 只用于检测编辑冲突，不固定历史请求 |

## 实际 Prompt 和未接入资源

**VERIFIED** 开发/本机默认有 `data/prompts/system.md`、`data/prompts/speaking-examiner.md`、`data/prompts/model-connection-test.md`。内嵌种子路径同名，位于 `src-tauri/default-prompts/`。正式版 Prompt 默认目录为应用数据目录下的 `data/prompts`，可由资源设置覆盖。读取时仅补缺失默认文件。`PromptDocuments` 支持预览或编辑保存。`compose(ids, variables)` 在同一锁内按序去重、读当前 Markdown、替换 `{{variable}}`、拼段，缺模板变量返回错误。普通业务自动加载 system；连通性测试只取 test 文档。具体完整文档与两份教师原型见 [关键源码摘录的 Prompt 附录](11_KEY_SOURCE_EXTRACTS.md#prompt-附录)。文件默认值与本机生效路径结论见 `store/prompts.rs:45–167` 和 `store/resources.rs:30–60`。

**VERIFIED 有文档，NOT_IMPLEMENTED 调用** `data/skill-docs/ielts-speaking-ai-teacher.md` 与 `data/skill-docs/ielts-writing-ai-teacher.md` 有诊断、训练、复测、报告字段和官方引用。此目录不在 `resources.rs::KINDS`，源码搜索未发现加载/调用。原型中的评分和训练模式、可用 JSON 返回示例、建议调用参数属于设计内容。项目的实际 Prompt 和模型请求层不执行这些步骤。

**VERIFIED 外部规范参照** 官方口语四项等权，写作分别在 Task 1 和 Task 2 用四项标准，Task 2 权重较高。与单节听力、单篇阅读的客观得分区分。官方 PDF 链接在原型内，运行模型路径没有官方评分文件引用、下载或版本固化。已核对可访问的公开说明，未将整张 band 表转存于报告。 [IELTS 评分细则](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail) · [口语描述](https://ielts.org/cdn/ielts-guides/ielts-speaking-band-descriptors.pdf) · [写作描述](https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf)
