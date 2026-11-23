// 2026-11-23：管理本机资源路径，所有桌面读取都按当前生效目录定位相对文件。
use std::{fs, io::Read, path::{Component, Path, PathBuf}};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
// 2026-11-23：工作线程通过应用句柄获取数据库。
use tauri::{http::{Method, Request, Response, StatusCode}, AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use super::{bank, message, CommandResult, Database};

const KINDS: [&str; 8] = ["reading", "listening", "speaking", "writing", "vocabulary", "notes", "prompts", "kokoro"];
const WORD_FILES: [&str; 4] = ["ielts_core.json", "ielts_538.json", "awl.json", "ecdict.json"];
const MODEL_FILES: [&str; 6] = [
    "config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx",
    "voices/bf_emma.bin", "voices/bm_george.bin",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDirectory {
    kind: String,
    path: String,
    default_path: String,
    overridden: bool,
    available: bool,
    bundled: bool,
}

fn validate_kind(kind: &str) -> CommandResult<()> {
    if KINDS.contains(&kind) { Ok(()) } else { Err("未知的资源类型。".into()) }
}

pub(super) fn default_directory(_app: &AppHandle, kind: &str) -> CommandResult<PathBuf> {
    #[cfg(not(debug_assertions))]
    if matches!(kind, "notes" | "prompts") {
        return Ok(_app.path().app_data_dir().map_err(message)?.join("data").join(kind));
    }
    let base = bank::program_directory().ok_or("找不到程序目录。")?;
    // 2026-11-23：模型文件按 data/models/kokoro 定位，其他资源使用各自 data 子目录。
    let data = base.join("data");
    Ok(if kind == "kokoro" { data.join("models").join("kokoro") } else { data.join(kind) })
}

pub(super) fn configured_directory(connection: &Connection, kind: &str) -> CommandResult<Option<PathBuf>> {
    let root: Option<String> = connection.query_row(
        "SELECT root FROM resource_directories WHERE kind = ?1", [kind], |row| row.get(0),
    ).optional().map_err(message)?;
    Ok(root.map(PathBuf::from))
}

pub(super) fn override_directory(app: &AppHandle, kind: &str) -> CommandResult<Option<PathBuf>> {
    // 2026-11-23：窗口初始化时发起的只读请求也可使用默认资源。
    let Some(db) = app.try_state::<Database>() else { return Ok(None); };
    // 2026-11-23：通过 Tauri State 的公开入口取到实际数据库对象。
    if db.inner().0.is_none() { return Ok(None); }
    // 2026-11-23：显式绑定锁守卫，使它先于持有数据库引用的 Tauri State 释放。
    let connection = db.lock()?;
    configured_directory(&connection, kind)
}

fn desktop_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(share) = value.strip_prefix(r"\\?\UNC\") { return format!(r"\\{share}"); }
    value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
}

fn directory_info(app: &AppHandle, connection: &Connection, kind: &str) -> CommandResult<ResourceDirectory> {
    let default = default_directory(app, kind)?;
    let custom = configured_directory(connection, kind)?;
    let root = custom.as_deref().unwrap_or(&default);
    let available = root.is_dir();
    let bundled = !cfg!(debug_assertions) && custom.is_none() && !available && matches!(kind, "reading" | "vocabulary" | "kokoro");
    Ok(ResourceDirectory {
        kind: kind.into(), path: desktop_path(root), default_path: desktop_path(&default),
        overridden: custom.is_some(), available, bundled,
    })
}

#[tauri::command]
// 2026-11-23：检查外置目录状态时在工作线程访问文件系统。
pub async fn list_resource_directories(app: AppHandle) -> CommandResult<Vec<ResourceDirectory>> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Database>();
        let connection = db.lock()?;
        KINDS.into_iter().map(|kind| directory_info(&app, &connection, kind)).collect()
    }).await.map_err(message)?
}

fn enclosed_file(root: &Path, relative: &str) -> CommandResult<PathBuf> {
    let relative_path = Path::new(relative);
    if relative.is_empty() || relative.contains(['\\', ':']) || !relative_path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err("资源路径不合法。".into());
    }
    let path = fs::canonicalize(root.join(relative_path)).map_err(message)?;
    if !path.starts_with(root) || !path.is_file() { return Err("文件不在当前资源目录内。".into()); }
    Ok(path)
}

fn read_file(root: &Path, relative: &str, limit: u64) -> CommandResult<Vec<u8>> {
    let file = fs::File::open(enclosed_file(root, relative)?).map_err(message)?;
    if file.metadata().map_err(message)?.len() > limit { return Err("资源文件超过读取上限。".into()); }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(message)?;
    if bytes.len() as u64 > limit { return Err("资源文件超过读取上限。".into()); }
    Ok(bytes)
}

// 2026-11-23：目录确认和静态资源统一按 UTF-8 JSON 校验。
pub(super) fn json_file(root: &Path, relative: &str) -> CommandResult<Value> {
    let bytes = read_file(root, relative, 32 * 1024 * 1024)?;
    serde_json::from_slice(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes)).map_err(message)
}

fn validate_directory(kind: &str, root: &Path) -> CommandResult<()> {
    if !root.is_dir() { return Err("请选择一个资源目录。".into()); }
    match kind {
        "reading" => {
            let index = json_file(root, "index.json")?;
            if index["schemaVersion"] != "IETLS4PASSBankV1" {
                return Err("阅读目录需要 IETLS4PASSBankV1 格式的索引。".into());
            }
            let entries = index["entries"].as_array().filter(|items| !items.is_empty()).ok_or("阅读目录需要包含有效的 index.json。")?;
            for entry in entries {
                let id = entry["examId"].as_str().filter(|id| !id.is_empty() && !id.contains(['/', '\\', ':']))
                    .ok_or("阅读索引有无效的篇目编号。")?;
                enclosed_file(root, &format!("reading/{id}.json")).map_err(|_| format!("缺少索引中的阅读题目 {id}。"))?;
            }
        }
        "listening" | "speaking" | "writing" => bank::validate_subject_directory(kind, root)?,
        "vocabulary" => {
            for name in WORD_FILES {
                let data = json_file(root, name).map_err(|error| format!("{name} · {error}"))?;
                let valid = match name {
                    "ielts_538.json" => data["words"].is_array() && data["notes"].is_object(),
                    "ecdict.json" => data["entries"].is_object(),
                    _ => data.is_array(),
                };
                if !valid { return Err(format!("{name} 的词表结构无效。")); }
            }
        }
        "kokoro" => {
            for name in MODEL_FILES {
                let file = enclosed_file(root, name).map_err(|_| format!("Kokoro 目录缺少 {name}。"))?;
                let length = fs::metadata(file).map_err(message)?.len();
                if length == 0 || (name.starts_with("voices/") && length != 522_240) {
                    return Err(format!("Kokoro 文件 {name} 的大小无效。"));
                }
            }
            if json_file(root, "config.json")?["model_type"] != "style_text_to_speech_2" {
                return Err("Kokoro 模型配置与当前推理接口不匹配。".into());
            }
        }
        _ => {}
    }
    Ok(())
}

fn change_directory(app: &AppHandle, kind: &str, custom: Option<PathBuf>) -> CommandResult<ResourceDirectory> {
    let db = app.state::<Database>();
    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    let default = default_directory(app, kind)?;
    let previous = configured_directory(&transaction, kind)?.unwrap_or_else(|| default.clone());
    let next = custom.as_deref().unwrap_or(&default);
    // 2026-11-23：默认题库文件尚未放好时也能清除手动路径。
    if matches!(kind, "listening" | "speaking" | "writing") {
        bank::set_subject_directory(&transaction, kind, &previous, next)?;
    }
    if let Some(root) = &custom {
        let root = root.to_str().ok_or("目录名称无法保存。")?;
        transaction.execute(
            "INSERT INTO resource_directories(kind, root) VALUES (?1, ?2)
             ON CONFLICT(kind) DO UPDATE SET root = excluded.root", params![kind, root],
        ).map_err(message)?;
    } else {
        transaction.execute("DELETE FROM resource_directories WHERE kind = ?1", [kind]).map_err(message)?;
    }
    let result = directory_info(app, &transaction, kind)?;
    transaction.commit().map_err(message)?;
    Ok(result)
}

#[tauri::command]
pub async fn choose_resource_directory(app: AppHandle, kind: String) -> CommandResult<Option<ResourceDirectory>> {
    validate_kind(&kind)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app.dialog().file().blocking_pick_folder() else { return Ok(None); };
        let root = fs::canonicalize(selected.into_path().map_err(message)?).map_err(message)?;
        validate_directory(&kind, &root)?;
        // 2026-11-23：直接选择默认路径时与恢复默认采用相同的配置。
        let is_default = fs::canonicalize(default_directory(&app, &kind)?).ok().as_ref() == Some(&root);
        change_directory(&app, &kind, (!is_default).then_some(root)).map(Some)
    }).await.map_err(message)?
}

#[tauri::command]
pub async fn reset_resource_directory(app: AppHandle, kind: String) -> CommandResult<ResourceDirectory> {
    validate_kind(&kind)?;
    tauri::async_runtime::spawn_blocking(move || change_directory(&app, &kind, None)).await.map_err(message)?
}

// 2026-11-23：只通过只读协议提供题库格式、词表和模型文件，绝对路径只在本机管理端使用。
fn decode_path(path: &str) -> Option<String> {
    let mut decoded = Vec::with_capacity(path.len());
    let mut bytes = path.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let high = (bytes.next()? as char).to_digit(16)?;
            let low = (bytes.next()? as char).to_digit(16)?;
            decoded.push((high * 16 + low) as u8);
        } else {
            decoded.push(byte);
        }
    }
    String::from_utf8(decoded).ok()
}

fn asset_type(kind: &str, relative: &str) -> Option<&'static str> {
    match kind {
        "vocabulary" if WORD_FILES.contains(&relative) => Some("application/json"),
        "kokoro" if MODEL_FILES.contains(&relative) => Some(if relative.ends_with(".json") {
            "application/json"
        } else { "application/octet-stream" }),
        "reading" if relative == "index.json" || (relative.starts_with("reading/") && relative.ends_with(".json")) => Some("application/json"),
        "reading" if relative.starts_with("media/") => match Path::new(relative).extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "png" => Some("image/png"),
            "jpg" | "jpeg" => Some("image/jpeg"),
            "webp" => Some("image/webp"),
            "avif" => Some("image/avif"),
            "gif" => Some("image/gif"),
            "svg" => Some("image/svg+xml"),
            _ => None,
        },
        _ => None,
    }
}

fn asset_bytes(app: &AppHandle, kind: &str, relative: &str) -> CommandResult<Vec<u8>> {
    if relative.contains(['\\', ':']) || !Path::new(relative).components().all(|c| matches!(c, Component::Normal(_))) {
        return Err("资源路径不合法。".into());
    }
    let custom = override_directory(app, kind)?;
    let default = default_directory(app, kind)?;
    let root = custom.as_deref().unwrap_or(&default);
    if !cfg!(debug_assertions) && custom.is_none() && !root.is_dir() {
        let bundle = if kind == "kokoro" { "tts/kokoro".to_string() } else { format!("data/{kind}") };
        return app.asset_resolver().get(format!("{bundle}/{relative}")).map(|asset| asset.bytes).ok_or_else(|| "资源不存在。".into());
    }
    let root = fs::canonicalize(root).map_err(message)?;
    if custom.as_ref().is_some_and(|selected| *selected != root) { return Err("已选择的资源目录已变化。".into()); }
    // 2026-11-23：ONNX 模型按单独的大小上限读取。
    let limit = (if kind == "kokoro" { 128 } else { 32 }) * 1024 * 1024;
    read_file(&root, relative, limit)
}

pub fn respond(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = request.headers().get("origin").and_then(|value| value.to_str().ok());
    let expected_dev = app.config().build.dev_url.as_ref().map(|url| url.origin().ascii_serialization());
    let allowed = origin.filter(|origin| matches!(*origin, "http://tauri.localhost" | "https://tauri.localhost" | "tauri://localhost")
        || (cfg!(debug_assertions) && expected_dev.as_deref() == Some(*origin)));
    let mut response = Response::builder()
        .header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'");
    if let Some(allowed) = allowed { response = response.header("Access-Control-Allow-Origin", allowed); }
    if (origin.is_some() && allowed.is_none()) || (request.method() != Method::GET && request.method() != Method::HEAD) {
        return response.status(StatusCode::FORBIDDEN).body(Vec::new()).expect("valid resource response");
    }
    if let Some(decoded) = decode_path(request.uri().path().trim_start_matches('/')) {
        if let Some((kind, relative)) = decoded.split_once('/') {
            if let Some(content_type) = asset_type(kind, relative) {
                if let Ok(bytes) = asset_bytes(app, kind, relative) {
                    return response.header("Content-Type", content_type).header("Content-Length", bytes.len().to_string())
                        .body(if request.method() == Method::HEAD { Vec::new() } else { bytes }).expect("valid resource response");
                }
            }
        }
    }
    response.status(StatusCode::NOT_FOUND).body(Vec::new()).expect("valid resource response")
}
