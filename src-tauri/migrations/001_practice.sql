-- 2026-11-19：分开存储正式练习结果与草稿、词汇状态和设置，便于事务保存和备份。
CREATE TABLE practice_records (
    id TEXT PRIMARY KEY NOT NULL,
    submitted_at TEXT NOT NULL,
    record_json TEXT NOT NULL
) STRICT;

CREATE INDEX practice_records_by_date ON practice_records (submitted_at DESC, id);

CREATE TABLE workspace_documents (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    document_json TEXT NOT NULL,
    PRIMARY KEY (collection, id)
) STRICT;
