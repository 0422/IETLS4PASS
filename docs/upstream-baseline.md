<!-- 2026-11-19：记录本次桌面迁移使用的上游快照、资源清点结果和来源。 -->
# 上游迁移基线

来源为 [sallowayma-git/IELTS-practice 的 main 分支](https://github.com/sallowayma-git/IELTS-practice/tree/main)。使用用户提供的开发源码目录 `IELTS-practice-main/`。原目录包含 `scripts/`、`developer/`、构建产物和原始开发文件。

解压目录没有 `.git` 元数据，原始提交待核实。README 引用的 `eb233ac75a38779ed1e01b6116aeb24837ab24cc` 是上游发布说明中的历史验收点。此次迁移可凭 982 个文件的目录指纹复现。

目录 SHA-256 为 `c1048e29202ef7b60471ae83333525daca2f89a49a2a3f7008a563529f5c60e6`。计算时以目录相对路径为键，将分隔符转换为 `/`，按 JavaScript 字符串的 UTF-16 顺序排序。对每个文件构造一条 UTF-8 的「相对路径 + NUL + 文件 SHA-256 小写十六进制 + LF」记录，对顺序拼接后的字节求 SHA-256。

| 资源 | 快照范围 |
|---|---|
| 阅读 | 239 篇，P1 74 篇、P2 78 篇、P3 87 篇 |
| 阅读解析 | 238 篇，`p3-low-240` 无解析登记 |
| 阅读配图 | 4 张内联题图，原快照另有统一练习页面使用的 SVG |
| 阅读 PDF | 题库清单有原路径字段，快照缺少 `ReadingPractice/` |
| 听力 | 通用练习页存在。题源、音频、PDF 及听力索引需用户自备 |
| 词表 | 上游带 IELTS 核心、CET4 和 ECDICT 阅读资料 |

上游代码许可见 [GPL-3.0](https://github.com/sallowayma-git/IELTS-practice/blob/main/LICENSE)，本地原副本位于 `IELTS-practice-main/LICENSE`。题源、文章、解析、图片等素材来源与使用范围以 [上游中文说明](https://github.com/sallowayma-git/IELTS-practice/blob/main/README.zh-CN.md) 为准。转换出的阅读和词表资产来源与原快照一致，用于本地学习。
