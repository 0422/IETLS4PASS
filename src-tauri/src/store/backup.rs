// 2026-11-19：校验、预览与事务恢复共用同一份数据模型，覆盖前生成可回退快照。
use super::{add_record, collection, key, message, read_documents, read_records, CommandResult, Database, Document, WorkspaceBackup};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use tauri::State;

const FORMAT: &str = "ietls4pass-backup-v1";

fn hash(value: &Value) -> String {
    fn feed(hash: &mut Sha256, value: &Value) {
        match value {
            Value::Array(items) => {
                hash.update(b"[");
                for item in items { feed(hash, item); }
                hash.update(b"]");
            }
            Value::Object(fields) => {
                hash.update(b"{");
                let mut keys = fields.keys().collect::<Vec<_>>();
                keys.sort_unstable();
                for key in keys {
                    hash.update(json!(key).to_string().as_bytes());
                    feed(hash, &fields[key]);
                }
                hash.update(b"}");
            }
            Value::Number(number) => {
                // 用浏览器 JSON 同样可表达的数值，统一整数写法和小数写法。
                let number = number.as_f64().unwrap_or_default();
                let number = if number == 0.0 { 0.0 } else { number };
                hash.update(b"#");
                hash.update(number.to_bits().to_be_bytes());
            }
            _ => hash.update(value.to_string().as_bytes()),
        }
    }
    let mut hash = Sha256::new();
    feed(&mut hash, value);
    format!("sha256-{:x}", hash.finalize())
}

fn content_hash(backup: &WorkspaceBackup) -> String {
    hash(&json!([backup.format, backup.records, backup.documents]))
}

pub(super) fn snapshot(connection: &Connection) -> CommandResult<WorkspaceBackup> {
    let mut backup = WorkspaceBackup {
        format: FORMAT.into(), records: read_records(connection)?,
        documents: read_documents(connection, None)?, checksum: None,
    };
    backup.checksum = Some(content_hash(&backup));
    Ok(backup)
}

fn required_key(value: &Value) -> CommandResult<&str> {
    let value = value.as_str().ok_or_else(|| "备份缺少数据标识".to_string())?;
    key(value)?;
    Ok(value)
}

fn validate_record(record: &Value) -> CommandResult<&str> {
    let id = required_key(&record["id"])?;
    let kind = record["kind"].as_str().unwrap_or_default();
    if !matches!(kind, "reading" | "listening") || !record["children"].is_null()
        || !record["title"].is_string() || !record["submittedAt"].is_string()
    {
        return Err("备份中有无效的成绩记录".into());
    }
    for field in ["answers", "annotations", "readingTiming"] {
        if !record[field].is_null() && !record[field].is_object() { return Err("备份中的作答详情结构无效".into()); }
    }
    if !record["details"].is_null() && !record["details"].is_array() {
        return Err("备份中的逐题结果结构无效".into());
    }
    Ok(id)
}

fn validate_document(document: &Document) -> CommandResult<()> {
    collection(&document.collection)?;
    key(&document.id)?;
    let value = &document.value;
    let valid = match document.collection.as_str() {
        "drafts" => value["answers"].is_object() && value["id"].is_string()
            && value["examId"].is_string() && value["bankId"].is_string(),
        // 2026-11-19：移机备份时同时校验听力草稿。
        "listening-drafts" => super::listening::valid_draft(value),
        // 2026-11-21：恢复备份时验证口语会话及文档标识。
        "speaking-sessions" => super::speaking::valid_session(value) && value["id"].as_str() == Some(document.id.as_str()),
        // 2026-11-23：恢复备份时核对正式作文的正文和题目标识。
        "writing-submissions" => super::valid_writing_submission(document),
        // 2026-11-21：恢复口语录音时校验附件格式。
        super::speaking::AUDIO_COLLECTION => super::speaking::valid_audio(value),
        // 2026-11-28：题面和精听高亮按文字范围数组保存。
        "listening-highlights" => super::listening::valid_highlights(value),
        "banks" => value["title"].is_string() && value["assets"].is_object(),
        "settings" => true,
        _ => value.is_object(),
    };
    if !valid { return Err(format!("备份中的 {} 资料结构无效", document.collection)); }
    Ok(())
}

// 2026-11-28：先核对旧备份原件的校验值，再选取本项目仍支持的记录。
fn prepare_restore(mut backup: WorkspaceBackup) -> CommandResult<WorkspaceBackup> {
    if backup.format != FORMAT { return Err("备份格式不受支持".into()); }
    if let Some(checksum) = &backup.checksum {
        if checksum != &content_hash(&backup) { return Err("备份校验失败，文件内容可能发生过变化".into()); }
    }
    let original_counts = (backup.records.len(), backup.documents.len());
    let active_ids: HashSet<_> = backup.records.iter()
        .filter(|record| !super::retired_record(record))
        .filter_map(|record| record["id"].as_str())
        .collect();
    let retired_ids: HashSet<_> = backup.records.iter()
        .filter(|record| super::retired_record(record))
        .flat_map(|record| std::iter::once(record).chain(record["children"].as_array().into_iter().flatten()))
        .filter_map(|record| record["id"].as_str())
        .filter(|id| !active_ids.contains(id))
        .collect();
    backup.documents.retain(|document| !super::retired_document(document)
        && !super::reading_replay_source(document).is_some_and(|id| retired_ids.contains(id)));
    backup.records.retain(|record| !super::retired_record(record));
    let counts = (backup.records.len(), backup.documents.len());
    if original_counts != (0, 0) && counts == (0, 0) {
        return Err("此备份没有可恢复的当前练习记录或资料。".into());
    }
    let mut ids = HashSet::new();
    for record in &backup.records {
        if !ids.insert(validate_record(record)?) { return Err("备份中有重复的成绩标识".into()); }
    }
    let mut ids = HashSet::new();
    for document in &backup.documents {
        validate_document(document)?;
        if !ids.insert((&document.collection, &document.id)) { return Err("备份中有重复的资料标识".into()); }
    }
    if backup.checksum.is_some() && counts != original_counts {
        backup.checksum = Some(content_hash(&backup));
    }
    Ok(backup)
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode { Merge, Replace }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    token: String,
    verified: bool,
    incoming_records: usize,
    incoming_documents: usize,
    existing_records: usize,
    existing_documents: usize,
    conflicting_records: usize,
    conflicting_documents: usize,
}

fn preview(current: &WorkspaceBackup, backup: &WorkspaceBackup, mode: Mode) -> Preview {
    let records: HashSet<_> = current.records.iter().filter_map(|record| record["id"].as_str()).collect();
    let documents: HashSet<_> = current.documents.iter().map(|item| (&item.collection, &item.id)).collect();
    Preview {
        token: hash(&json!([&current.checksum, content_hash(backup), mode])),
        verified: backup.checksum.is_some(),
        incoming_records: backup.records.len(), incoming_documents: backup.documents.len(),
        existing_records: current.records.len(), existing_documents: current.documents.len(),
        conflicting_records: backup.records.iter().filter_map(|record| record["id"].as_str()).filter(|id| records.contains(id)).count(),
        conflicting_documents: backup.documents.iter().filter(|item| documents.contains(&(&item.collection, &item.id))).count(),
    }
}

#[tauri::command]
pub fn preview_workspace_restore(db: State<'_, Database>, backup: WorkspaceBackup, mode: Mode) -> CommandResult<Preview> {
    let backup = prepare_restore(backup)?;
    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    let preview = preview(&snapshot(&transaction)?, &backup, mode);
    transaction.commit().map_err(message)?;
    Ok(preview)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    added_records: usize,
    added_documents: usize,
    rollback_id: Option<i64>,
}

fn merge(connection: &Connection, backup: WorkspaceBackup) -> CommandResult<Applied> {
    let mut result = Applied { added_records: 0, added_documents: 0, rollback_id: None };
    for record in backup.records {
        if add_record(connection, &record)? { result.added_records += 1; }
    }
    // 2026-11-21：先恢复消息，再恢复被保留会话所引用的录音。
    let (audio, documents): (Vec<_>, Vec<_>) = backup.documents.into_iter()
        .partition(|document| document.collection == super::speaking::AUDIO_COLLECTION);
    for document in documents.into_iter().chain(audio) {
        if document.collection == super::speaking::AUDIO_COLLECTION {
            let session_id = required_key(&document.value["sessionId"])?;
            if !super::speaking::references_audio(connection, session_id, &document.id)? { continue; }
        }
        result.added_documents += connection.execute(
            "INSERT INTO workspace_documents (collection, id, document_json)
             VALUES (?1, ?2, ?3) ON CONFLICT(collection, id) DO NOTHING",
            params![document.collection, document.id, document.value.to_string()],
        ).map_err(message)?;
    }
    Ok(result)
}

#[tauri::command]
pub fn apply_workspace_restore(db: State<'_, Database>, backup: WorkspaceBackup, mode: Mode, token: String) -> CommandResult<Applied> {
    let backup = prepare_restore(backup)?;
    let mut connection = db.lock()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(message)?;
    let current = snapshot(&transaction)?;
    if preview(&current, &backup, mode).token != token {
        return Err("工作区已变化，请重新生成恢复预览".into());
    }
    let rollback_id = if matches!(mode, Mode::Replace) {
        let id = save_snapshot(&transaction, "before-replace", &current)?;
        transaction.execute_batch(
            "DELETE FROM reading_draft_writers;
             DELETE FROM workspace_documents;
             DELETE FROM practice_records;",
        ).map_err(message)?;
        Some(id)
    } else { None };
    let result = Applied { rollback_id, ..merge(&transaction, backup)? };
    transaction.commit().map_err(message)?;
    Ok(result)
}

fn save_snapshot(connection: &Connection, source: &str, backup: &WorkspaceBackup) -> CommandResult<i64> {
    connection.execute(
        "INSERT INTO workspace_backups (source, records, documents, backup_json) VALUES (?1, ?2, ?3, ?4)",
        params![source, backup.records.len() as i64, backup.documents.len() as i64, serde_json::to_string(backup).map_err(message)?],
    ).map_err(message)?;
    Ok(connection.last_insert_rowid())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    id: i64,
    source: String,
    created_at: String,
    records: i64,
    documents: i64,
}

#[tauri::command]
pub fn list_workspace_backups(db: State<'_, Database>) -> CommandResult<Vec<BackupEntry>> {
    let connection = db.lock()?;
    let mut statement = connection.prepare(
        "SELECT id, source, created_at, records, documents FROM workspace_backups ORDER BY id DESC",
    ).map_err(message)?;
    let rows = statement.query_map([], |row| Ok(BackupEntry {
        id: row.get(0)?, source: row.get(1)?, created_at: row.get(2)?, records: row.get(3)?, documents: row.get(4)?,
    })).map_err(message)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(message)
}

#[tauri::command]
pub fn create_workspace_backup(db: State<'_, Database>) -> CommandResult<i64> {
    let mut connection = db.lock()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(message)?;
    let id = save_snapshot(&transaction, "manual", &snapshot(&transaction)?)?;
    transaction.commit().map_err(message)?;
    Ok(id)
}

#[tauri::command]
pub fn read_workspace_backup(db: State<'_, Database>, id: i64) -> CommandResult<WorkspaceBackup> {
    let json: Option<String> = db.lock()?.query_row(
        "SELECT backup_json FROM workspace_backups WHERE id = ?1", [id], |row| row.get(0),
    ).optional().map_err(message)?;
    let backup = serde_json::from_str(&json.ok_or_else(|| "本机回退点不存在".to_string())?).map_err(message)?;
    prepare_restore(backup)
}

#[tauri::command]
pub fn delete_workspace_backup(db: State<'_, Database>, id: i64) -> CommandResult<()> {
    db.lock()?.execute("DELETE FROM workspace_backups WHERE id = ?1", [id]).map_err(message)?;
    Ok(())
}
