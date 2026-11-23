// 2026-11-21：将 OpenAI 兼容请求、鉴权、超时和响应解析集中在适配器。
use std::time::Duration;

use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};

use super::{GenerationParameters, TextMessage, TextModel};

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: &'a [TextMessage],
    stream: bool,
    #[serde(flatten)]
    parameters: &'a GenerationParameters,
}

#[derive(Deserialize)]
struct ChatResponse {
    model: Option<String>,
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct Message {
    content: Option<String>,
    reasoning_content: Option<String>,
}

pub(super) struct Reply {
    pub(super) content: Option<String>,
    pub(super) model: String,
    pub(super) finish_reason: Option<String>,
    pub(super) has_reasoning: bool,
}

fn request_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "文本模型请求超时。".into()
    } else if error.is_connect() {
        "无法连接模型服务，请检查 API 根地址与网络。".into()
    } else {
        "文本模型请求失败。".into()
    }
}

pub(super) async fn complete(
    profile: &TextModel,
    messages: &[TextMessage],
    parameters: &GenerationParameters,
) -> Result<Reply, String> {
    let client = Client::builder()
        // 2026-11-21：构造 HTTP 超时时间时，将秒数无损扩展为 u64。
        .timeout(Duration::from_secs(u64::from(profile.timeout_seconds)))
        .redirect(Policy::none())
        .build()
        .map_err(|_| "无法初始化文本模型连接。".to_string())?;
    let url = format!("{}/chat/completions", profile.base_url.trim_end_matches('/'));
    let mut request = client.post(url).json(&ChatRequest { model: &profile.model, messages, stream: false, parameters });
    if let Some(key) = &profile.api_key {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(request_error)?;
    let status = response.status();
    // 2026-11-21：上游错误正文可能回显业务消息或凭据，仅将状态码交给调用方。
    if !status.is_success() {
        let reason = match status.as_u16() {
            401 | 403 => "请检查 API Key 与模型权限",
            404 => "请检查 API 根地址与模型名称",
            429 => "已达到服务限额，请检查额度或稍后重试",
            _ => "请检查模型配置与服务状态",
        };
        return Err(format!("模型服务返回 HTTP {}，{reason}。", status.as_u16()));
    }
    let body: ChatResponse = response.json().await.map_err(|error| {
        if error.is_timeout() { request_error(error) } else { "模型响应的格式不是标准的文本补全。".into() }
    })?;
    let choice = body.choices.into_iter().next().ok_or("模型响应未包含补全结果。")?;
    Ok(Reply {
        content: choice.message.content.filter(|value| !value.trim().is_empty()),
        model: body.model.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| profile.model.clone()),
        finish_reason: choice.finish_reason,
        has_reasoning: choice.message.reasoning_content.is_some_and(|value| !value.trim().is_empty()),
    })
}
