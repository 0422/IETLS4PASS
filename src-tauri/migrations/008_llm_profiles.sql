-- 2026-11-21：连接可保存多个模型和请求参数，旧模型作为已有连接的首个选项。
ALTER TABLE ai_model_connections ADD COLUMN models_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ai_model_connections ADD COLUMN generation_parameters_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ai_model_connections ADD COLUMN timeout_seconds INTEGER NOT NULL DEFAULT 120 CHECK (timeout_seconds BETWEEN 5 AND 600);
UPDATE ai_model_connections SET models_json = json_array(model);
