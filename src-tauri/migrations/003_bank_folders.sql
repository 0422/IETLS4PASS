-- 2026-11-19：持久化用户通过原生选择器绑定的题库目录，索引刷新复用同一个题库 ID。
CREATE TABLE bank_folders (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('reading', 'listening')),
    root TEXT NOT NULL,
    root_key TEXT NOT NULL,
    title TEXT NOT NULL,
    UNIQUE (kind, root_key)
) STRICT;
