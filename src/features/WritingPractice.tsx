// 2026-11-20：写作练习沿用口语的顶部切换，小作文进入时按柱状图筛选。
import { NotebookPen } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
// 2026-11-23：题库去重和学习进度共用题目标识。
import { writingQuestionKey } from "../domain/writing";
// 2026-11-21：从本机写作目录读取分类列表，并打开同题的作答与范文视图。
import { desktopAvailable, errorText } from "../services/desktop";
import { useWritingCatalog } from "../services/writingBank";
import { WritingExercise } from "./WritingExercise";

const tasks = [
  { id: "1", label: "小作文" },
  { id: "2", label: "大作文" },
] as const;

const charts = [
  { id: "bar", label: "柱状图" },
  { id: "table", label: "表格" },
  { id: "line", label: "曲线图" },
  { id: "pie", label: "饼状图" },
  { id: "mixed", label: "混合图" },
  { id: "map", label: "地图" },
  // 2026-11-21：导出的 Task 1 包含流程图。
  { id: "process", label: "流程图" },
] as const;

// 2026-11-20：大作文按话题和题型独立筛选，两组都从全部开始。
const essayFilters = [
  { key: "topic", label: "话题", options: [
    { id: "all", label: "全部" },
    { id: "education", label: "教育类" },
    { id: "technology", label: "科技类" },
    { id: "culture", label: "传统与文化类" },
    { id: "urban-global", label: "城市化与全球化" },
    { id: "government", label: "政府类" },
    { id: "environment", label: "环境类" },
    { id: "media", label: "媒体类" },
    { id: "social", label: "社会生活类" },
    { id: "abstract", label: "抽象类" },
  ] },
  { key: "type", label: "题型", options: [
    { id: "all", label: "全部" },
    { id: "opinion", label: "同意与否题" },
    { id: "advantages", label: "利弊比较题" },
    { id: "discussion", label: "双边讨论题" },
    { id: "report", label: "报告类" },
  ] },
] as const;

export function WritingPractice() {
  const [search, setSearch] = useSearchParams();
  // 2026-11-21：题目路径与目录 ID 一起定位，兼容重复的导出题号标签。
  const questionFile = search.get("question");
  const folderId = search.get("folder");
  const catalog = useWritingCatalog(!questionFile);
  const task = tasks.find((item) => item.id === search.get("task")) ?? tasks[0];
  const chart = charts.find((item) => item.id === search.get("chart")) ?? charts[0];
  const smallEssay = task.id === "1";
  // 2026-11-20：从链接恢复两组选择，识别不到的值按全部显示。
  const filters = essayFilters.map(({ key, label, options }) => ({
    key, label, options,
    selected: options.find((option) => option.id === search.get(key)) ?? options[0],
  }));
  const activeFilters = filters.filter(({ selected }) => selected.id !== "all").map(({ selected }) => selected.label);
  const emptyMessage = smallEssay ? `暂无${chart.label}题目。`
    : activeFilters.length ? `暂无符合「${activeFilters.join(" · ")}」的题目。` : "暂无大作文题目。";

  // 2026-11-20：小作文和大作文共用按钮组，小作文显示一组图表题型。
  const filterGroups = smallEssay ? [{ key: "chart" as const, label: "题型", options: charts, selected: chart }] : filters;
  function setWritingFilter(key: (typeof filterGroups)[number]["key"], value: string) {
    if (key === "chart") {
      setSearch({ task: "1", chart: value });
      return;
    }
    setSearch((current) => {
      const next = new URLSearchParams(current);
      next.set("task", "2");
      if (value === "all") next.delete(key);
      else next.set(key, value);
      return next;
    });
  }

  // 2026-11-21：切换题目视图时保留列表类别，返回时恢复所选筛选条件。
  const listSearch = new URLSearchParams(search);
  for (const key of ["question", "folder", "mode"]) listSearch.delete(key);
  const link = (id: string, file: string, viewingModel = false) => {
    const next = new URLSearchParams(listSearch);
    next.set("folder", id);
    next.set("question", file);
    if (viewingModel) next.set("mode", "model");
    return `/writing-practice?${next}`;
  };
  const back = `/writing-practice${listSearch.size ? `?${listSearch}` : ""}`;
  const folders = catalog.data ?? [];
  if (catalog.isLoading) return <p className="muted" role="status">正在读取写作题库…</p>;
  if (questionFile) {
    const folder = folders.find(({ id }) => id === folderId);
    const question = folder?.questions.find(({ file }) => file === questionFile);
    if (!folder || !question) return <p className="notice" role="status">
      {catalog.error ? errorText(catalog.error) : "本地目录中找不到这道写作题。"} <Link to={back}>返回写作题库</Link>
    </p>;
    return <WritingExercise key={`${folder.id}:${question.file}`} question={question} folderId={folder.id} files={folder.files}
      viewingModel={search.get("mode") === "model"} practice={link(folder.id, question.file)} model={link(folder.id, question.file, true)} back={back} />;
  }

  const unique = new Set<string>();
  const questions = folders.flatMap(({ id, questions }) => questions.flatMap((question) => {
    const identity = writingQuestionKey(question.task, question.id);
    if (question.task !== task.id || unique.has(identity)) return [];
    unique.add(identity);
    return [{ bankId: id, question }];
  }));
  const visible = questions.filter(({ question }) => smallEssay ? question.category === chart.label
    : filters.every(({ key, selected }) => selected.id === "all"
      || (key === "topic" ? question.topics.includes(selected.label) : question.category === selected.label)))
    .sort((a, b) => b.question.book - a.question.book || a.question.test - b.question.test
      || a.question.title.localeCompare(b.question.title, "zh-CN"));
  const problems = folders.flatMap(({ problems }) => problems);

  return <>
    <nav className="study-view-tabs" aria-label="写作类型">
      {tasks.map((item) => <Link key={item.id} to={`/writing-practice?task=${item.id}`}
        aria-current={item.id === task.id ? "page" : undefined}>{item.label}</Link>)}
    </nav>
    {/* 2026-11-20：按两个独立按钮组展示大作文筛选选项。 */}
    {/* 2026-11-20：用同一套按钮样式和选中状态展示所有写作筛选。 */}
    <div className="writing-filters">
      {filterGroups.map(({ key, label, options, selected }) => <div key={key} className="writing-filter-group" role="group" aria-label={label}>
        <span aria-hidden="true">{label}</span>
        <div className="writing-filter-options">
          {options.map((option) => <button key={option.id} className="button secondary" type="button"
            aria-pressed={option.id === selected.id} onClick={() => setWritingFilter(key, option.id)}>{option.label}</button>)}
        </div>
      </div>)}
    </div>
    {/* 2026-11-21：展示当前筛选结果，题面和范文支持独立进入。 */}
    {catalog.error && <p className="notice danger" role="alert">{errorText(catalog.error)}</p>}
    {problems.length > 0 && <details className="notice">
      <summary>{problems.length} 项写作题源读取失败</summary>
      <ul>{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>
    </details>}
    {folders.length > 0 && <p className="list-caption">{visible.length} / {questions.length} 道写作题</p>}
    {visible.length > 0 ? <div className="card table-scroll writing-catalog"><table>
      <thead><tr><th>题目</th><th>分类</th><th>操作</th></tr></thead>
      <tbody>{visible.map(({ bankId, question }) => <tr key={`${bankId}:${question.file}`}>
        <td>
          <Link to={link(bankId, question.file)}><strong>{question.title}</strong></Link>
          {question.prompt.text && <small className="writing-question-preview" lang="en">{question.prompt.text}</small>}
        </td>
        <td>{[question.category, ...question.topics].filter(Boolean).join(" · ")}</td>
        <td><div className="table-actions writing-row-actions">
          <Link className="button secondary" to={link(bankId, question.file)}>作答</Link>
          <Link className="button secondary" to={link(bankId, question.file, true)}>范文</Link>
        </div></td>
      </tr>)}</tbody>
    </table></div> : <section className="card empty" aria-live="polite">
      <NotebookPen size={24} aria-hidden="true" />
      <p>{emptyMessage}</p>
      {!folders.length && desktopAvailable() && <Link to="/settings">选择写作目录</Link>}
    </section>}
  </>;
}
