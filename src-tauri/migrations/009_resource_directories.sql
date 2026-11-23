-- 2026-11-23：资源目录是当前机器的路径配置，与可迁移的练习备份分开保存。
CREATE TABLE resource_directories (
    kind TEXT PRIMARY KEY NOT NULL,
    root TEXT NOT NULL
) STRICT;
