// 2026-11-19：让草稿、提交、中断归档和文章复习更新使用一致的 SQLite 事务及身份校验。
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;
// 2026-11-20：阅读草稿模块只负责单篇作答、归档和复习计划。
use super::{key, message, read_json, CommandResult, Database};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterRevision {
    writer_id: String,
    revision: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanChange {
    id: String,
    expected_revision: i64,
    value: Value,
}

// 2026-11-21：口语存档复用工作区 JSON 文档的事务读取。
pub(super) fn document(connection: &Connection, collection: &str, id: &str) -> CommandResult<Option<Value>> {
    let entry: Option<String> = connection.query_row(
        "SELECT document_json FROM workspace_documents WHERE collection = ?1 AND id = ?2",
        params![collection, id], |row| row.get(0),
    ).optional().map_err(message)?;
    entry.map(read_json).transpose()
}

// 2026-11-21：口语存档复用工作区 JSON 文档的事务写入。
pub(super) fn write_document(connection: &Connection, collection: &str, id: &str, value: &Value) -> CommandResult<()> {
    connection.execute(
        "INSERT INTO workspace_documents(collection, id, document_json) VALUES (?1, ?2, ?3)
         ON CONFLICT(collection, id) DO UPDATE SET document_json = excluded.document_json",
        params![collection, id, value.to_string()],
    ).map_err(message)?;
    Ok(())
}

pub(super) fn stored_record(connection: &Connection, id: &Value) -> CommandResult<Option<Value>> {
    let entry: Option<String> = connection.query_row(
        "SELECT record_json FROM practice_records WHERE id = ?1", [id.as_str()], |row| row.get(0),
    ).optional().map_err(message)?;
    entry.map(read_json).transpose()
}

pub(super) fn has_writer(connection: &Connection, id: &str) -> CommandResult<bool> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM reading_draft_writers WHERE draft_id = ?1)", [id], |row| row.get(0),
    ).map_err(message)
}

// 2026-11-19：按原记录 ID 清理回放资料，保留已更新到其他成绩的计划。
pub(super) fn remove_replay_data(connection: &Connection, record: &Value) -> CommandResult<()> {
    let children = record["children"].as_array().into_iter().flatten();
    for item in std::iter::once(record).chain(children) {
        let Some(id) = item["id"].as_str() else { continue; };
        connection.execute(
            "DELETE FROM workspace_documents WHERE (collection = 'annotations' AND id = ?1)
             OR (collection = 'review-plans' AND json_extract(document_json, '$.recordId') = ?1)", [id],
        ).map_err(message)?;
    }
    Ok(())
}

pub(super) fn remove_writer(connection: &Connection, id: &str) -> CommandResult<()> {
    connection.execute("DELETE FROM reading_draft_writers WHERE draft_id = ?1", [id]).map_err(message)?;
    Ok(())
}

pub(super) fn prune_recovery(connection: &Connection) -> CommandResult<()> {
    connection.execute(
        "DELETE FROM workspace_documents WHERE collection IN ('drafts', 'interrupted')
         AND julianday(COALESCE(json_extract(document_json, '$.archivedAt'), json_extract(document_json, '$.updatedAt')))
             <= julianday('now', '-30 days')", [],
    ).map_err(message)?;
    connection.execute(
        "DELETE FROM workspace_documents WHERE collection = 'interrupted' AND id IN
         (SELECT id FROM workspace_documents WHERE collection = 'interrupted'
          ORDER BY julianday(COALESCE(json_extract(document_json, '$.archivedAt'), json_extract(document_json, '$.updatedAt'))) DESC, id
          LIMIT -1 OFFSET 100)", [],
    ).map_err(message)?;
    connection.execute(
        "DELETE FROM reading_draft_writers WHERE NOT EXISTS
         (SELECT 1 FROM workspace_documents WHERE collection = 'drafts' AND id = draft_id)", [],
    ).map_err(message)?;
    Ok(())
}

fn writer_state(connection: &Connection, id: &str, writer_id: &str) -> CommandResult<(String, i64)> {
    connection.query_row(
        "SELECT attempt_id, revision FROM reading_draft_writers WHERE draft_id = ?1 AND writer_id = ?2",
        params![id, writer_id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(message)?.ok_or_else(|| "草稿已由其他页面打开或结束，请重新打开本篇。".into())
}

fn same_attempt(a: &Value, b: &Value) -> bool {
    ["id", "examId", "bankId", "suiteId", "suitePosition"].iter().all(|field| a[*field] == b[*field])
}

pub(super) fn check_frozen_draft(
    connection: &Connection, id: &str, record: &Value, writer: Option<&WriterRevision>,
) -> CommandResult<()> {
    let Some(writer) = writer else {
        return if has_writer(connection, id)? { Err("读取最新草稿后再提交。".into()) } else { Ok(()) };
    };
    let (attempt, revision) = writer_state(connection, id, &writer.writer_id)?;
    if record["id"] != attempt || revision != writer.revision
        || document(connection, "drafts", id)?.is_none_or(|value| value["pendingResult"] != *record) {
        return Err("冻结的草稿与提交不匹配，请重试。".into());
    }
    Ok(())
}

#[tauri::command]
pub fn open_reading_draft(
    db: State<'_, Database>, id: String, writer_id: String, seed: Value,
) -> CommandResult<Value> {
    key(&id)?;
    key(&writer_id)?;
    // 2026-11-19：来源标识需要在接管草稿并移动新草稿值后继续使用。
    let exam = seed["examId"].as_str().ok_or_else(|| "缺少题目标识".to_string())?.to_owned();
    let bank = seed["bankId"].as_str().ok_or_else(|| "缺少题库标识".to_string())?.to_owned();
    // 2026-11-20：旧套题草稿继续保存在工作区，作答入口只打开单篇。
    if seed["suiteId"].is_string() || id.starts_with("suite:") {
        return Err("阅读套题已停用。".into());
    }
    if id != format!("{bank}:{exam}") {
        return Err("草稿题目标识不一致".into());
    }
    let mut db = db.lock()?;
    let tx = db.transaction().map_err(message)?;
    prune_recovery(&tx)?;
    let draft = document(&tx, "drafts", &id)?;
    let recovered = draft.is_some();
    let draft = draft.unwrap_or(seed);
    let attempt = draft["id"].as_str().ok_or_else(|| "草稿缺少练习标识".to_string())?;
    key(attempt)?;
    if draft["examId"].as_str() != Some(exam.as_str()) || draft["bankId"].as_str() != Some(bank.as_str())
        || stored_record(&tx, &draft["id"])?.is_some() {
        return Err("草稿身份与当前题目不匹配。".into());
    }
    write_document(&tx, "drafts", &id, &draft)?;
    tx.execute(
        "INSERT INTO reading_draft_writers(draft_id, attempt_id, writer_id, revision) VALUES (?1, ?2, ?3, 0)
         ON CONFLICT(draft_id) DO UPDATE SET attempt_id = excluded.attempt_id, writer_id = excluded.writer_id, revision = 0",
        params![id, attempt, writer_id],
    ).map_err(message)?;
    tx.commit().map_err(message)?;
    Ok(json!({ "draft": draft, "recovered": recovered }))
}

#[tauri::command]
pub fn save_reading_draft(
    db: State<'_, Database>, id: String, writer: WriterRevision, draft: Value,
) -> CommandResult<()> {
    let mut db = db.lock()?;
    let tx = db.transaction().map_err(message)?;
    let (attempt, revision) = writer_state(&tx, &id, &writer.writer_id)?;
    let previous = document(&tx, "drafts", &id)?.ok_or_else(|| "草稿不存在".to_string())?;
    if draft["id"] != attempt || !same_attempt(&previous, &draft) {
        return Err("草稿身份已变化。".into());
    }
    if writer.revision < revision || (writer.revision == revision && draft != previous) {
        return Err("草稿版本已过期，请重新打开本篇。".into());
    }
    if writer.revision > revision {
        write_document(&tx, "drafts", &id, &draft)?;
        tx.execute("UPDATE reading_draft_writers SET revision = ?1 WHERE draft_id = ?2", params![writer.revision, id])
            .map_err(message)?;
    }
    tx.commit().map_err(message)
}

pub(super) fn archive_in_transaction(connection: &Connection, id: &str, reason: &str) -> CommandResult<()> {
    if let Some(mut draft) = document(connection, "drafts", id)? {
        let attempt = draft["id"].as_str().ok_or_else(|| "草稿缺少练习标识".to_string())?.to_owned();
        let now: String = connection.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| row.get(0))
            .map_err(message)?;
        draft["archivedAt"] = Value::String(now);
        draft["interruptReason"] = Value::String(reason.into());
        if let Some(value) = draft.as_object_mut() { value.remove("pendingResult"); }
        write_document(connection, "interrupted", &attempt, &draft)?;
        connection.execute("DELETE FROM workspace_documents WHERE collection = 'drafts' AND id = ?1", [id]).map_err(message)?;
    }
    remove_writer(connection, id)
}

#[tauri::command]
pub fn interrupt_reading(db: State<'_, Database>, id: String, writer: WriterRevision) -> CommandResult<()> {
    let mut db = db.lock()?;
    let tx = db.transaction().map_err(message)?;
    let (_, revision) = writer_state(&tx, &id, &writer.writer_id)?;
    if revision != writer.revision { return Err("请先保存最新草稿。".into()); }
    archive_in_transaction(&tx, &id, "ended")?;
    prune_recovery(&tx)?;
    tx.commit().map_err(message)
}

pub(super) fn apply_plan(connection: &Connection, change: PlanChange, record: Option<&Value>) -> CommandResult<()> {
    key(&change.id)?;
    let existing = document(connection, "review-plans", &change.id)?;
    let attempt_id = &change.value["lastReviewAttemptId"];
    if !attempt_id.as_str().is_some_and(|id| !id.is_empty()) {
        return Err("复习反馈缺少标识。".into());
    }
    if let Some(plan) = &existing {
        if plan["appliedReviewAttemptIds"].as_array().is_some_and(|attempts| attempts.contains(attempt_id)) {
            return Ok(());
        }
    }
    let revision = existing.as_ref().and_then(|value| value["revision"].as_i64()).unwrap_or(0);
    let next_revision = revision.checked_add(1).ok_or_else(|| "复习计划版本溢出。".to_string())?;
    if revision != change.expected_revision || change.value["revision"].as_i64() != Some(next_revision) {
        return Err("复习计划已更新，请重新读取后再提交。".into());
    }
    let expected = record.or(existing.as_ref()).ok_or_else(|| "复习计划不存在。".to_string())?;
    if ["examId", "bankId"].iter().any(|field| expected[*field] != change.value[*field])
        || change.value["recordId"] != expected[if record.is_some() { "id" } else { "recordId" }] {
        return Err("复习计划与原题记录不匹配。".into());
    }
    let plan_key = json!([expected["bankId"], expected["examId"]]).to_string();
    if plan_key != change.id { return Err("复习计划索引与原题不匹配。".into()); }
    write_document(connection, "review-plans", &change.id, &change.value)
}

#[tauri::command]
pub fn apply_review_feedback(db: State<'_, Database>, change: PlanChange) -> CommandResult<()> {
    let mut db = db.lock()?;
    let tx = db.transaction().map_err(message)?;
    apply_plan(&tx, change, None)?;
    tx.commit().map_err(message)
}
