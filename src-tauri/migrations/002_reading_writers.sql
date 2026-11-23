-- 2026-11-19：给阅读草稿建立单写者及递增版本；写者状态属于本机运行状态。
CREATE TABLE reading_draft_writers (
    draft_id TEXT PRIMARY KEY NOT NULL,
    attempt_id TEXT NOT NULL,
    writer_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
