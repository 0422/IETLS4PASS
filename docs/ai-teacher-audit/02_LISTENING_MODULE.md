# 听力题库、作答与 AI 接入

## 实际题库和标识

**VERIFIED 实样** `data/listening/剑雅听力导出/剑雅{册}/Test {n}/Test {n}_Section {m}.json`。逐份扫描 256 个 Section，均为 `questions.ok=true`，十个正式题号均有可通过导航 `scoreCode` 关联的非空答案。每份有解析与句子，总计 10,119 句。其中 254 份每句均通过英文文本及起止时间格式检查，另 2 份有至少一句不满足该条件。256 个相对音频路径存在，33 份共有 43 个题图引用，均在默认目录找到。存在性检查未解码媒体或重放题目。顺序视图册 20–5，每册四个 Test，剑雅 12 使用 5–8，每个 Test 四节。另有场景预设，预设占位只在有匹配题源才能答题。当前目录路径可覆盖。[listeningCatalog.ts](../../src/domain/listeningCatalog.ts) · [Listening.tsx](../../src/features/Listening.tsx)

**VERIFIED** 至少三层身份。上游 `meta.questionId` 通常是整节来源 ID，另有 `bookId/testId/listenId`。业务 `examId=cambridge-<book>-<test>-<section>`，非剑雅可用目录题 examId 或 `section-N`。列表/草稿用 `ListeningRow.id=bankId:sourceKey`，正规成绩保存 `bankId + examId`，可识别旧目录 `legacyExamId`。导航 `orderId 1..40` 变成节内 `q1…q40`（每节十个正式号码），不是全库唯一，题面额外第 2 空可生成 q101 等内部标识。`scoreCode` 用于把一组控件映射到一或多个正式题号，`pageId` 可能覆盖题面/解析片段。题库索引/路径或绑定变化可能导致回溯失败。 [listening.ts:19–87,103–167](../../src/domain/listening.ts) · [listeningExport.ts:95–170](../../src/domain/listeningExport.ts)

## 真实结构与代表性题型

没有发现独立的规范化 JSON Schema。下面用真实样本的投影，缩短 HTML、正文、列表，保留类型和嵌套。实际的 `contentList[].content` 是 JSON **字符串**，第二个代码块展示各字符串解码后结构。未复制原始接口用户字段或整个原卷。

```json
{
  "meta": {"book":"剑雅10","bookId":"1190","test":"Test 1","testId":1231,"section":"Section 1","questionId":"6796","listenId":"161","totalQuestions":"10"},
  "questions":{
    "ok":true,
    "questionText":"[省略]",
    "raw":{"data":{
      "navList":[[{"sctype":"216","orderId":"1","scoreCode":"Q6796_303277","pageId":"8156","index":"1","exchange":"1"}]],
      "contentList":[{"content":"{\"sctype\":\"216\",\"title\":\"<table>…</table>\",\"content\":[{\"sccode\":\"Q6796_303277\",\"value\":[\"Ardleigh\"]}]}"}]
    }}
  },
  "answers":[{"questionIndex":1,"scoreCode":"Q6796_303277","rightAnswer":"Ardleigh","accepted":["Ardleigh"],"answerContent":"[省略]"}],
  "analysis":[{"pageId":"8156","html":"[省略]","text":"[省略]"}],
  "listening":{"audioFile":"[同目录文件名]","sentenceCount":52,"transcript":"[省略]","sentences":[{"sortNum":1,"start":"0.59","end":"4.58","en":"[省略]","zh":"[省略]"}]}
}
```

上例句子数组只摘第一项，时间单位为秒。听力引用路径可存在 `questions.images: [{url:string,file:string}]`，样本 `剑雅7/Test 3/Test 3_Section 2.json` 的图片选项带 HTML `img`，程序通过该映射加载本机题图。以下行的路径均相对于 `data/listening/剑雅听力导出/`。

| 类型 | 实样和解码后字段投影 |
|---|---|
| 富文本说明 101，493 个块 | 剑雅10/Test 1/Test 1_Section 1.json，`{sctype:"101",title:"<p>…</p>",name:"富文本"}`，不参与计分 |
| 填空及表格 216，222 个块 | 同上，`{sctype:"216",title:"<table>…</table>",content:[{sccode:"Q6796_303277",sccnt:1,valcnt:1,value:["Ardleigh"],singlesc:"1",exchange:"1",sptype:"1"}]}`。表格是同一题型的 HTML 容器，另可见笔记/普通文本内嵌输入位 |
| 单选/多选 201，551 个块 | 剑雅10/Test 1/Test 1_Section 2.json 的真实多选 `{sctype:"201",sccode:"Q6802_141680",sccnt:2,valcnt:2,value:"AC",options:[{name:"A",option:"the gym"}]}`，两个导航项 orderId 为字符串 "11"/"12"。单选同结构对应一个正式题号 |
| 图片选项 202，1 个块 | 剑雅7/Test 3/Test 3_Section 2.json，`{sctype:"202",sccode:"Q6989_250807",sccnt:1,valcnt:1,value:"C",options:[{name:"A",option:"<p><img … /></p>"}]}` |
| 匹配 208，65 个块 | 剑雅10/Test 2/Test 2_Section 2.json，`{sctype:"208",head:"Features",options:[{name:"A",option:"ancient forts"}],content:[{sccode:"Q6876_597093",value:"E",sccnt:1,valcnt:1,order:1,isUpper:0}]}`。转原位选择及匹配支持 |
| 地图/表格单选矩阵 223，12 个块 | 剑雅11/Test 1/Test 1_Section 2.json，`{sctype:"223",sccode:"Q6736_779007",sccnt:6,valcnt:6,title:["A"],value:["F","G"],options:[{name:1,option:"Scarecrow"}]}`。标签和值列表已截断，地图图像在其他富文本块。文件含地图题指示 |

解析 `parseListeningExport` 用文件名与 meta 核对书/Test/Section，解码 101/201/202/208/216/223，生成 `ListeningExportBlock` 与 `ReadingExam`。优先采用有题号/评分码的 `answers[].accepted`，回退 `rightAnswer` 按竖线或题组规则拆分、再回到嵌入答案。两个空可用逗号组织，额外题号和互换规则进 `ListeningAnswerPair`。`questions.items` 与简式 `ietls4pass-listening-v1` 是兼容结构，本次扫描的 256 份属于当前抓取版。旧 HTML 仅用单节格式，PDF 可作参考。`questions.ok=false` 或题不全时可保留精听或题面参考。 [listeningExport.ts:31–230](../../src/domain/listeningExport.ts) · [ListeningSection.tsx:60–219](../../src/features/ListeningSection.tsx)

**PARTIAL 证据粒度** 精听把句子 en 与合法的秒时间转换为 `{text,start?,end?}`，时间无效仍保留文本，缺句列表时回退合并原文。根据 `audio.currentTime` 高亮句、可按句跳转，支持音频倍速/循环/暂停。raw 的 zh 与 sortNum 未进入该 DTO。实样每节都有至少一个 `analysis[].pageId` 对上导航；它是页面/题组线索，不能当逐题时间定位。当前前端只保留解析文字顺序，未传递 pageId，也无可用的 `questionId → sentenceId/start/end` 字段或索引。[listeningExport.ts:197–230](../../src/domain/listeningExport.ts) · [ListeningSection.tsx:393–452](../../src/features/ListeningSection.tsx)

## 从打开到交卷的调用链

1. **VERIFIED** `Listening` 取 `listening`、`listening-drafts` 两个文档集合和 `list_records`，按 `section` 参数找行。`ListeningSection → loadSection` 读取本机 JSON/HTML、解析题面、用相对目录关联录音与图片。`ListeningMedia` 用 HTMLAudioElement，本节可用本机音频或临时文件。
2. 每节点击开始才写入 `startedAt`。`SectionAttempt.change/persist` 当场串行保存答案快照、活动时长、播放位置、高亮。暂停、退出、启动和交卷也可留快照。Rust `save_listening_draft` 比对 ID/递增版本，冲突返回错误。正常退出等保存成功，播放器时间更新本身不会写事件日志。
3. `confirmSubmission` 检查十个正式题号；两个空都填才算答完该题，有空需确认。`submit` 暂停播放，保存最终草稿，在前端调用 `scoreListeningExport`，冻结成 `PracticeRecord`；Rust 核对 ID/版本/答案及 0–10、满分与逐题结构，事务插入成绩并删除该草稿。原 ID 已提交可回读，重新练习创建新 UUID 并可替换未交卷草稿。
4. 交卷后保留原题、红绿判分、答案对比、解析和可打开的精听面板。列表「查看」按记录时间选该题库/同节最新正式结果。独立「详解」是题库标准答案与解析，独立「精听」不要求作答。总览的某条听力历史可以显示该记录的判分，当前不会查找本节题库文件或回放原题。

[ListeningSection.tsx:501–615,627–828](../../src/features/ListeningSection.tsx) · [Listening.tsx:37–91](../../src/features/Listening.tsx) · [store/listening.rs](../../src-tauri/src/store/listening.rs) · [Records.tsx:186–260](../../src/features/Records.tsx)

**VERIFIED 判分细节** `answersMatch` 复用阅读的大小写、引号、连字符、空白、选项标签及 TF/YN 同义规约。普通答案数组可表示多个可接受答案，单个作答命中其中一项即可；集合型分支另算，空作答不命中。标准多选有多个正式题号时，通过共同选项集去重比较，超选不获分，每个匹配标准项对应可得 1 分。旧 HTML 的 `listening-set` 要求集合完全匹配。成对空若允许互换并能提高分数则采用交换；额外双空一题需要两空均正确才得 1 分，保留分位用户答案。交卷以 `sum(points)/10` 为小节正确率，非官方 40 题 Band。规则与分支以 `scoring.ts:10–138`、`listeningExport.ts:31–60` 为准。

## 字段、回溯与接入

| 项目 | 已确认状态 |
|---|---|
| session_id、题号、真题来源 | 正式持久化 UUID 作为 `id`，`bankId/examId/category/title/source`、逐题 `questionId`。不含上游完整 meta/文件版本 |
| 用户答案、正确答案、结果 | 正式持久化 `answers` 与 `details[{questionId,label,userAnswer,correctAnswer,points,possible,type}]`，也有总分 |
| 练习时间、Section 用时 | 正式持久化 `startedAt/submittedAt/elapsedMs`。共享计时只累加可见且有焦点、活动时段；与 MP3 时长不同 |
| 音频进度、暂停与重播 | 草稿有最后播放位置。暂停状态、倍速、进度与切句有运行状态。无正式事件序列、每次重播或每次暂停统计 |
| 单题用时、答案修改轨迹、用户自评、AI 结果 | NOT_IMPLEMENTED。草稿覆盖当前答案，仅最后快照。题面与精听高亮可保留，后者以题节为单位，非单次自评 |
| 首次或重复 | DERIVABLE，按有效的题库/节身份与各次提交时间归集。已删除或旧来源不明时无法知全量首次 |

**PARTIAL 单个 ID 可重建条件** `desktop.records` 中查 ID 后，原答案/结果已随记录，题干、原文、解析、音频需利用存量题库加载。活跃样本 1/1 能用银行目录索引和默认文件回溯。旧成绩、重绑目录、临时选择音频及版本替换可使材料缺失或变异。默认目录无不可变资源快照。建议设计接入时以 `SectionAttempt.submit.onSuccess(record)` 或正式持久化事件为契机，计算所需证据时复用 `loadSection/parseListeningExport`、现存 `AnswerReview/ListeningResultPage`。后续报告可显示在该成绩回看，区分题库详解与推断。此处只识别位置。
