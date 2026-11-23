-- 2026-11-19：保存本机回退点和有限保留期的诊断事件。
CREATE TABLE workspace_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL CHECK (source IN ('manual', 'before-replace')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    records INTEGER NOT NULL,
    documents INTEGER NOT NULL,
    backup_json TEXT NOT NULL CHECK (json_valid(backup_json))
);

CREATE TABLE diagnostic_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    detailed_until TEXT
);

INSERT INTO diagnostic_preferences (id, enabled) VALUES (1, 1);

CREATE TABLE diagnostic_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    operation TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('error', 'ok'))
);
