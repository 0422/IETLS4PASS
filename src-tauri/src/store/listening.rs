// 2026-11-19：听力每个 Section 独立保存草稿，提交与清理在同一事务中完成。
use super::{add_record, key, message, read_json, reading::stored_record, CommandResult, Database};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

#[derive(Deserialize)]
pub struct DraftRevision { id: String, revision: u64 }

fn current_draft(connection: &Connection, id: &str) -> CommandResult<Option<Value>> {
    let raw: Option<String> = connection.query_row(
        "SELECT document_json FROM workspace_documents WHERE collection = 'listening-drafts' AND id = ?1",
        [id], |row| row.get(0),
    ).optional().map_err(message)?;
    raw.map(read_json).transpose()
}

fn matching(current: &Value, expected: &DraftRevision) -> bool {
    current["id"].as_str() == Some(expected.id.as_str()) && current["revision"].as_u64() == Some(expected.revision)
}

// 2026-11-28：听力草稿和单独保存的高亮使用同一选区校验。
pub(super) fn valid_highlights(value: &Value) -> bool {
    value.as_array().is_some_and(|highlights| highlights.iter().all(|highlight| {
        let range = highlight["start"].as_u64().zip(highlight["end"].as_u64());
        highlight["blockId"].as_str().is_some_and(|id| !id.is_empty())
            && range.is_some_and(|(start, end)| start < end)
            && highlight["text"].as_str().is_some_and(|text| !text.is_empty())
    }))
}

pub(super) fn valid_draft(value: &Value) -> bool {
    ["id", "examId", "bankId", "startedAt"].iter().all(|field| value[*field].as_str().is_some_and(|text| !text.is_empty()))
        && value["revision"].as_u64().is_some_and(|revision| revision > 0)
        && value["elapsedMs"].as_u64().is_some()
        && value["position"].as_f64().is_some_and(|position| position >= 0.0)
        // 2026-11-23：旧草稿可省略题面高亮，存在时校验标题块标识、选区和文字。
        && value.get("questionHighlights").map_or(true, valid_highlights)
        && value["answers"].is_object()
}

#[tauri::command]
pub fn save_listening_draft(db: State<'_, Database>, draft_id: String, draft: Value, expected: Option<DraftRevision>) -> CommandResult<Value> {
    key(&draft_id)?;
    if !valid_draft(&draft) { return Err("听力草稿结构无效".into()); }
    key(draft["id"].as_str().unwrap_or_default())?;
    let mut connection = db.lock()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(message)?;
    let current = current_draft(&transaction, &draft_id)?;
    if current.as_ref() == Some(&draft) { return Ok(draft); }
    let revision = match (current.as_ref(), expected) {
        (None, None) => 1,
        (Some(current), Some(expected)) if matching(current, &expected) => expected.revision.saturating_add(1),
        _ => return Err("听力草稿已在其他页面更新，请返回列表重新继续做题".into()),
    };
    if draft["revision"].as_u64() != Some(revision) || stored_record(&transaction, &draft["id"])?.is_some() {
        return Err("听力草稿已变化或本次练习已提交".into());
    }
    transaction.execute(
        "INSERT INTO workspace_documents(collection, id, document_json) VALUES ('listening-drafts', ?1, ?2)
         ON CONFLICT(collection, id) DO UPDATE SET document_json = excluded.document_json",
        params![draft_id, draft.to_string()],
    ).map_err(message)?;
    transaction.commit().map_err(message)?;
    Ok(draft)
}

#[tauri::command]
pub fn commit_listening_section(db: State<'_, Database>, draft_id: String, record: Value, expected: DraftRevision) -> CommandResult<Value> {
    key(&draft_id)?;
    key(&expected.id)?;
    if record["kind"] != "listening" || record["possible"].as_u64() != Some(10)
        || !record["points"].as_u64().is_some_and(|points| points <= 10)
        || !record["details"].as_array().is_some_and(|details| details.len() == 10)
        || record["id"].as_str() != Some(expected.id.as_str())
    { return Err("听力 Section 成绩必须包含 10 道题".into()); }
    let mut connection = db.lock()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(message)?;
    if let Some(saved) = stored_record(&transaction, &record["id"])? { return Ok(saved); }
    let draft = current_draft(&transaction, &draft_id)?.ok_or_else(|| "听力草稿已结束，请返回列表".to_string())?;
    if !matching(&draft, &expected) || draft["bankId"] != record["bankId"] || draft["examId"] != record["examId"]
        || draft["answers"] != record["answers"] {
        return Err("听力草稿已更新，请返回列表重新继续做题".into());
    }
    add_record(&transaction, &record)?;
    transaction.execute("DELETE FROM workspace_documents WHERE collection = 'listening-drafts' AND id = ?1", [draft_id]).map_err(message)?;
    transaction.commit().map_err(message)?;
    Ok(record)
}
