// 2026-11-19：扫描经本机选择的题库目录，使用稳定 ID 和受目录边界约束的资源读取。
use std::fs::{self, File};
// 2026-11-19：按文件清单和修改状态识别目录是否需要重新解析。
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use super::{key, message, CommandResult, Database};

const TEXT_LIMIT: u64 = 8 * 1024 * 1024;
const MEDIA_LIMIT: u64 = 96 * 1024 * 1024;
const INDEX_LIMIT: usize = 25_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BankFolder {
    id: String,
    kind: String,
    title: String,
    root: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BankScan {
    folder: BankFolder,
    files: Vec<String>,
    skipped: usize,
    revision: String,
}

fn folder_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BankFolder> {
    Ok(BankFolder { id: row.get(0)?, kind: row.get(1)?, title: row.get(2)?, root: row.get(3)? })
}

fn lookup(connection: &Connection, id: &str) -> CommandResult<BankFolder> {
    key(id)?;
    connection.query_row("SELECT id, kind, title, root FROM bank_folders WHERE id = ?1", [id], folder_row)
        .optional().map_err(message)?.ok_or_else(|| "题库目录尚未绑定，请重新选择本机目录。".into())
}

// 2026-11-23：登记系统资源目录，并复用该路径已有的题库编号。
fn register_folder(connection: &Connection, kind: &str, path: &Path) -> CommandResult<BankFolder> {
    let root = fs::canonicalize(path).map_err(message)?;
    let root = root.to_str().ok_or_else(|| "目录名称无法保存。".to_string())?;
    let root_key = if cfg!(windows) { root.to_lowercase() } else { root.to_owned() };
    let title = path.file_name().and_then(|name| name.to_str()).unwrap_or("本地题库");
    connection.execute(
        "INSERT INTO bank_folders(id, kind, root, root_key, title)
         VALUES ('folder-' || lower(hex(randomblob(16))), ?1, ?2, ?3, ?4)
         ON CONFLICT(kind, root_key) DO UPDATE SET root = excluded.root, title = excluded.title",
        params![kind, root, root_key, title],
    ).map_err(message)?;
    connection.query_row(
        "SELECT id, kind, title, root FROM bank_folders WHERE kind = ?1 AND root_key = ?2",
        params![kind, root_key], folder_row,
    ).map_err(message)
}

// 2026-11-21：统一识别开发工作区和安装后的程序旁数据目录。
const SUBJECT_FOLDERS: [(&str, &str); 4] = [("reading", "阅读"), ("listening", "听力"), ("speaking", "口语"), ("writing", "Writing")];

pub(super) fn program_directory() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?.to_path_buf();
    #[cfg(not(debug_assertions))]
    let directory = std::env::current_exe().ok()?.parent()?.to_path_buf();
    fs::canonicalize(directory).ok()
}

fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy();
    if cfg!(windows) { value.to_lowercase() } else { value.into_owned() }
}

pub fn bind_default_library(db: &Database) -> CommandResult<()> {
    let Some(base) = program_directory() else { return Ok(()); };
    let Ok(data) = fs::canonicalize(base.join("data")) else { return Ok(()); };
    if !data.starts_with(&base) { return Ok(()); }
    let mut connection = db.lock()?;
    let tx = connection.transaction().map_err(message)?;
    for (kind, legacy) in SUBJECT_FOLDERS.into_iter().filter(|(kind, _)| *kind != "reading") {
        // 2026-11-23：手动指定过的科目目录已经绑定，启动时不补回默认目录。
        if super::resources::configured_directory(&tx, kind)?.is_some() { continue; }
        let Ok(path) = fs::canonicalize(data.join(kind)) else { continue; };
        if !path.starts_with(&data) || !path.is_dir() { continue; }
        let previous_key = path_key(&base.join("IELTS资料").join(legacy));
        let new_key = path_key(&path);
        let root = path.to_str().ok_or_else(|| "目录名称无法保存。".to_string())?;
        // 2026-11-21：换目录时沿用旧题库编号，使听力成绩、草稿和题目路径继续关联。
        let changed = tx.execute(
            "UPDATE bank_folders SET root = ?3, root_key = ?4
             WHERE kind = ?1 AND root_key = ?2
               AND NOT EXISTS (SELECT 1 FROM bank_folders WHERE kind = ?1 AND root_key = ?4)",
            params![kind, previous_key, root, new_key],
        ).map_err(message)?;
        if changed == 0 { register_folder(&tx, kind, &path)?; }
    }
    tx.commit().map_err(message)
}

// 2026-11-23：移动同一科目的目录时优先复用现有文件夹编号。
pub(super) fn set_subject_directory(connection: &Connection, kind: &str, previous: &Path, next: &Path) -> CommandResult<()> {
    // 2026-11-23：恢复默认时可先关联预期路径，目录放入后再扫描。
    let next = fs::canonicalize(next).unwrap_or_else(|_| next.to_path_buf());
    if subject_id(connection, kind, &next)?.is_some() { return Ok(()); }
    let previous = fs::canonicalize(previous).unwrap_or_else(|_| previous.to_path_buf());
    if let Some(id) = subject_id(connection, kind, &previous)? {
        let root = next.to_str().ok_or("目录名称无法保存。")?;
        let title = next.file_name().and_then(|name| name.to_str()).unwrap_or("本地题库");
        connection.execute(
            "UPDATE bank_folders SET root = ?2, root_key = ?3, title = ?4 WHERE id = ?1",
            params![id, root, path_key(&next), title],
        ).map_err(message)?;
        if kind == "listening" {
            connection.execute("DELETE FROM workspace_documents WHERE collection = 'listening' AND id = ?1", [&id]).map_err(message)?;
        }
    // 2026-11-23：只有存在且可扫描的目录才新增绑定；已有 ID 可以指向待提供的默认目录。
    } else if next.is_dir() {
        register_folder(connection, kind, &next)?;
    }
    Ok(())
}

// 2026-11-23：按生效目录匹配已有题库，避免切换路径时重复登记。
pub(super) fn subject_id(connection: &Connection, kind: &str, path: &Path) -> CommandResult<Option<String>> {
    connection.query_row("SELECT id FROM bank_folders WHERE kind = ?1 AND root_key = ?2",
        params![kind, path_key(path)], |row| row.get(0)).optional().map_err(message)
}

#[tauri::command]
pub fn list_bank_folders(db: State<'_, Database>) -> CommandResult<Vec<BankFolder>> {
    let connection = db.lock()?;
    let mut statement = connection.prepare("SELECT id, kind, title, root FROM bank_folders ORDER BY kind, title, id").map_err(message)?;
    let rows = statement.query_map([], folder_row).map_err(message)?;
    // 2026-11-21：停用已搬走的原默认题库目录，保留数据库中的题库编号以供旧记录使用。
    let mut folders = rows.collect::<Result<Vec<_>, _>>().map_err(message)?;
    // 2026-11-23：手动目录生效期间只扫描该科目选中的路径，历史题库编号继续保留。
    for kind in ["listening", "speaking", "writing"] {
        if let Some(root) = super::resources::configured_directory(&connection, kind)? {
            let active = path_key(&root);
            folders.retain(|folder| folder.kind != kind || path_key(Path::new(&folder.root)) == active);
        }
    }
    if let Some(base) = program_directory() {
        let old_root = base.join("IELTS资料");
        folders.retain(|folder| {
            let path = Path::new(&folder.root);
            !SUBJECT_FOLDERS.iter().any(|(kind, old)| folder.kind == *kind && path_key(path) == path_key(&old_root.join(old))) || path.is_dir()
        });
    }
    Ok(folders)
}

fn relative_file(root: &Path, relative: &str) -> CommandResult<PathBuf> {
    let relative = Path::new(relative);
    if relative.as_os_str().is_empty() || !relative.components().all(|part| matches!(part, Component::Normal(_))) {
        return Err("题库资源路径不合法。".into());
    }
    let path = fs::canonicalize(root.join(relative)).map_err(|_| "本地资源不可用，请检查目录后刷新题库。".to_owned())?;
    if !path.starts_with(root) || !path.is_file() { return Err("资源不在已绑定的题库目录内。".into()); }
    Ok(path)
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|ext| ext.to_str()).unwrap_or("").to_ascii_lowercase()
}

fn media_extension(ext: &str) -> bool {
    matches!(ext, "pdf" | "png" | "jpg" | "jpeg" | "webp" | "gif" | "avif" | "svg"
        | "mp3" | "m4a" | "wav" | "ogg" | "aac" | "flac" | "mp4")
}

fn text_extension(ext: &str) -> bool {
    matches!(ext, "htm" | "html" | "json" | "js")
}

fn scan(folder: BankFolder) -> CommandResult<BankScan> {
    let root = fs::canonicalize(&folder.root).map_err(|_| "已绑定目录不可用，请重新连接存储设备后刷新。".to_owned())?;
    let mut pending = vec![root.clone()];
    // 2026-11-19：目录扫描带文件属性校验，新增、删除或修改时更新版本。
    let mut entries = Vec::new();
    let mut skipped = 0;
    while let Some(directory) = pending.pop() {
        let children = match fs::read_dir(&directory) {
            Ok(children) => children,
            Err(error) if directory == root => return Err(message(error)),
            Err(_) => { skipped += 1; continue; }
        };
        for child in children {
            let Ok(child) = child else { skipped += 1; continue; };
            let name = child.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || matches!(name.as_str(), "node_modules" | "dist" | "target" | "developer") { continue; }
            let path = child.path();
            let Ok(canonical) = path.canonicalize() else { skipped += 1; continue; };
            if canonical != path || !canonical.starts_with(&root) { skipped += 1; continue; }
            let Ok(kind) = child.file_type() else { skipped += 1; continue; };
            if kind.is_dir() {
                pending.push(canonical);
            } else if kind.is_file() {
                let ext = extension(&path);
                if text_extension(&ext) || media_extension(&ext) {
                    let rel = path.strip_prefix(&root).map_err(message)?;
                    if let Some(name) = rel.to_str() {
                        let meta = child.metadata().ok();
                        entries.push((name.replace('\\', "/"), meta.as_ref().map(|item| item.len()), meta.and_then(|item| item.modified().ok())));
                    }
                }
            }
            if entries.len() > INDEX_LIMIT { return Err("此目录资源过多，请选择具体的题库子目录。".into()); }
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hash = DefaultHasher::new();
    entries.hash(&mut hash);
    let revision = format!("{:016x}", hash.finish());
    Ok(BankScan { folder, files: entries.into_iter().map(|entry| entry.0).collect(), skipped, revision })
}

// 2026-11-23：保存路径前检查目录中至少有该科目扫描器可识别的资源。
pub(super) fn validate_subject_directory(kind: &str, root: &Path) -> CommandResult<()> {
    let folder = BankFolder { id: String::new(), kind: kind.into(), title: String::new(), root: root.to_string_lossy().into_owned() };
    let files = scan(folder)?.files;
    let valid = files.iter().any(|relative| {
        let file = relative.to_ascii_lowercase();
        match kind {
            // 2026-11-23：口语与写作至少有一份符合现有格式的题目。
            "speaking" => file.ends_with(".json") && super::resources::json_file(root, relative).is_ok_and(|data|
                data["format"] == "ietls4pass-speaking-v1" && data["topics"].as_array().is_some_and(|topics| !topics.is_empty())
                && data["part"].as_u64().is_some_and(|part| (1..=3).contains(&part))),
            "writing" => file.ends_with(".json") && file.split_once('/').is_some_and(|(task, _)| {
                let task = task.replace(' ', "");
                matches!(task.as_str(), "task1" | "task2") && super::resources::json_file(root, relative).is_ok_and(|data|
                    data["meta"]["task"].as_str().is_some_and(|value| value.replace(' ', "").eq_ignore_ascii_case(&task))
                    && (data["prompt"]["text"].as_str().is_some_and(|text| !text.trim().is_empty())
                        || data["prompt"]["blocks"].as_array().is_some_and(|blocks| !blocks.is_empty())))
            }),
            "listening" => match extension(Path::new(&file)).as_str() {
                "json" => file.contains("section") || super::resources::json_file(root, relative).is_ok_and(|data|
                    data["format"] == "ietls4pass-listening-v1"),
                "js" => file.ends_with("manifest.js") || file.ends_with("listening-index.compat.js"),
                "html" | "htm" | "pdf" | "mp3" | "m4a" | "wav" | "ogg" | "aac" | "flac" => true,
                _ => false,
            },
            _ => false,
        }
    });
    if valid { Ok(()) } else { Err("所选目录没有对应科目的可读题源。".into()) }
}

#[tauri::command]
pub async fn scan_bank_folder(db: State<'_, Database>, id: String) -> CommandResult<BankScan> {
    let folder = { let connection = db.lock()?; lookup(&connection, &id)? };
    tauri::async_runtime::spawn_blocking(move || scan(folder)).await.map_err(message)?
}

fn read_bytes(folder: BankFolder, relative: String, text: bool) -> CommandResult<Vec<u8>> {
    let root = fs::canonicalize(&folder.root).map_err(message)?;
    let path = relative_file(&root, &relative)?;
    let ext = extension(&path);
    let limit = if text && text_extension(&ext) { TEXT_LIMIT } else if !text && media_extension(&ext) { MEDIA_LIMIT }
        else { return Err("该资源类型当前不可读取。".into()); };
    let mut file = File::open(&path).map_err(message)?.take(limit + 1);
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(message)?;
    if bytes.len() as u64 > limit { return Err("单个资源超过读取上限。".into()); }
    Ok(bytes)
}

#[tauri::command]
pub async fn read_bank_text(db: State<'_, Database>, id: String, relative: String) -> CommandResult<String> {
    let folder = { let connection = db.lock()?; lookup(&connection, &id)? };
    let bytes = tauri::async_runtime::spawn_blocking(move || read_bytes(folder, relative, true)).await.map_err(message)??;
    String::from_utf8(bytes).map_err(|_| "题源需要使用 UTF-8 编码。".into())
}

#[tauri::command]
pub async fn read_bank_media(db: State<'_, Database>, id: String, relative: String) -> CommandResult<tauri::ipc::Response> {
    let folder = { let connection = db.lock()?; lookup(&connection, &id)? };
    let bytes = tauri::async_runtime::spawn_blocking(move || read_bytes(folder, relative, false)).await.map_err(message)??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn open_bank_pdf(app: AppHandle, db: State<'_, Database>, id: String, relative: String) -> CommandResult<()> {
    let folder = { let connection = db.lock()?; lookup(&connection, &id)? };
    let root = fs::canonicalize(&folder.root).map_err(message)?;
    let path = relative_file(&root, &relative)?;
    if extension(&path) != "pdf" { return Err("请选择已绑定目录内的 PDF。".into()); }
    // 2026-11-19：文件边界校验后，以 Windows 默认查看器可识别的普通路径打开。
    let name = path.to_string_lossy();
    let opener_path = if let Some(network) = name.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{network}")
    } else { name.strip_prefix(r"\\?\").unwrap_or(name.as_ref()).to_owned() };
    app.opener().open_path(opener_path, None::<&str>).map_err(message)
}
