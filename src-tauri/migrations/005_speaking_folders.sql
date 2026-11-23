-- 2026-11-19：为口语复用本机目录绑定，保留原有阅读和听力的目录标识。
CREATE TABLE bank_folders_v5 (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('reading', 'listening', 'speaking')),
    root TEXT NOT NULL,
    root_key TEXT NOT NULL,
    title TEXT NOT NULL,
    UNIQUE (kind, root_key)
) STRICT;

INSERT INTO bank_folders_v5 (id, kind, root, root_key, title)
SELECT id, kind, root, root_key, title FROM bank_folders;
DROP TABLE bank_folders;
ALTER TABLE bank_folders_v5 RENAME TO bank_folders;
