// 2026-11-21：管理本机文本模型连接，列表只返回密钥配置状态。
// 2026-11-21：序列化保存模型列表和高级参数，调用时读取当前连接。
use std::collections::HashSet;

use rusqlite::{params, types::Type, OptionalExtension, Row};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{State, Url};

use super::{message, CommandResult, Database};
use crate::llm::{GenerationParameters, TextModel};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConnection {
    id: i64,
    name: String,
    base_url: String,
    model: String,
    active: bool,
    has_api_key: bool,
    // 2026-11-21：列表不返回密钥，提供模型列表、默认参数和超时。
    models: Vec<String>,
    generation_parameters: GenerationParameters,
    // 2026-11-21：使用当前 rusqlite 支持的整数类型读取请求超时。
    timeout_seconds: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDraft {
    id: Option<i64>,
    name: String,
    base_url: String,
    model: String,
    api_key: String,
    // 2026-11-21：保存连接时一并校验和写入文本模型选项。
    models: Vec<String>,
    generation_parameters: Value,
    // 2026-11-21：请求超时以支持 SQLite 参数绑定的 u32 保存。
    timeout_seconds: u32,
}

// 2026-11-21：SQLite 的 JSON 列在存储层还原为列表或对象。
fn json_column<T: DeserializeOwned>(row: &Row<'_>, index: usize) -> rusqlite::Result<T> {
    let value: String = row.get(index)?;
    serde_json::from_str(&value)
        .map_err(|error| rusqlite::Error::FromSqlConversionFailure(index, Type::Text, Box::new(error)))
}

#[tauri::command]
pub fn list_ai_models(db: State<'_, Database>) -> CommandResult<Vec<ModelConnection>> {
    let connection = db.lock()?;
    let mut statement = connection.prepare(
        // 2026-11-21：同时读取配置页用于编辑和切换的字段。
        "SELECT c.id, c.name, c.base_url, c.model, c.active, s.connection_id IS NOT NULL,
                c.models_json, c.generation_parameters_json, c.timeout_seconds
         FROM ai_model_connections c LEFT JOIN ai_model_credentials s ON s.connection_id = c.id
         ORDER BY c.active DESC, c.id",
    ).map_err(message)?;
    let rows = statement.query_map([], |row| Ok(ModelConnection {
        id: row.get(0)?, name: row.get(1)?, base_url: row.get(2)?, model: row.get(3)?,
        active: row.get(4)?, has_api_key: row.get(5)?,
        // 2026-11-21：将模型列表与参数原样提供给设置页。
        models: json_column(row, 6)?, generation_parameters: json_column(row, 7)?, timeout_seconds: row.get(8)?,
    })).map_err(message)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(message)
}

#[tauri::command]
pub fn save_ai_model(db: State<'_, Database>, draft: ModelDraft) -> CommandResult<()> {
    let name = draft.name.trim();
    let base_url = draft.base_url.trim();
    let api_key = draft.api_key.trim();
    // 2026-11-21：按用户输入顺序去重，若原模型移除则采用第一个可用项。
    if name.is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) {
        return Err("请填写有效的服务名称。".into());
    }
    let mut seen = HashSet::new();
    let models: Vec<&str> = draft.models.iter().map(|model| model.trim())
        .filter(|model| !model.is_empty() && seen.insert(*model)).collect();
    if models.is_empty() || models.iter().any(|model| model.chars().count() > 200 || model.chars().any(char::is_control)) {
        return Err("请至少填写一个有效的模型名称。".into());
    }
    let requested = draft.model.trim();
    let model = if models.contains(&requested) { requested } else { models[0] };
    let timeout = draft.timeout_seconds;
    if !(5..=600).contains(&timeout) {
        return Err("请求超时需为 5–600 秒。".into());
    }
    let models_json = serde_json::to_string(&models).map_err(message)?;
    let parameters = GenerationParameters::from_json(draft.generation_parameters)?;
    let parameters_json = serde_json::to_string(&parameters).map_err(message)?;
    let parsed = Url::parse(base_url).map_err(|_| "请填写有效的 API 根地址。".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() || base_url.len() > 2048
        || !parsed.username().is_empty() || parsed.password().is_some() || parsed.query().is_some() || parsed.fragment().is_some()
        || base_url.chars().any(char::is_control) {
        return Err("API 根地址须使用 HTTP 或 HTTPS，且不能包含账户信息、查询参数或片段。".into());
    }
    if api_key.len() > 4096 || api_key.chars().any(char::is_control) {
        return Err("API Key 格式无效。".into());
    }

    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    let id = if let Some(id) = draft.id {
        let updated = transaction.execute(
            // 2026-11-21：连接与其当前模型、高级设置在同一事务更新。
            "UPDATE ai_model_connections SET name = ?2, base_url = ?3, model = ?4,
                models_json = ?5, generation_parameters_json = ?6, timeout_seconds = ?7 WHERE id = ?1",
            params![id, name, base_url, model, models_json, parameters_json, timeout],
        ).map_err(message)?;
        if updated == 0 { return Err("模型连接已不存在。".into()); }
        id
    } else {
        transaction.execute(
            // 2026-11-21：新连接保存模型列表和默认生成参数，沿用首个连接启用逻辑。
            "INSERT INTO ai_model_connections (name, base_url, model, active, models_json, generation_parameters_json, timeout_seconds)
             VALUES (?1, ?2, ?3, NOT EXISTS (SELECT 1 FROM ai_model_connections WHERE active = 1), ?4, ?5, ?6)",
            params![name, base_url, model, models_json, parameters_json, timeout],
        ).map_err(message)?;
        transaction.last_insert_rowid()
    };
    if !api_key.is_empty() {
        transaction.execute(
            "INSERT INTO ai_model_credentials (connection_id, api_key) VALUES (?1, ?2)
             ON CONFLICT(connection_id) DO UPDATE SET api_key = excluded.api_key",
            params![id, api_key],
        ).map_err(message)?;
    }
    transaction.commit().map_err(message)
}

#[tauri::command]
pub fn select_ai_model(db: State<'_, Database>, id: i64) -> CommandResult<()> {
    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    transaction.execute("UPDATE ai_model_connections SET active = 0 WHERE active = 1 AND id <> ?1", [id]).map_err(message)?;
    let updated = transaction.execute("UPDATE ai_model_connections SET active = 1 WHERE id = ?1", [id]).map_err(message)?;
    if updated == 0 { return Err("模型连接已不存在。".into()); }
    transaction.commit().map_err(message)
}

// 2026-11-21：同一连接内切换当前模型只修改选中项，避免覆盖密钥和其他配置。
#[tauri::command]
pub fn set_ai_model_variant(db: State<'_, Database>, id: i64, model: String) -> CommandResult<()> {
    let updated = db.lock()?.execute(
        "UPDATE ai_model_connections SET model = ?2 WHERE id = ?1
         AND EXISTS (SELECT 1 FROM json_each(ai_model_connections.models_json) WHERE value = ?2)",
        params![id, model],
    ).map_err(message)?;
    if updated == 0 { return Err("该模型已不在连接的可用列表中。".into()); }
    Ok(())
}

// 2026-11-21：以一次查询取得当前配置和密钥，网络调用前释放数据库锁。
pub(crate) fn load_text_model(db: &Database, id: Option<i64>) -> CommandResult<TextModel> {
    let connection = db.lock()?;
    connection.query_row(
        "SELECT c.base_url, c.model, c.timeout_seconds, c.generation_parameters_json, s.api_key
         FROM ai_model_connections c LEFT JOIN ai_model_credentials s ON s.connection_id = c.id
         WHERE c.id = ?1 OR (?1 IS NULL AND c.active = 1)",
        [id],
        |row| Ok(TextModel {
            base_url: row.get(0)?, model: row.get(1)?, timeout_seconds: row.get(2)?,
            parameters: json_column(row, 3)?, api_key: row.get(4)?,
        }),
    ).optional().map_err(message)?.ok_or_else(|| {
        if id.is_some() { "模型连接已不存在。".into() } else { "请先在设置中启用一个文本模型连接。".into() }
    })
}

#[tauri::command]
pub fn delete_ai_model(db: State<'_, Database>, id: i64) -> CommandResult<()> {
    let mut connection = db.lock()?;
    let transaction = connection.transaction().map_err(message)?;
    transaction.execute("DELETE FROM ai_model_credentials WHERE connection_id = ?1", [id]).map_err(message)?;
    transaction.execute("DELETE FROM ai_model_connections WHERE id = ?1", [id]).map_err(message)?;
    transaction.execute(
        "UPDATE ai_model_connections SET active = 1
         WHERE id = (SELECT MIN(id) FROM ai_model_connections)
         AND NOT EXISTS (SELECT 1 FROM ai_model_connections WHERE active = 1)",
        [],
    ).map_err(message)?;
    transaction.commit().map_err(message)
}
