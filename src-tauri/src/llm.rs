// 2026-11-21：业务只依赖文本请求与结果，连接配置由服务在请求开始时加载。
// 2026-11-22：业务请求只提供文档标识和模板使用的值。
use std::{collections::BTreeMap, time::Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::store::{ai_models::load_text_model, Database};
// 2026-11-22：每次调用从 Prompt 文档加载当前内容。
use crate::store::prompts::{self, PromptDocuments, MODEL_TEST_PROMPT, SYSTEM_PROMPT};

mod openai_compatible;
// 2026-11-21：语音转写与文本模型调用分离。
pub mod asr;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GenerationParameters {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<Thinking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<ReasoningEffort>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Thinking {
    #[serde(rename = "type")]
    mode: ThinkingMode,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ThinkingMode {
    Enabled,
    Disabled,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ReasoningEffort {
    None,
    Minimal,
    Low,
    Medium,
    High,
    Max,
    Xhigh,
    Ultra,
}

impl GenerationParameters {
    pub(crate) fn from_json(value: Value) -> Result<Self, String> {
        if !value.is_object() {
            return Err("默认生成参数必须是 JSON 对象。".into());
        }
        let params: Self = serde_json::from_value(value).map_err(|_| {
            "默认参数格式有误。支持 temperature、top_p、max_tokens、thinking 和 reasoning_effort。".to_string()
        })?;
        if params.temperature.is_some_and(|value| !(0.0..=2.0).contains(&value))
            || params.top_p.is_some_and(|value| !(0.0..=1.0).contains(&value))
            || params.max_tokens == Some(0) {
            return Err("temperature 应为 0–2，top_p 应为 0–1，max_tokens 应为正整数。".into());
        }
        Ok(params)
    }
}

// 2026-11-21：运行时连接只在 Rust 内部使用，密钥不序列化至前端。
pub(crate) struct TextModel {
    pub(crate) base_url: String,
    pub(crate) model: String,
    // 2026-11-21：运行时连接采用与 SQLite 读写一致的超时类型。
    pub(crate) timeout_seconds: u32,
    pub(crate) parameters: GenerationParameters,
    pub(crate) api_key: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TextRole {
    System,
    User,
    Assistant,
}

#[derive(Deserialize, Serialize)]
pub struct TextMessage {
    pub role: TextRole,
    pub content: String,
}

// 2026-11-22：入口可按序叠加多个文档，业务消息只携带本轮数据。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRequest {
    #[serde(default)]
    prompt_ids: Vec<String>,
    #[serde(default)]
    variables: BTreeMap<String, String>,
    #[serde(default)]
    messages: Vec<TextMessage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextCompletion {
    pub content: String,
    pub model: String,
    pub finish_reason: Option<String>,
}

// 2026-11-21：写作、口语等业务可调用此入口，每次读取当前已保存的连接。
// 2026-11-22：仅模型服务内部能发送已组合的完整提示词。
async fn generate_text(db: &Database, messages: &[TextMessage]) -> Result<TextCompletion, String> {
    if !messages.iter().any(|message| !message.content.trim().is_empty()) {
        return Err("请提供要发送给文本模型的消息。".into());
    }
    let profile = load_text_model(db, None)?;
    let reply = openai_compatible::complete(&profile, messages, &profile.parameters).await?;
    let content = reply.content.ok_or_else(|| {
        if reply.finish_reason.as_deref() == Some("length") {
            "回复达到输出长度上限，请增加 max_tokens 后重试。".to_string()
        } else {
            "文本模型未返回可用的正文。".to_string()
        }
    })?;
    Ok(TextCompletion { content, model: reply.model, finish_reason: reply.finish_reason })
}

#[tauri::command]
// 2026-11-22：统一加载系统文档与指定业务文档，再发送会话消息。
pub async fn generate_llm_text(
    app: AppHandle, db: State<'_, Database>, prompt_files: State<'_, PromptDocuments>, request: TextRequest,
) -> Result<TextCompletion, String> {
    if request.messages.iter().any(|message| matches!(&message.role, TextRole::System)) {
        return Err("系统提示词请通过 Prompt 文档配置。".into());
    }
    let ids = std::iter::once(SYSTEM_PROMPT).chain(request.prompt_ids.iter().map(String::as_str));
    let system = prompts::compose(&app, prompt_files.inner(), ids, &request.variables)?;
    let mut messages = Vec::with_capacity(request.messages.len() + 1);
    if !system.is_empty() {
        messages.push(TextMessage { role: TextRole::System, content: system });
    }
    messages.extend(request.messages);
    generate_text(db.inner(), &messages).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTest {
    model: String,
    elapsed_ms: u64,
    has_text: bool,
}

// 2026-11-21：连接测试通过相同的文本接口验证指定连接，使用固定短消息。
#[tauri::command]
// 2026-11-22：连接测试也从 Markdown 读取提示词，保留测试所选连接的行为。
pub async fn test_ai_model(
    app: AppHandle, db: State<'_, Database>, prompt_files: State<'_, PromptDocuments>, id: i64,
) -> Result<ModelTest, String> {
    let profile = load_text_model(db.inner(), Some(id))?;
    // 2026-11-22：只使用模型连通性测试专用文档。
    let content = prompts::compose(&app, prompt_files.inner(), [MODEL_TEST_PROMPT], &BTreeMap::new())?;
    if content.is_empty() { return Err("AI 模型连接测试提示词为空。".into()); }
    let messages = [TextMessage { role: TextRole::User, content }];
    let mut parameters = profile.parameters.clone();
    parameters.max_tokens = Some(256);
    let started = Instant::now();
    let reply = openai_compatible::complete(&profile, &messages, &parameters).await?;
    let has_text = reply.content.is_some();
    if !has_text && !reply.has_reasoning {
        return Err("模型已响应，但测试未收到正文或推理内容。".into());
    }
    Ok(ModelTest { model: reply.model, elapsed_ms: started.elapsed().as_millis() as u64, has_text })
}
