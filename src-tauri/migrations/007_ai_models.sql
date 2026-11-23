-- 2026-11-21：将模型连接和密钥分别保存在工作区备份范围之外。
CREATE TABLE ai_model_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1))
) STRICT;

CREATE UNIQUE INDEX ai_model_one_active ON ai_model_connections (active) WHERE active = 1;

CREATE TABLE ai_model_credentials (
    connection_id INTEGER PRIMARY KEY REFERENCES ai_model_connections (id) ON DELETE CASCADE,
    api_key TEXT NOT NULL
) STRICT;
