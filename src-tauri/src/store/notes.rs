// 2026-11-21：课程笔记在指定目录中读写 Markdown，并在保存时检查外部修改。
use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Mutex, MutexGuard},
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};

use super::{message, CommandResult};

#[derive(Default)]
pub struct CourseNotes(Mutex<()>);

impl CourseNotes {
    fn lock(&self) -> CommandResult<MutexGuard<'_, ()>> {
        self.0.lock().map_err(|_| "课程笔记暂不可用。".into())
    }
}

#[derive(Serialize)]
pub struct CourseNoteEntry {
    id: String,
    title: String,
}

#[derive(Serialize)]
pub struct CourseNote {
    content: String,
    revision: String,
}

fn directory(_app: &AppHandle, create: bool) -> CommandResult<PathBuf> {
    // 2026-11-22：课程笔记和 Prompt 文档使用相同的本地目录保护。
    markdown_directory(_app, "notes", create)
}

pub(super) fn markdown_directory(_app: &AppHandle, folder: &str, create: bool) -> CommandResult<PathBuf> {
    // 2026-11-23：笔记和 Prompt 读写共同使用系统设置中选定的目录。
    if let Some(selected) = super::resources::override_directory(_app, folder)? {
        let canonical = fs::canonicalize(&selected).map_err(message)?;
        if canonical != selected || !canonical.is_dir() {
            return Err("已选择的 Markdown 目录不可用，请重新选择。".into());
        }
        return Ok(canonical);
    }
    // 2026-11-23：默认资源目录与系统设置展示路径使用同一个解析结果。
    let default = super::resources::default_directory(_app, folder)?;
    let base = default.parent().and_then(Path::parent).ok_or("找不到 Markdown 根目录。")?;
    if create {
        fs::create_dir_all(&base).map_err(message)?;
    }
    let base = match fs::canonicalize(&base) {
        Ok(base) => base,
        // 2026-11-22：统一处理两种 Markdown 目录尚未创建的情况。
        Err(error) if error.kind() == ErrorKind::NotFound && !create => return Ok(base.join("data").join(folder)),
        Err(error) => return Err(message(error)),
    };
    // 2026-11-21：逐级确认目录布局后再创建文件，防止链接目录将保存操作指向其他位置。
    let mut dir = base.clone();
    // 2026-11-22：按业务目录逐级校验本机路径。
    for name in ["data", folder] {
        dir.push(name);
        match fs::canonicalize(&dir) {
            Ok(path) if path == dir && path.is_dir() => {},
            // 2026-11-22：错误反馈指向具体的 Markdown 目录。
            Ok(_) => return Err(format!("Markdown 目录 data/{folder} 不可用。")),
            Err(error) if error.kind() == ErrorKind::NotFound && create => fs::create_dir(&dir).map_err(message)?,
            // 2026-11-22：只读路径查询不要求预先存在。
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(base.join("data").join(folder)),
            Err(error) => return Err(message(error)),
        }
    }
    Ok(dir)
}

// 2026-11-22：两类文档共同限制为普通 Markdown 文件名。
pub(super) fn note_title(id: &str) -> Option<&str> {
    let (title, extension) = id.rsplit_once('.')?;
    if !extension.eq_ignore_ascii_case("md") || title.is_empty() || title != title.trim()
        || title.starts_with('.') || title.ends_with('.') || id.encode_utf16().count() > 240
        || title.chars().any(|ch| ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return None;
    }
    let stem = title.split('.').next()?.trim_end().to_ascii_uppercase();
    let device_number = stem.strip_prefix("COM").or_else(|| stem.strip_prefix("LPT"));
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || device_number.is_some_and(|number| matches!(number, "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")) {
        return None;
    }
    Some(title)
}

// 2026-11-22：口语提示词和课程笔记共用同一普通文件校验。
pub(super) fn existing_note(dir: &Path, id: &str) -> CommandResult<PathBuf> {
    note_title(id).ok_or("Markdown 文件名无效。")?;
    let path = dir.join(id);
    if !fs::symlink_metadata(&path).map_err(message)?.file_type().is_file() {
        return Err("目标不是普通 Markdown 文件。".into());
    }
    Ok(path)
}

// 2026-11-22：保存 Prompt 时复用文档指纹，避免覆盖外部更新。
pub(super) fn revision(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

#[tauri::command]
pub fn list_course_notes(app: AppHandle, notes: State<'_, CourseNotes>) -> CommandResult<Vec<CourseNoteEntry>> {
    let _lock = notes.lock()?;
    let dir = directory(&app, false)?;
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(message(error)),
    };
    let mut list = Vec::new();
    for entry in entries {
        let entry = entry.map_err(message)?;
        if !entry.file_type().map_err(message)?.is_file() { continue; }
        let Ok(id) = entry.file_name().into_string() else { continue; };
        if let Some(title) = note_title(&id) {
            list.push(CourseNoteEntry { title: title.to_owned(), id });
        }
    }
    list.sort_by(|left, right| left.title.cmp(&right.title));
    Ok(list)
}

#[tauri::command]
pub fn read_course_note(app: AppHandle, notes: State<'_, CourseNotes>, id: String) -> CommandResult<CourseNote> {
    let _lock = notes.lock()?;
    let path = existing_note(&directory(&app, false)?, &id)?;
    let content = fs::read_to_string(path).map_err(message)?;
    Ok(CourseNote { revision: revision(&content), content })
}

#[tauri::command]
pub fn create_course_note(app: AppHandle, notes: State<'_, CourseNotes>, title: String) -> CommandResult<CourseNoteEntry> {
    let _lock = notes.lock()?;
    let id = format!("{}.md", title.trim());
    let title = note_title(&id).ok_or("请输入有效的笔记标题。")?.to_owned();
    let path = directory(&app, true)?.join(&id);
    OpenOptions::new().write(true).create_new(true).open(path).map_err(|error| {
        if error.kind() == ErrorKind::AlreadyExists { "已有同名笔记。".into() } else { message(error) }
    })?;
    Ok(CourseNoteEntry { id, title })
}

#[tauri::command]
pub fn save_course_note(
    app: AppHandle, notes: State<'_, CourseNotes>, id: String, content: String, expected_revision: String,
) -> CommandResult<CourseNote> {
    let _lock = notes.lock()?;
    let dir = directory(&app, false)?;
    let path = existing_note(&dir, &id)?;
    let original = fs::read_to_string(&path).map_err(message)?;
    if revision(&original) != expected_revision {
        return Err("文件已在外部修改。请复制当前编辑内容后刷新笔记。".into());
    }
    // 2026-11-22：笔记与 Prompt 文档共用原子替换。
    write_markdown(&dir, &path, &content)?;
    Ok(CourseNote { revision: revision(&content), content })
}

// 2026-11-22：先写临时文件再替换正文，调用时不会读到只保存了一半的提示词。
pub(super) fn write_markdown(dir: &Path, path: &Path, content: &str) -> CommandResult<()> {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let (temporary, mut file) = loop {
        let number = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temp = dir.join(format!(".note-{}-{number}.tmp", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => break (temp, file),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(message(error)),
        }
    };
    let result = file.write_all(content.as_bytes()).and_then(|_| file.sync_all());
    drop(file);
    if let Err(error) = result.and_then(|_| fs::rename(&temporary, path)) {
        let _ = fs::remove_file(&temporary);
        return Err(message(error));
    }
    Ok(())
}

#[tauri::command]
pub fn delete_course_note(app: AppHandle, notes: State<'_, CourseNotes>, id: String) -> CommandResult<()> {
    let _lock = notes.lock()?;
    let path = existing_note(&directory(&app, false)?, &id)?;
    fs::remove_file(path).map_err(message)
}
