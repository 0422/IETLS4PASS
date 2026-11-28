// 2026-11-21：按练习 ID 保存口语对话，版本校验防止异步回复覆盖更新的记录。
use rusqlite::TransactionBehavior;
// 2026-11-21：录音独立存档，试听时通过二进制 IPC 返回原始 WAV。
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use tauri::{ipc::Response, State};

use super::{key, message, reading::{document, write_document}, CommandResult, Database};

const COLLECTION: &str = "speaking-sessions";
// 2026-11-21：语音附件单独存储，读取会话列表时不加载录音。
pub(super) const AUDIO_COLLECTION: &str = "speaking-audio";
const MAX_WAV_BYTES: usize = 44 + 120 * 16_000 * 2;

fn recording_bytes(encoded: &str) -> CommandResult<Vec<u8>> {
    let invalid = || "口语录音不是有效的单声道 16 kHz PCM WAV。".to_string();
    if encoded.len() > MAX_WAV_BYTES.div_ceil(3) * 4 { return Err(invalid()); }
    let bytes = STANDARD.decode(encoded).map_err(|_| invalid())?;
    if bytes.len() <= 44 || bytes.len() > MAX_WAV_BYTES || bytes.len() % 2 != 0
        || &bytes[0..4] != b"RIFF" || bytes[4..8] != ((bytes.len() - 8) as u32).to_le_bytes()
        || &bytes[8..16] != b"WAVEfmt " || bytes[16..20] != 16u32.to_le_bytes()
        || &bytes[20..24] != b"\x01\x00\x01\x00" || bytes[24..28] != 16_000u32.to_le_bytes()
        || bytes[34..36] != 16u16.to_le_bytes() || &bytes[36..40] != b"data"
        || bytes[40..44] != ((bytes.len() - 44) as u32).to_le_bytes()
    {
        return Err(invalid());
    }
    Ok(bytes)
}

pub(super) fn valid_audio(value: &Value) -> bool {
    value["sessionId"].as_str().is_some_and(|id| key(id).is_ok())
        && value["wav"].as_str().is_some_and(|wav| recording_bytes(wav).is_ok())
}

pub(super) fn references_audio(connection: &Connection, session_id: &str, audio_id: &str) -> CommandResult<bool> {
    Ok(document(connection, COLLECTION, session_id)?.is_some_and(|session| {
        session["messages"].as_array().is_some_and(|items| items.iter().any(|item| {
            item["role"].as_str() == Some("user") && item["audioId"].as_str() == Some(audio_id)
        }))
    }))
}

pub(super) fn valid_session(value: &Value) -> bool {
    value["id"].is_string() && value["topicId"].is_string() && value["title"].is_string()
        && matches!(value["part"].as_u64(), Some(1..=3)) && value["revision"].is_u64()
        && value["startedAt"].is_string() && value["updatedAt"].is_string()
        && matches!(value["phase"].as_str(), Some("questions" | "prepare" | "long-turn" | "follow-up" | "finished"))
        && value["elapsedMs"].is_u64() && value["phaseStartedMs"].is_u64()
        // 2026-11-21：兼容没有预设考官音色的旧会话。
        && (value["examinerVoice"].is_null() || matches!(value["examinerVoice"].as_str(), Some("bf_emma" | "bm_george")))
        && (value["runningSince"].is_null() || value["runningSince"].is_u64())
        && value["messages"].as_array().is_some_and(|items| items.iter().all(|item| {
            matches!(item["role"].as_str(), Some("assistant" | "user")) && item["content"].is_string()
                && item["at"].is_string() && item["elapsedMs"].is_u64() && item["phase"].is_string()
                // 2026-11-21：旧口语记录可无录音，新附件只能挂在用户语音上。
                && (item["audioId"].is_null() || (item["role"].as_str() == Some("user") && item["input"].as_str() == Some("voice")
                    && item["audioId"].as_str().is_some_and(|id| key(id).is_ok())))
        }))
}

// 2026-11-27：在练习记录的批量删除事务中清理已结束会话及其录音。
pub(super) fn delete_finished_session(connection: &Connection, id: &str) -> CommandResult<()> {
    key(id)?;
    let Some(session) = document(connection, COLLECTION, id)? else { return Ok(()); };
    if session["phase"].as_str() != Some("finished") {
        return Err("只能从练习记录删除已结束的口语会话。".into());
    }
    if let Some(messages) = session["messages"].as_array() {
        for audio_id in messages.iter().filter_map(|item| item["audioId"].as_str()) {
            connection.execute(
                "DELETE FROM workspace_documents WHERE collection = ?1 AND id = ?2 AND json_extract(document_json, '$.sessionId') = ?3",
                params![AUDIO_COLLECTION, audio_id, id],
            ).map_err(message)?;
        }
    }
    connection.execute("DELETE FROM workspace_documents WHERE collection = ?1 AND id = ?2", params![COLLECTION, id]).map_err(message)?;
    Ok(())
}

#[tauri::command]
// 2026-11-21：语音与已校对的回答在同一个事务提交。
pub fn save_speaking_session(
    db: State<'_, Database>, mut session: Value, expected_revision: Option<u32>, recording: Option<String>,
) -> CommandResult<Value> {
    if !valid_session(&session) { return Err("口语练习记录格式无效。".into()); }
    let id = session["id"].as_str().ok_or("口语练习缺少标识。")?.to_owned();
    key(&id)?;
    let mut connection = db.lock()?;
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(message)?;
    let existing = document(&tx, COLLECTION, &id)?;
    let current = existing.as_ref().and_then(|value| value["revision"].as_u64());
    if current != expected_revision.map(u64::from) || (existing.is_some() && current.is_none()) {
        return Err("口语练习已在另一处更新，请重新打开此话题。".into());
    }
    // 2026-11-21：附件关联本次新追加的最后一条语音，旧版本写入失败时不会留下孤立录音。
    if let Some(recording) = recording {
        let old_messages = existing.as_ref().and_then(|value| value["messages"].as_array()).map_or(0, Vec::len);
        let items = session["messages"].as_array().ok_or("口语练习没有消息列表。")?;
        let audio_id = items.last().and_then(|item| item["audioId"].as_str())
            .filter(|_| items.len() == old_messages + 1).ok_or("录音缺少对应的用户回答。")?;
        if document(&tx, AUDIO_COLLECTION, audio_id)?.is_some() { return Err("该录音已保存。".into()); }
        recording_bytes(&recording)?;
        write_document(&tx, AUDIO_COLLECTION, audio_id, &json!({ "sessionId": id, "wav": recording }))?;
    }
    let revision = expected_revision.unwrap_or_default().checked_add(1).ok_or("无法更新口语练习版本。")?;
    session["revision"] = Value::from(revision);
    write_document(&tx, COLLECTION, &id, &session)?;
    tx.commit().map_err(message)?;
    Ok(session)
}

// 2026-11-21：历史回放只读取该练习对应的录音，并返回原始音频。
#[tauri::command]
pub fn read_speaking_audio(db: State<'_, Database>, session_id: String, audio_id: String) -> CommandResult<Response> {
    key(&session_id)?;
    key(&audio_id)?;
    let connection = db.lock()?;
    let recording = document(&connection, AUDIO_COLLECTION, &audio_id)?
        .filter(|value| value["sessionId"].as_str() == Some(session_id.as_str()))
        .ok_or("这条口语录音已不可用。")?;
    if !references_audio(&connection, &session_id, &audio_id)? { return Err("口语记录中找不到这条录音。".into()); }
    let encoded = recording["wav"].as_str().ok_or("这条口语录音已不可用。")?;
    Ok(Response::new(recording_bytes(encoded)?))
}
