// 2026-11-19：只接受固定诊断操作和结果，限制持久化天数与条数。
use super::{message, CommandResult, Database};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

const OPERATIONS: &[&str] = &[
    // 2026-11-23：资源目录诊断只记录操作和结果。
    "list_resource_directories", "choose_resource_directory", "reset_resource_directory",
    // 2026-11-19：允许记录听力草稿和提交操作名。
    "save_listening_draft", "commit_listening_section",
    "startup", "page_render", "window_error", "unhandled_rejection", "backup_file",
    "list_records", "save_record", "delete_records", "list_documents", "put_document",
    "delete_document", "export_workspace", "archive_draft", "workspace_info", "reset_workspace",
    "open_reading_draft", "save_reading_draft", "interrupt_reading", "apply_review_feedback",
    "list_bank_folders", "scan_bank_folder",
    "read_bank_text", "read_bank_media", "open_bank_pdf", "preview_workspace_restore", "apply_workspace_restore",
    "list_workspace_backups", "create_workspace_backup", "read_workspace_backup", "delete_workspace_backup",
    // 2026-11-21：诊断可记录模型连接操作名和结果，不接收连接配置或密钥。
    "list_ai_models", "save_ai_model", "select_ai_model", "delete_ai_model",
    // 2026-11-21：只记录文本模型操作名与结果，保留诊断范围。
    "set_ai_model_variant", "test_ai_model", "generate_llm_text",
    // 2026-11-21：只记录转写和会话保存操作的状态。
    "transcribe_speaking_audio", "save_speaking_session",
    // 2026-11-21：回放诊断只记录操作名和结果。
    "read_speaking_audio",
    // 2026-11-21：仅记录课程笔记操作名称和结果。
    "list_course_notes", "read_course_note", "create_course_note", "save_course_note", "delete_course_note",
    // 2026-11-22：Prompt 文档诊断仅记录操作和结果。
    "list_prompt_documents", "read_prompt_document", "save_prompt_document",
];

fn prune(connection: &Connection) -> CommandResult<()> {
    connection.execute_batch(
        "DELETE FROM diagnostic_events WHERE occurred_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days');
         DELETE FROM diagnostic_events WHERE id < (SELECT id FROM diagnostic_events ORDER BY id DESC LIMIT 1 OFFSET 1999);",
    ).map_err(message)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preference { enabled: bool, detailed_until: Option<String> }

fn preference(connection: &Connection) -> CommandResult<Preference> {
    connection.query_row(
        "SELECT enabled, CASE WHEN detailed_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN detailed_until END
         FROM diagnostic_preferences WHERE id = 1",
        [], |row| Ok(Preference { enabled: row.get(0)?, detailed_until: row.get(1)? }),
    ).map_err(message)
}

#[tauri::command]
pub fn record_diagnostic(db: State<'_, Database>, operation: String, result: String) -> CommandResult<bool> {
    if !OPERATIONS.contains(&operation.as_str()) || !matches!(result.as_str(), "error" | "ok") {
        return Err("未知的诊断操作或结果".into());
    }
    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    let changed = transaction.execute(
        "INSERT INTO diagnostic_events (operation, result)
         SELECT ?1, ?2 FROM diagnostic_preferences WHERE id = 1 AND enabled = 1
         AND (?2 = 'error' OR detailed_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        params![operation, result],
    ).map_err(message)?;
    if changed == 1 { prune(&transaction)?; }
    transaction.commit().map_err(message)?;
    Ok(changed == 1)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Event { occurred_at: String, operation: String, result: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report { version: &'static str, preference: Preference, events: Vec<Event> }

#[tauri::command]
pub fn diagnostic_report(db: State<'_, Database>) -> CommandResult<Report> {
    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    prune(&transaction)?;
    let preference = preference(&transaction)?;
    let events = {
        let mut statement = transaction.prepare(
            "SELECT occurred_at, operation, result FROM diagnostic_events ORDER BY id DESC",
        ).map_err(message)?;
        let rows = statement.query_map([], |row| Ok(Event {
            occurred_at: row.get(0)?, operation: row.get(1)?, result: row.get(2)?,
        })).map_err(message)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(message)?
    };
    transaction.commit().map_err(message)?;
    Ok(Report { version: env!("CARGO_PKG_VERSION"), preference, events })
}

#[tauri::command]
pub fn configure_diagnostics(db: State<'_, Database>, enabled: bool, detailed: bool) -> CommandResult<Preference> {
    let connection = db.lock()?;
    connection.execute(
        "UPDATE diagnostic_preferences SET enabled = ?1,
         detailed_until = CASE WHEN ?1 AND ?2 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+15 minutes') END WHERE id = 1",
        params![enabled, detailed],
    ).map_err(message)?;
    preference(&connection)
}

#[tauri::command]
pub fn clear_diagnostics(db: State<'_, Database>) -> CommandResult<()> {
    db.lock()?.execute("DELETE FROM diagnostic_events", []).map_err(message)?;
    Ok(())
}
