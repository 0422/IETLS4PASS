# 写作题库、作文历史与图表输入

## 数据模型及样本

**VERIFIED** `data/writing/Task 1/` 和 `Task 2/` 下为题型目录及题面 JSON、题图子目录。实查 128 份题目，Task 1/2 各 64，`(meta.task, meta.questionId)` 128 个唯一组合。60 份有图引用，所有引用在默认目录找到；112 份有范文，16 份有非空 `note`。存在性未验证题图内容与原题语义一致。当前分类以 Task、图表/题型和话题为轴，没有 Academic/General Training 数据字段或 UI 筛选。观察到的小作文全部属于图表、地图或流程等类别，无信件类别。仅凭题源标签不能确认每篇正式出版类别。谱系在 `meta.code/book/questionId/source/questionPage/exportedAt`，当前 `WritingQuestion` 不保留来源 URL 或导出版本，不能从作文追溯当时资源版本。

```json
{
  "meta":{"task":"Task 1","category":"地图","topics":[],"code":"C12T6W1","book":"剑雅12 Test 6","questionId":"6739"},
  "prompt":{
    "blocks":[{"pageId":"8030","sctype":"302","kind":"写作题","html":"[带图 HTML，已截断]","text":"[截断]"}],
    "text":"[截断]",
    "images":[{"url":"[原图 URL]","file":"C12T6W1_剑雅12 Test 6_files/img_f902ed7778.png"}]
  },
  "modelAnswer":[{"html":"[截断]","text":"[截断]","band":null}],
  "modelAnswerAvailable":true,
  "note":null
}
```

上例来自 `data/writing/Task 1/地图/C12T6W1_剑雅12 Test 6.json`。下例为 `data/writing/Task 2/利弊比较题/C10T4W2_剑雅10 Test 4.json` 的字段投影。

```json
{
  "meta":{"task":"Task 2","category":"利弊比较题","topics":["社会生活类"],"code":"C10T4W2","book":"剑雅10 Test 4","questionId":"6860"},
  "prompt":{"blocks":[{"pageId":"8321","sctype":"302","kind":"写作题","html":"[截断]","text":"[截断]"}],"text":"[截断]","images":[]},
  "modelAnswer":[{"html":"[截断]","text":"[截断]","band":null}]
}
```

`parseWritingQuestion` 由路径和 meta 双重校验 Task，从 `meta.questionId` 取 ID（缺失回退相对文件名），把 `prompt.blocks[].html` 拼接，`images` 规范为 URL/相对文件、范文含可选 band。原文件 `note/raw` 未用于正式的解析 UI。Task 1 分类计数为柱 12、表 5、曲线 11、饼 7、混合 8、地图 11、流程 10。Task 2 原类目利弊 12、双边 21、同意与否 17、报告 13、是否同意 1（解析合并同意类共 18）。[writing.ts:2–77](../../src/domain/writing.ts) · [WritingPractice.tsx:12–47,111–122](../../src/features/WritingPractice.tsx)

## 作答与回看

1. **VERIFIED** `useWritingCatalog` 经 `bankFolders → scanBank → bankText → parseWritingQuestion` 加载。`/writing-practice` 用 URL 保存 Task、话题、题型。打开题目使用 `folder + question=相对文件`，范文附 `mode=model`。列表按 `writingQuestionKey(task,id)` 去重。默认柱状图，Task 2 有话题和题型联合筛选。
2. **VERIFIED** `WritingExercise.writingContent` 按 `prompt.images` 映射本地文件，用 `localImageRefs/useFolderMedia/readingFragment` 渲染，题面与范文可含图片。界面左题右编辑器/范文。textarea 的计词识别单词、数字、缩写、连字符和小数。`usePracticeClock` 只在开始/继续计时、作答视图活动时走表。离开未提交草稿和词数、计时不写库。正式提交不会保存时长、词数或任务计时模式。
3. **VERIFIED** `submit` 构造 `WritingSubmission {id,task,questionId,title,answer,submittedAt}`，调用 `desktop.put("writing-submissions", value.id, value)`。对同一待提交正文重试复用 UUID，成功后更新缓存，显示刚提交的只读内容。重新作答清空输入和时钟，下次提交新 UUID。仓库没有编辑历史/改稿版本链。`/records/writing/:id` 从集合读正文。写作题内可看到当前题目和范文，全局历史正文页不加载题源。
4. **VERIFIED** Rust `valid_writing_submission` 只校验提交字段与 ID 关系、有效 Task、非空字段，通用 `put_document` 保存。无“写作批改”专用端点。

[writingBank.ts:11–57](../../src/services/writingBank.ts) · [WritingExercise.tsx:21–99,125–157](../../src/features/WritingExercise.tsx) · [Records.tsx:165–184](../../src/features/Records.tsx) · [store.rs:163–171,353–379](../../src-tauri/src/store.rs)

| 字段 | 现状 |
|---|---|
| 原始题目、图片、范文 | PARTIAL 题库文件能读，提交只存 Task、questionId 和题目标题。没有快照、文件路径、bankId 或范文内容 |
| 用户原始正文、提交时间 | AVAILABLE 正式保存 answer 和 submittedAt，不含编辑轨迹。句子/词数可从正文用同一规则重算 |
| 修改作文、写作时长、练习模式 | MISSING 历史正文没有后续修订链。计时和范文切换 RUNTIME_ONLY，无法从 submittedAt 推回时长 |
| AI 评分、分项评价、逐句批改、重评分、建议 | NOT_IMPLEMENTED，无路由、数据模型、网络调用或持久化。评分 Prompt 原型存在，见 AI 报告 |
| 真题联系 | PARTIAL 保存 `task:questionId`，历史能从当前库找。不同目录重号、ID 回退路径变化或资源丢失会出现歧义或不可回溯 |

## 视觉输入及 AI 接入判断

**VERIFIED** 应用已具备按目录读取实际图像字节的能力，`desktop.bankMedia` 返回二进制再包装为 blob URL。**NOT_IMPLEMENTED** 目前的模型接口仅有 `TextMessage.content: String`，请求体没有 image_url、二进制或多模态内容部分，blob URL 只是设备本地引用，不能由云端模型读取。如果后续视觉服务可用，Task 1 需要在授权范围内向模型传送实图或可验证的图表数据。若无图或只能文字，图表数值、趋势和 Task Achievement 评价必须明确降级。当前配置的提供商是否支持可用视觉模型在本次审计为 **UNKNOWN**。 [folderBanks.ts::useFolderMedia](../../src/services/folderBanks.ts) · [llm.rs:95–120](../../src-tauri/src/llm.rs) · [openai_compatible.rs:10–30,53–90](../../src-tauri/src/llm/openai_compatible.rs)

IELTS 写作四项中，Task 1 为 Task Achievement，Task 2 为 Task Response，另三项为连贯与衔接、词汇、语法。官方写作科总分权重 Task 2 高于 Task 1。单篇提交能用于该任务的反馈，不能冒充全科官方 band。`data/skill-docs/ielts-writing-ai-teacher.md` 为现有提示词设计，未被运行时代码加载。接入候选是 `WritingExercise.save.onSuccess(_, value)` 后持久 ID 或后台选择已提交记录，展示可放 `WritingRecordDetail` 或写作题内的结果视图。当前本机写作 0 次正式样本，未验证运行中图像传递或批改链。[IELTS 写作细则](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail) · [官方 Writing Band Descriptors，2023-05](https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf)
