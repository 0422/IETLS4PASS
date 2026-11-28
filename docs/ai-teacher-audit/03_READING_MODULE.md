# 阅读题库、作答、复盘与 AI 证据

## 数据组织和真实样本

**VERIFIED** 默认题源 `data/reading/index.json` 为 `IETLS4PASSBankV1`，包含 `entries/aliases`，题目文件从 `data/reading/reading/<examId>.json` 读取。实查 239 篇（P1 74、P2 78、P3 87）、238 份解析、3 个 alias、4 张媒体题图。默认题目是独立 Passage，P1/P2/P3 为分篇，无统一剑雅册/Test 数据模型。导出中有 `sourceRefs`（如 `shuiHtml/pdf/ieltsHtml`）及审核字段，当前 DTO 不以这些作为练习主键。`main:examId` 是默认逻辑身份，已绑定目录可读既有索引/转换题源/HTML/PDF，在 ID 不同的情况下用原版 alias 与识别规则合并进度。 [types.ts:2–63](../../src/domain/types.ts) · [banks.ts:15–109](../../src/services/banks.ts) · [folderBanks.ts:130–186](../../src/services/folderBanks.ts)

```json
{
  "exam": {
    "examId":"p1-high-01",
    "meta":{"title":"A Brief History of Tea 茶叶简史","category":"P1"},
    "passage":{"blocks":[{"blockId":"passage-main","kind":"html","html":"<h2>READING PASSAGE 1</h2>…"}]},
    "questionGroups":[{"groupId":"group-1","kind":"matching","questionIds":["q1"],"bodyHtml":"[截短]","allowOptionReuse":false}],
    "questionOrder":["q1"],
    "answerKey":{"q1":"viii"}
  },
  "explanation":{"passageNotes":[{"label":"[截短]","text":"[截短]"}],"questionExplanations":[{"items":[{"questionNumber":1,"questionId":"q1","text":"[截短]"}]}]}
}
```

上例数组截断到第一项。原始 HTML 保留标题、段落、表、图、选项、匹配控件。题目也可有 `questionDisplayMap`、`scoringGroups`，解析对象可空。实测 26 篇有 `data-paragraph`、30 篇的原文 HTML 包含定位控件标记（两项可能交叉），216 份有至少一条带 `questionId` 的逐题解析项。没有跨全库稳定一致的段落/证据映射。 [ReadingPaper.tsx:30–193](../../src/features/reading/ReadingPaper.tsx) · [readingHtml.ts::showReadingLocation](../../src/features/reading/readingHtml.ts)

| 业务题型 | 原始 kind、覆盖及真实样本 |
|---|---|
| True/False/Not Given | `true_false_not_given` 83 组，例如 `p1-low-02.json` group-2 q9 = "FALSE" |
| Yes/No/Not Given | `yes_no_not_given` 50 组，`p3-high-03.json` group-2 q5 = "NOT GIVEN" |
| 段落小标题、信息匹配、特征/人名匹配 | 原始多为 `matching` 113 组，或 `classification` 1 组。小标题例 `p1-high-01.json` group-1 q1 = "viii"。信息匹配例 `p2-high-225.json` group-1 q1 = "B"。评分时基于 lead/body 的英文短语推断细类，不能仅凭 `matching` 标签确定 |
| Summary、表格、句子、简答 | `summary_completion` 92 组（`p3-high-04.json` q1 = "K"），`table_completion` 68，`sentence_completion` 67，`short_answer` 37 |
| Multiple Choice | `single_choice` 85 组（`p3-high-03.json` q1 = "B"），`multi_choice` 46（`p2-high-09.json` q1 = "A"），另有 `multiple_choice` 1。实际是否多选依控件 |
| 图表、流程、笔记 | `diagram_completion` 12、`flow_chart_completion` 2、`notes_completion` 3，图表可为相对图片或 HTML |

## 作答和正式记录

- **VERIFIED** `Library` 读取题库索引、当前来源、草稿、成绩和复习计划。`/reading/:bankId/:examId` 经 `ReadingWorkspace → readingAsset` 加载；题面 HTML 用 allowlist 转换为 DOM。匹配支持拖放/选择，现代渲染由题组映射答案。PDF 或无可信答案的参考件分流。`mode=study` 是背题，`mode=replay&record=<id>` 是指定记录回看。
- **VERIFIED** `OpenReading` 创建 UUID 种子和独立 writer ID，Rust `open_reading_draft` 接回草稿并取得写者身份。`ReadingAttempt.snapshot/flush → useDraftWriter → save_reading_draft` 对答案、标记、高亮、笔记、时间进行防抖、节流/周期及离页保存。草稿含暂停状态。原级别是当前快照，历史答案更改未单独保存。题库列表读取时清理普通过期草稿，单篇草稿可续做。
- **VERIFIED** `ReadingAttempt.submit` 先冻结答案、阅题计时和判分（`raw.scoringVersion` 为 `upstream-reading-v1`），保存 `pendingResult` 后，把可用的复习计划一起提交。Rust `save_record` 验证写者与冻结快照、用同一事务写成绩和复习计划、删除草稿并解除写者；同 ID 重试复用现存记录。前端同页用 `AnswerReview` 显示，正式记录有原题入口、回放作答和个人批注。背题/回放不创建新的正式作答。
- **VERIFIED** 判分 `scoreReading` 每题通常 1 分。TRUE/T/YES/Y 与 FALSE/F/NO/N 分组归一，NG 变 NOT GIVEN。英文字母选项与带序号标签可比较。自由文本比较时统一变体标点和空白，再按大小写及字母数字比较；可能忽略标点差别，存在含义偏差风险。空值零分。普通答案数组对单项为可接受变体；复选控件走题组选择集合规则，复选单 ID 可能以多个期望项为满分。题型根据 `kind` 和说明推断。 [ReadingWorkspace.tsx](../../src/features/reading/ReadingWorkspace.tsx) · [ReadingAttempt.tsx:27–166](../../src/features/reading/ReadingAttempt.tsx) · [scoring.ts:5–156](../../src/domain/scoring.ts) · [store.rs::save_record](../../src-tauri/src/store.rs)

## 行为与具体分析能力

| 行为/分析 | 状态及证据 |
|---|---|
| 总耗时与单题计时 | PARTIAL `readingTiming` 版本 1、`foreground-selection`，题/共享题组单位、未分配毫秒、总计、完整性原因与 finalized。依据选中控件、可见/焦点和题面覆盖。会记录恢复尾部、旧草稿、长间隔或缺映射，不能当原文阅读区真实停留或注意力。同组不可拆成每题。见 `useReadingTiming.ts`、`readingTiming.ts`、`ReadingTimingPanel.tsx` |
| 答案修改和作答顺序 | RUNTIME_ONLY 当前答案随控件更新，正式保留最终答案和判分。无修改事件序列 |
| 高亮、笔记、题目标记 | AVAILABLE `ReadingAnnotations{notes,markedQuestions,highlights:[{blockId,start,end,text}]}` 进草稿及正式记录，回放覆盖另存 `annotations:<recordId>`。高亮必须与同块残留字符串校验，题源改版可失配 |
| 选词和词汇 | AVAILABLE `ReadingDictionary` 使用 ECDICT，阅读生词以词条、bank、exam 关联；无 attemptId，不能无条件认为词由该次到达 |
| 原文定位 | PARTIAL `AnswerReview` 以 questionId/number 对应解析，`showReadingLocation` 优先找可唯一匹配的解析引文，继而作者锚点、标出的段落或题面控件。位置为 DOM 层启发式，无每题持久定位结果或用户点击日志 |
| 错题归因、同义替换、长难句 | PARTIAL 原文、题面、最终答案、解析可构造引用及对照。无法证明用户为何选错；错因应为带证据的推断。有原文就能分析句法，题到句子的关系需验证 |
| 策略与题型能力 | PARTIAL 可按细类统计错题并观察时间，但题型细化有启发式不确定性，缺实读路径、修改日志与自评错因。重复练习可按同题排序推导 |
| AI 诊断、能力画像 | NOT_IMPLEMENTED。实查本机库有两份阅读草稿，无可验证的正式阅读样本 |

正式记录 ID 可独立找回已提交的答案和正确答案。回溯 `bankId/examId` 后才能得到当下可访问的文章和解析。早期迁移可能只有分数，缺答卷或映射；已不存在的文件及旧内容版本不能完整重建。适合在 `ReadingAttempt.submit` 成功返回 `stored PracticeRecord` 的位置观察，并在 `ReadingReplay` 或 `RecordDetail` 展示。先区分 AI 反馈与已有题库详解、现存 SM-2 复习计划。没有改动接入代码。
