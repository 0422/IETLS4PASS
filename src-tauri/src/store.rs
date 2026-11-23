// 2026-11-19：实现独立数据库、版本迁移和幂等提交。复用同一事务处理成绩及对应草稿。
use std::{fs, path::Path, sync::Mutex, time::Duration};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

// 2026-11-19：阅读计时草稿与复习计划使用事务校验。
pub mod reading;
// 2026-11-19：本机目录绑定与题库索引分开保存。
pub mod bank;
// 2026-11-19：分离工作区恢复事务与本地诊断存储。
pub mod backup;
pub mod diagnostics;
// 2026-11-19：按听力 Section 保存作答和成绩。
pub mod listening;
// 2026-11-21：单独管理模型连接与密钥。
pub mod ai_models;
// 2026-11-21：课程笔记以独立 Markdown 文件保存。
pub mod notes;
// 2026-11-22：从本地 Markdown 读取、保存及组合模型提示词。
pub mod prompts;
// 2026-11-21：口语对话存档加入工作区备份和查询范围。
pub mod speaking;
// 2026-11-23：集中解析项目 data 默认目录及本机覆盖路径。
pub mod resources;

type CommandResult<T> = Result<T, String>;

// 2026-11-19：数据库无法打开时保留桌面界面和诊断出口。
pub struct Database(Option<Mutex<Connection>>);

impl Database {
    pub fn open(directory: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        fs::create_dir_all(directory)?;
        let mut connection = Connection::open(directory.join("ietls4pass.db"))?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let migration = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version: u32 = migration.pragma_query_value(None, "user_version", |row| row.get(0))?;
        match version {
            0 => {
                migration.execute_batch(include_str!("../migrations/001_practice.sql"))?;
                migration.pragma_update(None, "user_version", 1)?;
            }
            // 2026-11-19：已有第一轮数据库只需添加写者表。
            // 2026-11-19：第二轮数据库升级后可保存原生目录绑定。
            // 2026-11-19：为现有工作区追加回退点与诊断表。
            // 2026-11-19：目录绑定支持口语题源。
            // 2026-11-21：允许重新打开支持写作目录绑定的数据库。
            // 2026-11-21：允许重新打开含模型配置和密钥表的数据库。
            // 2026-11-21：允许重新打开保存文本模型列表和生成参数的数据库。
            // 2026-11-23：打开包含本机资源路径配置的数据库。
            1..=9 => {}
            _ => return Err(std::io::Error::other("数据库由更新版本创建").into()),
        }
        if version < 2 {
            migration.execute_batch(include_str!("../migrations/002_reading_writers.sql"))?;
            migration.pragma_update(None, "user_version", 2)?;
        }
        if version < 3 {
            migration.execute_batch(include_str!("../migrations/003_bank_folders.sql"))?;
            migration.pragma_update(None, "user_version", 3)?;
        }
        // 2026-11-19：升级过程与已有数据同属一个事务。
        if version < 4 {
            migration.execute_batch(include_str!("../migrations/004_backup_diagnostics.sql"))?;
            migration.pragma_update(None, "user_version", 4)?;
        }
        // 2026-11-19：保留阅读和听力目录的既有 ID 后追加口语绑定。
        if version < 5 {
            migration.execute_batch(include_str!("../migrations/005_speaking_folders.sql"))?;
            migration.pragma_update(None, "user_version", 5)?;
        }
        // 2026-11-21：在同一升级事务中追加写作目录类型。
        if version < 6 {
            migration.execute_batch(include_str!("../migrations/006_writing_folders.sql"))?;
            migration.pragma_update(None, "user_version", 6)?;
        }
        // 2026-11-21：升级已有数据库时追加模型和密钥表，保留工作区资料。
        if version < 7 {
            migration.execute_batch(include_str!("../migrations/007_ai_models.sql"))?;
            migration.pragma_update(None, "user_version", 7)?;
        }
        // 2026-11-21：升级旧连接时保留当前模型和本机密钥。
        if version < 8 {
            migration.execute_batch(include_str!("../migrations/008_llm_profiles.sql"))?;
            migration.pragma_update(None, "user_version", 8)?;
        }
        // 2026-11-23：目录设置独立升级，保留既有题库和成绩标识。
        if version < 9 {
            migration.execute_batch(include_str!("../migrations/009_resource_directories.sql"))?;
            migration.pragma_update(None, "user_version", 9)?;
        }
        migration.commit()?;
        // 2026-11-19：应用初始化成功后提供正常 SQLite 连接。
        Ok(Self(Some(Mutex::new(connection))))
    }

    // 2026-11-19：用空连接表示启动时 SQLite 不可用。
    pub fn unavailable() -> Self { Self(None) }

    fn lock(&self) -> CommandResult<std::sync::MutexGuard<'_, Connection>> {
        // 2026-11-19：所有写操作在启动故障时返回明确错误。
        let connection = self.0.as_ref().ok_or_else(|| "数据库未能打开，请修复后重新启动应用".to_string())?;
        connection.lock().map_err(|_| "数据库暂时不可用".into())
    }
}

// 2026-11-19：支持生成可校验的备份及回退点。
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    collection: String,
    id: String,
    value: Value,
}

// 2026-11-19：兼容没有校验字段的第一版备份。
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackup {
    format: String,
    records: Vec<Value>,
    documents: Vec<Document>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    checksum: Option<String>,
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn key(value: &str) -> CommandResult<()> {
    if value.is_empty() || value.len() > 240 || value.chars().any(char::is_control) {
        return Err("无效的数据标识".into());
    }
    Ok(())
}

fn collection(value: &str) -> CommandResult<()> {
    match value {
        // 2026-11-19：将用户导入的听力题源保存到独立资料集合。
        // 2026-11-19：保存复盘批注和有版本控制的文章复习计划。
        "drafts" | "interrupted" | "vocabulary" | "settings" | "banks" | "suites" | "listening"
        // 2026-11-19：保存阅读生词和各项已解锁成就。
        // 2026-11-19：听力草稿独立于原有阅读恢复列表。
        // 2026-11-20：允许保存及恢复词表的本机编辑记录。
        | "review-plans" | "annotations" | "reading-words" | "achievements" | "listening-drafts"
        // 2026-11-21：允许导出、恢复及读取口语练习会话。
        // 2026-11-21：口语录音附件参与工作区备份和本机重置。
        | "vocabulary-edits" | "speaking-sessions" | speaking::AUDIO_COLLECTION => Ok(()),
        // 2026-11-23：允许作文通过本机工作区读写、备份和恢复。
        "writing-submissions" => Ok(()),
        _ => Err("未知的数据分类".into()),
    }
}

// 2026-11-23：本机写入与备份恢复共用正式作文的内容检查。
fn valid_writing_submission(document: &Document) -> bool {
    let value = &document.value;
    value["id"].as_str() == Some(document.id.as_str())
        && matches!(value["task"].as_str(), Some("1" | "2"))
        && ["questionId", "title", "answer", "submittedAt"].into_iter()
            .all(|field| value[field].as_str().is_some_and(|text| !text.trim().is_empty()))
}

fn read_json(text: String) -> CommandResult<Value> {
    serde_json::from_str(&text).map_err(message)
}

fn read_records(connection: &Connection) -> CommandResult<Vec<Value>> {
    let mut query = connection.prepare(
        "SELECT record_json FROM practice_records ORDER BY submitted_at DESC, id",
    ).map_err(message)?;
    let rows = query.query_map([], |row| row.get(0)).map_err(message)?;
    rows.map(|row| read_json(row.map_err(message)?)).collect()
}

fn read_documents(connection: &Connection, category: Option<&str>) -> CommandResult<Vec<Document>> {
    let mut query = connection.prepare(
        "SELECT collection, id, document_json FROM workspace_documents
         WHERE (?1 IS NULL OR collection = ?1) ORDER BY collection, id",
    ).map_err(message)?;
    let rows = query.query_map([category], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get::<_, String>(2)?))
    }).map_err(message)?;
    rows.map(|row| {
        let (collection, id, json) = row.map_err(message)?;
        Ok(Document { collection, id, value: read_json(json)? })
    }).collect()
}

fn add_record(connection: &Connection, value: &Value) -> CommandResult<bool> {
    let id = value["id"].as_str().ok_or_else(|| "成绩缺少记录标识".to_string())?;
    key(id)?;
    let kind = value["kind"].as_str().unwrap_or_default();
    if !matches!(kind, "reading" | "listening" | "suite") || !value["title"].is_string() {
        return Err("成绩类型或标题无效".into());
    }
    let date = value["submittedAt"].as_str().unwrap_or_default();
    let changed = connection.execute(
        "INSERT INTO practice_records(id, submitted_at, record_json)
         VALUES (?1, ?2, ?3) ON CONFLICT(id) DO NOTHING",
        params![id, date, value.to_string()],
    ).map_err(message)?;
    Ok(changed == 1)
}

#[tauri::command]
pub fn list_records(db: State<'_, Database>) -> CommandResult<Vec<Value>> {
    read_records(&*db.lock()?)
}

// 2026-11-19：同一事务验证提交草稿，并更新评分产生的文章复习计划。
#[tauri::command]
pub fn save_record(
    db: State<'_, Database>, record: Value, draft_id: Option<String>,
    writer: Option<reading::WriterRevision>, review: Option<reading::PlanChange>,
) -> CommandResult<Value> {
    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    if let Some(existing) = reading::stored_record(&transaction, &record["id"])? {
        return Ok(existing);
    }
    if let Some(id) = &draft_id {
        reading::check_frozen_draft(&transaction, id, &record, writer.as_ref())?;
    }
    add_record(&transaction, &record)?;
    if let Some(change) = review {
        reading::apply_plan(&transaction, change, Some(&record))?;
    }
    let saved = transaction.query_row(
        "SELECT record_json FROM practice_records WHERE id = ?1",
        [record["id"].as_str()],
        |row| row.get(0),
    ).map_err(message)?;
    let saved = read_json(saved)?;
    if let Some(id) = draft_id {
        key(&id)?;
        let matching: Option<String> = transaction.query_row(
            "SELECT document_json FROM workspace_documents WHERE collection = 'drafts' AND id = ?1",
            [&id],
            |row| row.get(0),
        ).optional().map_err(message)?;
        if matching.map(read_json).transpose()?.is_some_and(|draft| draft["id"] == saved["id"]) {
            transaction.execute(
                "DELETE FROM workspace_documents WHERE collection = 'drafts' AND id = ?1",
                [&id],
            ).map_err(message)?;
            // 2026-11-19：提交后让之前窗口的所有草稿写入失效。
            reading::remove_writer(&transaction, &id)?;
        }
    }
    transaction.commit().map_err(message)?;
    Ok(saved)
}

#[tauri::command]
pub fn delete_records(db: State<'_, Database>, ids: Vec<String>) -> CommandResult<()> {
    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    for id in ids {
        key(&id)?;
        // 2026-11-19：已删除作答的回放批注和失去来源的复习计划一并清理。
        if let Some(record) = reading::stored_record(&transaction, &Value::String(id.clone()))? {
            reading::remove_replay_data(&transaction, &record)?;
        }
        transaction.execute("DELETE FROM practice_records WHERE id = ?1", [&id]).map_err(message)?;
    }
    transaction.commit().map_err(message)
}

#[tauri::command]
pub fn list_documents(db: State<'_, Database>, category: String) -> CommandResult<Vec<Document>> {
    collection(&category)?;
    // 2026-11-19：读取恢复数据前同步清理超过 30 天的记录和中断容量。
    if matches!(category.as_str(), "drafts" | "interrupted") {
        let mut connection = db.lock()?;
        let transaction = connection.transaction().map_err(message)?;
        reading::prune_recovery(&transaction)?;
        let documents = read_documents(&transaction, Some(&category))?;
        transaction.commit().map_err(message)?;
        return Ok(documents);
    }
    // 2026-11-23：切换听力目录后，列表只显示当前绑定解析出的索引。
    let connection = db.lock()?;
    let mut documents = read_documents(&connection, Some(&category))?;
    if category == "listening" {
        if let Some(root) = resources::configured_directory(&connection, "listening")? {
            let current = bank::subject_id(&connection, "listening", &root)?;
            documents.retain(|document| current.as_deref() == Some(document.id.as_str()));
        }
    }
    Ok(documents)
}

#[tauri::command]
pub fn put_document(db: State<'_, Database>, document: Document, unless_record_id: Option<String>) -> CommandResult<()> {
    collection(&document.collection)?;
    key(&document.id)?;
    // 2026-11-23：只让题目关联和正文完整的作文进入正式记录。
    if document.collection == "writing-submissions" && !valid_writing_submission(&document) {
        return Err("作文提交记录格式无效".into());
    }
    let connection = db.lock()?;
    // 2026-11-19：旧写入接口不能更新已启用单写者的阅读草稿。
    if document.collection == "drafts" && reading::has_writer(&connection, &document.id)? {
        return Err("阅读草稿需要使用当前写入版本".into());
    }
    connection.execute(
        "INSERT INTO workspace_documents (collection, id, document_json)
         SELECT ?1, ?2, ?3 WHERE NOT EXISTS (SELECT 1 FROM practice_records WHERE id = ?4)
         ON CONFLICT(collection, id) DO UPDATE SET document_json = excluded.document_json
         WHERE excluded.collection <> 'achievements'
            OR (json_extract(excluded.document_json, '$.unlockedAt') IS NOT NULL
                AND (json_extract(workspace_documents.document_json, '$.unlockedAt') IS NULL
                    OR json_extract(excluded.document_json, '$.unlockedAt') < json_extract(workspace_documents.document_json, '$.unlockedAt')))",
        params![document.collection, document.id, document.value.to_string(), unless_record_id],
    ).map_err(message)?;
    Ok(())
}

// 2026-11-23：将词条删除集中到工作线程和单个事务，避免连续操作阻塞窗口。
#[tauri::command]
pub async fn remove_vocabulary_words(app: tauri::AppHandle, ids: Vec<String>) -> CommandResult<()> {
    use tauri::Manager;

    if ids.is_empty() {
        return Ok(());
    }
    for id in &ids {
        key(id)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Database>();
        let mut connection = db.lock()?;
        let transaction = connection.transaction().map_err(message)?;
        {
            let mut insert = transaction.prepare_cached(
                "INSERT INTO workspace_documents (collection, id, document_json)
                 VALUES ('vocabulary-edits', ?1, ?2)
                 ON CONFLICT(collection, id) DO UPDATE SET document_json = excluded.document_json",
            ).map_err(message)?;
            for id in ids {
                insert.execute(params![id, r#"{"kind":"remove"}"#]).map_err(message)?;
            }
        }
        transaction.commit().map_err(message)
    }).await.map_err(message)?
}

#[tauri::command]
pub fn delete_document(db: State<'_, Database>, category: String, id: String) -> CommandResult<()> {
    collection(&category)?;
    key(&id)?;
    db.lock()?.execute(
        "DELETE FROM workspace_documents WHERE collection = ?1 AND id = ?2",
        params![category, id],
    ).map_err(message)?;
    Ok(())
}

#[tauri::command]
pub fn export_workspace(db: State<'_, Database>) -> CommandResult<WorkspaceBackup> {
    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    // 2026-11-19：统一下载文件和本地回退点的校验规则。
    let backup = backup::snapshot(&transaction)?;
    transaction.commit().map_err(message)?;
    Ok(backup)
}

// 2026-11-19：归档中断草稿，公开 SQLite 完整性与数据计数，并支持本机重置。
#[tauri::command]
pub fn archive_draft(db: State<'_, Database>, id: String) -> CommandResult<()> {
    key(&id)?;
    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    // 2026-11-19：归档会清理当前写者，阻止过期页面重新写入原草稿。
    reading::archive_in_transaction(&transaction, &id, "archived")?;
    reading::prune_recovery(&transaction)?;
    transaction.commit().map_err(message)
}

#[tauri::command]
pub fn workspace_info(db: State<'_, Database>) -> CommandResult<Value> {
    let connection = db.lock()?;
    let check: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0)).map_err(message)?;
    let records: i64 = connection.query_row("SELECT COUNT(*) FROM practice_records", [], |row| row.get(0)).map_err(message)?;
    let documents: i64 = connection.query_row("SELECT COUNT(*) FROM workspace_documents", [], |row| row.get(0)).map_err(message)?;
    let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0)).map_err(message)?;
    Ok(serde_json::json!({ "database": "ietls4pass.db", "version": version, "check": check, "records": records, "documents": documents }))
}

#[tauri::command]
pub fn reset_workspace(db: State<'_, Database>) -> CommandResult<()> {
    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    transaction.execute("DELETE FROM practice_records", []).map_err(message)?;
    transaction.execute("DELETE FROM workspace_documents", []).map_err(message)?;
    // 2026-11-19：重置时清理读写权，已打开的旧练习页不能复活草稿。
    transaction.execute("DELETE FROM reading_draft_writers", []).map_err(message)?;
    // 2026-11-19：重置学习数据时一并撤销本机目录绑定。
    transaction.execute("DELETE FROM bank_folders", []).map_err(message)?;
    // 2026-11-23：清空本机路径覆盖，使资源重新取项目默认位置。
    transaction.execute("DELETE FROM resource_directories", []).map_err(message)?;
    // 2026-11-19：整库重置一并清理含有学习数据的本机回退点。
    transaction.execute("DELETE FROM workspace_backups", []).map_err(message)?;
    // 2026-11-21：重置本机设置时同时清除模型连接和对应的 API Key。
    transaction.execute("DELETE FROM ai_model_credentials", []).map_err(message)?;
    transaction.execute("DELETE FROM ai_model_connections", []).map_err(message)?;
    // 2026-11-23：重置后立即恢复默认题库的扫描入口。
    transaction.commit().map_err(message)?;
    drop(connection);
    bank::bind_default_library(&db)
}
