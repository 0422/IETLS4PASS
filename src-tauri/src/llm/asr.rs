// 2026-11-21：将口语录音交给 DeepSeek 官方转写接口，文本模型仍走原调用层。
use std::time::Duration;

use reqwest::{multipart::{Form, Part}, redirect::Policy, Client};
use serde::Deserialize;
use tauri::{ipc::{InvokeBody, Request}, State, Url};

use crate::store::{ai_models::load_text_model, Database};

#[derive(Deserialize)]
struct Transcription {
    text: String,
}

#[tauri::command]
pub async fn transcribe_speaking_audio(db: State<'_, Database>, request: Request<'_>) -> Result<String, String> {
    let profile = load_text_model(db.inner(), None)?;
    let url = Url::parse(&profile.base_url).map_err(|_| "语音转写连接地址无效。".to_string())?;
    if url.scheme() != "https" || url.host_str() != Some("api.deepseek.com") || url.port_or_known_default() != Some(443) {
        return Err("语音转写需要启用 DeepSeek 官方连接。你也可以使用文字回答。".into());
    }
    let key = profile.api_key.ok_or("请先为 DeepSeek 连接配置 API Key。")?;
    let audio = match request.body() {
        InvokeBody::Raw(bytes) if bytes.len() > 44 && bytes.len() <= 44 + 120 * 16_000 * 2
            && bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE".as_slice()) => bytes.clone(),
        _ => return Err("录音无效，或超过单次 2 分钟限制。".into()),
    };
    let part = Part::bytes(audio).file_name("answer.wav").mime_str("audio/wav")
        .map_err(|_| "无法准备录音。".to_string())?;
    let client = Client::builder().timeout(Duration::from_secs(u64::from(profile.timeout_seconds)))
        .redirect(Policy::none()).build().map_err(|_| "无法初始化语音转写。".to_string())?;
    let response = client.post("https://api.deepseek.com/v1/tools/asr").bearer_auth(key)
        .multipart(Form::new().part("file", part)).send().await.map_err(|error| {
            if error.is_timeout() { "语音转写超时。".to_string() } else { "无法连接语音转写服务。".to_string() }
        })?;
    if !response.status().is_success() {
        return Err(format!("语音转写服务返回 HTTP {}。", response.status().as_u16()));
    }
    let result: Transcription = response.json().await.map_err(|_| "语音转写响应格式无效。".to_string())?;
    let text = result.text.trim();
    if text.is_empty() { return Err("未识别出回答，请重录或输入文字。".into()); }
    Ok(text.to_owned())
}
