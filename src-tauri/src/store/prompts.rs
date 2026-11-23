// 2026-11-22：Prompt 文档使用本地 Markdown，发起请求时重新读取和组合。
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{message, notes::{existing_note, markdown_directory, note_title, revision, write_markdown}, CommandResult};

pub(crate) const SYSTEM_PROMPT: &str = "system.md";
pub(crate) const MODEL_TEST_PROMPT: &str = "model-connection-test.md";
// 2026-11-23：干净克隆可编译，内置模板只在本机对应文档缺失时补齐。
const DEFAULTS: [(&str, &str, &str); 3] = [
    (SYSTEM_PROMPT, "系统提示词", include_str!("../../default-prompts/system.md")),
    ("speaking-examiner.md", "雅思口语考官", include_str!("../../default-prompts/speaking-examiner.md")),
    (MODEL_TEST_PROMPT, "AI 模型连接测试", include_str!("../../default-prompts/model-connection-test.md")),
];

#[derive(Default)]
pub struct PromptDocuments(Mutex<()>);

impl PromptDocuments {
    fn lock(&self) -> CommandResult<MutexGuard<'_, ()>> {
        self.0.lock().map_err(|_| "Prompt 文档暂不可用。".into())
    }
}

#[derive(Serialize)]
pub struct PromptEntry {
    id: String,
    title: String,
}

#[derive(Serialize)]
pub struct PromptDocument {
    content: String,
    revision: String,
}

fn directory(app: &AppHandle) -> CommandResult<PathBuf> {
    let dir = markdown_directory(app, "prompts", true)?;
    // 2026-11-22：安装版首次使用时复制默认文档，已有本地修改优先。
    for (id, _, seed) in DEFAULTS {
        let path = dir.join(id);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                let result = file.write_all(seed.as_bytes()).and_then(|_| file.sync_all());
                drop(file);
                if let Err(error) = result {
                    let _ = fs::remove_file(path);
                    return Err(message(error));
                }
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => return Err(message(error)),
        }
    }
    Ok(dir)
}

#[tauri::command]
pub fn list_prompt_documents(app: AppHandle, prompts: State<'_, PromptDocuments>) -> CommandResult<Vec<PromptEntry>> {
    let _lock = prompts.lock()?;
    let dir = directory(&app)?;
    let mut items = Vec::new();
    for entry in fs::read_dir(dir).map_err(message)? {
        let entry = entry.map_err(message)?;
        if !entry.file_type().map_err(message)?.is_file() { continue; }
        let Ok(id) = entry.file_name().into_string() else { continue; };
        let Some(stem) = note_title(&id) else { continue; };
        let title = DEFAULTS.iter().find(|(name, _, _)| *name == id.as_str())
            .map_or(stem, |(_, title, _)| *title).to_owned();
        items.push(PromptEntry { id, title });
    }
    items.sort_by(|left, right| {
        let rank = |id: &str| DEFAULTS.iter().position(|(name, _, _)| *name == id).unwrap_or(DEFAULTS.len());
        rank(&left.id).cmp(&rank(&right.id)).then_with(|| left.title.cmp(&right.title))
    });
    Ok(items)
}

#[tauri::command]
pub fn read_prompt_document(app: AppHandle, prompts: State<'_, PromptDocuments>, id: String) -> CommandResult<PromptDocument> {
    let _lock = prompts.lock()?;
    let path = existing_note(&directory(&app)?, &id)?;
    let content = fs::read_to_string(path).map_err(message)?;
    Ok(PromptDocument { revision: revision(&content), content })
}

#[tauri::command]
pub fn save_prompt_document(
    app: AppHandle, prompts: State<'_, PromptDocuments>, id: String, content: String, expected_revision: String,
) -> CommandResult<PromptDocument> {
    let _lock = prompts.lock()?;
    let dir = directory(&app)?;
    let path = existing_note(&dir, &id)?;
    let original = fs::read_to_string(&path).map_err(message)?;
    if revision(&original) != expected_revision {
        return Err("文档已在外部修改。请复制当前编辑内容后重新打开文档。".into());
    }
    write_markdown(&dir, &path, &content)?;
    Ok(PromptDocument { revision: revision(&content), content })
}

// 2026-11-22：一次渲染只处理模板中的变量，变量值中的大括号保留为原始数据。
fn render(content: &str, variables: &BTreeMap<String, String>) -> CommandResult<String> {
    let mut output = String::new();
    let mut remaining = content.trim_start_matches('\u{feff}');
    while let Some((before, after)) = remaining.split_once("{{") {
        output.push_str(before);
        let Some((key, tail)) = after.split_once("}}") else {
            output.push_str("{{");
            remaining = after;
            break;
        };
        let name = key.trim();
        let mut chars = name.chars();
        if chars.next().is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
            && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        {
            output.push_str(variables.get(name).ok_or_else(|| format!("缺少模板变量 {name}。"))?);
        } else {
            output.push_str("{{");
            output.push_str(key);
            output.push_str("}}");
        }
        remaining = tail;
    }
    output.push_str(remaining);
    Ok(output)
}

// 2026-11-22：按业务提供的文档顺序合并。编辑和取用持同一把锁，网络请求使用读取后的快照。
pub(crate) fn compose<'a>(
    app: &AppHandle, prompts: &PromptDocuments, ids: impl IntoIterator<Item = &'a str>,
    variables: &BTreeMap<String, String>,
) -> CommandResult<String> {
    let _lock = prompts.lock()?;
    let dir = directory(app)?;
    let mut seen = HashSet::new();
    let mut sections = Vec::new();
    for id in ids {
        if !seen.insert(id) { continue; }
        let path = existing_note(&dir, id).map_err(|error| format!("无法读取 Prompt 文档 {id}。{error}"))?;
        let text = fs::read_to_string(path).map_err(|error| format!("无法读取 Prompt 文档 {id}。{error}"))?;
        let rendered = render(&text, variables).map_err(|error| format!("Prompt 文档 {id}：{error}"))?;
        if !rendered.trim().is_empty() { sections.push(rendered.trim().to_owned()); }
    }
    Ok(sections.join("\n\n"))
}
