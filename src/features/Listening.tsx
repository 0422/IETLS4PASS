// 2026-11-19：听力首页按场景展示真题，选中一节再进入作答或静听。
// 2026-11-19：听力首页只读取题库和练习状态。
import { useQuery } from "@tanstack/react-query";
import { Headphones } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
// 2026-11-20：分类链接和题目列表共用场景识别规则。
// 2026-11-20：场景和顺序视图复用单节操作与成绩。
import { canListenToRow, latestListeningResult, listeningRows, listeningScene, listeningScenes } from "../domain/listening";
import type { ListeningDocument, ListeningDraft, ListeningRow, ListeningScene } from "../domain/listening";
import { desktop, desktopAvailable, documentsKey, errorText, recordsKey } from "../services/desktop";
import { ListeningSection } from "./ListeningSection";
// 2026-11-20：读取求职和经营管理的真题目录。
// 2026-11-20：顺序视图按册列出四个 Test。
import { listeningBooks, listeningCatalogGroups, listeningOrderGroups } from "../domain/listeningCatalog";
// 2026-11-19：在题库列表自动同步目录，作答期间保持当前题源。
import { useFolderBankSync } from "../services/folderBanks";

// 2026-11-19：分类栏只展示实际场景和「全部」。
// 2026-11-20：分类栏仅显示指定场景，保留未筛选的题库视图。
type Category = ListeningScene | "全部";

// 2026-11-20：允许直接进入本节的标准答案和详解。
// 2026-11-20：选中的书号随练习链接保留，退出后可返回同一册。
// 2026-11-27：区分个人交卷回看和标准答案详解。
function listeningLink(scene: Category, id?: string, mode?: "restart" | "listen" | "review" | "result", book?: number) {
  const search = new URLSearchParams();
  if (book !== undefined) {
    search.set("view", "order");
    search.set("book", String(book));
  }
  if (scene !== "全部") search.set("scene", scene);
  if (id) search.set("section", id);
  if (mode) search.set("mode", mode);
  return `/listening${search.size ? `?${search}` : ""}`;
}

export function Listening() {
  // 2026-11-19：分类和练习入口由链接驱动。
  const [search] = useSearchParams();
  const sync = useFolderBankSync("listening", !search.has("section") && !search.has("exam"));
  const enabled = desktopAvailable();
  const documents = useQuery({ queryKey: documentsKey("listening"), queryFn: () => desktop.documents<ListeningDocument>("listening"), enabled });
  const saved = useQuery({ queryKey: documentsKey("listening-drafts"), queryFn: () => desktop.documents<ListeningDraft>("listening-drafts"), enabled });
  const history = useQuery({ queryKey: recordsKey, queryFn: desktop.records, enabled });
  const rows = listeningRows(documents.data ?? []);
  // 2026-11-20：带旧场景名的链接也能定位到对应的新分类。
  const scene = listeningScene(search.get("scene") ?? undefined) ?? "全部";
  // 2026-11-20：首次切到顺序视图选中剑雅20，保留当前场景供切回。
  const book = search.get("view") === "order"
    ? listeningBooks.find((item) => String(item) === search.get("book")) ?? listeningBooks[0] : undefined;
  const back = listeningLink(scene, undefined, undefined, book);
  const id = search.get("section");
  const bank = search.get("bank");
  const exam = search.get("exam");
  const open = rows.find((row) => row.id === id || (!id && row.bankId === bank && row.legacyExamId === exam));
  const mode = search.get("mode") ?? "practice";
  // 2026-11-19：只显示题库、草稿和成绩读取错误。
  const error = documents.error || saved.error || history.error || sync.error || sync.data?.[0];
  const drafts = new Map((saved.data ?? []).map((document) => [document.id, document.value]));
  // 2026-11-27：列表和回看共用交卷记录，以提交时间选出最近一次。
  const results = [...(history.data ?? [])].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));

  if (open) {
    // 2026-11-20：只有作答依赖草稿，精听和详解可直接打开。
    // 2026-11-27：回看只读取正式交卷记录，保留本节未交卷的草稿。
    const practice = mode !== "listen" && mode !== "review" && mode !== "result";
    if (practice && saved.isLoading) return <p className="muted">正在读取听力草稿…</p>;
    if (practice && saved.error) return <p className="notice danger" role="alert">{errorText(saved.error)} <Link to={back}>返回听力题库</Link></p>;
    const result = mode === "result" ? latestListeningResult(open, results) : undefined;
    if (mode === "result" && !result) {
      if (history.isLoading) return <p className="muted">正在读取交卷记录…</p>;
      return <p className="notice" role="status">{history.error ? errorText(history.error) : "本节暂无交卷记录。"} <Link to={back}>返回听力题库</Link></p>;
    }
    // 2026-11-27：题面和录音分开存放时，优先使用同册同节的精听资料。
    const alternateAudio = open.book === undefined ? undefined : listeningOrderGroups(open.book, rows)
      .find(({ test }) => test === open.test)?.items.find(({ row }) => row?.section === open.section)?.audioRow;
    const intensiveRow = alternateAudio ?? open;
    const draft = drafts.get(open.id);
    return <ListeningSection key={`${open.id}:${practice ? "practice" : mode}`} row={open} mode={mode} draft={draft}
      back={back} result={result} intensiveRow={intensiveRow} />;
  }
  if (id || (bank && exam)) {
    if (documents.isLoading) return <p className="muted">正在读取听力题库…</p>;
    return <p className="notice" role="status">{documents.error ? errorText(documents.error) : "目录中找不到该 Section。"} <Link to={back}>返回听力题库</Link></p>;
  }

  const matching = scene === "全部" ? rows : rows.filter((row) => row.scene === scene);
  // 2026-11-20：顶栏切换题库视图，按顺序时在顶部横排显示各册。
  const views = <nav className="study-view-tabs" aria-label="听力题库视图">
    <Link to={listeningLink(scene, undefined, undefined, book ?? listeningBooks[0])} aria-current={book !== undefined ? "page" : undefined}>按顺序</Link>
    <Link to={listeningLink(scene)} aria-current={book === undefined ? "page" : undefined}>按场景</Link>
  </nav>;
  if (book !== undefined) return <>
    {views}
    <nav className="listening-books" aria-label="剑雅册数">
      {listeningBooks.map((item) => <Link key={item} to={listeningLink(scene, undefined, undefined, item)}
        aria-current={item === book ? "page" : undefined}>剑雅{item}</Link>)}
    </nav>
    {error && <p className="notice danger" role="alert">{errorText(error)}</p>}
    <div className="card table-scroll listening-catalog">
      <table>
        <thead><tr><th>听力真题</th><th>我的结果</th><th>练习答题</th></tr></thead>
        {listeningOrderGroups(book, rows).map(({ test, items }) => <tbody key={test}>
          <tr className="listening-book-heading"><th colSpan={3}>Test {test}</th></tr>
          {items.map(({ key, title, row, subtitle, audioRow }) => row
            ? <ListeningCatalogRow key={key} row={row} scene={scene} book={book} displayTitle={title} subtitle={subtitle}
                audioRow={audioRow} inProgress={drafts.get(row.id)?.examId === row.examId} result={latestListeningResult(row, results)} />
            : <tr key={key}>
              <td><b>{title}</b></td>
              <td className="listening-result"><span className="muted" aria-label="尚未提交">—</span></td>
              <td><ListeningActions scene={scene} book={book} /></td>
            </tr>)}
        </tbody>)}
      </table>
    </div>
  </>;
  // 2026-11-20：预设目录和普通列表共用草稿、成绩与练习入口。
  const groups = scene === "全部" ? undefined : listeningCatalogGroups(scene, rows);
  const renderRow = (row: ListeningRow, displayTitle?: string) => <ListeningCatalogRow key={row.id} row={row}
    scene={scene} displayTitle={displayTitle} inProgress={drafts.get(row.id)?.examId === row.examId}
    result={latestListeningResult(row, results)} />;
  // 2026-11-20：听力分类放在左列，题目和读取状态放在右列。
  // 2026-11-20：按场景视图沿用原有列表，在其上方显示视图切换。
  return <>
    {views}
    <div className="listening-layout">
    {/* 2026-11-19：首页顶部直接显示场景导航。 */}
    <nav className="listening-scenes" aria-label="听力场景">
      {/* 2026-11-20：按指定顺序显示 16 个分类，再点当前分类可清除筛选。 */}
      {listeningScenes.map((category) => <Link key={category} to={listeningLink(scene === category ? "全部" : category)}
        aria-current={scene === category ? "page" : undefined} title={scene === category ? "再次点击清除筛选" : undefined}>
        {category}
      </Link>)}
    </nav>
    {/* 2026-11-20：表格、空状态和错误提示共用右列。 */}
    <div>
      {error && <p className="notice danger" role="alert">{errorText(error)}</p>}
      {/* 2026-11-20：预设分类在题源就绪前也显示分组和目录条目。 */}
      {groups || matching.length ? <div className="card table-scroll listening-catalog"><table>
        {/* 2026-11-20：表头明确标出听力练习的操作列。 */}
        <thead><tr><th>听力真题</th><th>我的结果</th><th>练习答题</th></tr></thead>
        {groups ? groups.map(({ book, items }) => <tbody key={book ?? "other"}>
          <tr className="listening-book-heading"><th colSpan={3}>{book === undefined ? "其他资料" : `剑雅${book}`}</th></tr>
          {items.map(({ key, title, row }) => row ? renderRow(row, title) : <tr key={key}>
            {/* 2026-11-20：目录条目先显示操作位置，缺资料提示放到题名下方。 */}
            <td>{title}<small>{documents.isLoading ? "正在读取资料…" : "待添加资料"}</small></td>
            <td className="listening-result"><span className="muted" aria-label="尚未提交">—</span></td>
            <td><ListeningActions scene={scene} /></td>
          </tr>)}
        </tbody>) : <tbody>{matching.map((row) => renderRow(row))}</tbody>}
      </table></div> : <section className="card empty">
        <Headphones size={24} />
        {/* 2026-11-19：空题库引导到设置中的本地目录选择器。 */}
        <p>{documents.isLoading ? "正在读取听力题库…" : rows.length ? "该场景下暂无题目。" : "请在设置中选择本机听力目录。"}</p>
      </section>}
    </div>
    </div>
  </>;
}

// 2026-11-20：书号已在组标题显示时，行标题仅展示 Test 和 Part。
// 2026-11-20：顺序视图的副标题和精听可从同节导出的资料读取。
function ListeningCatalogRow({ row, scene, inProgress, result, displayTitle, subtitle = row.subtitle, book, audioRow }: {
  row: ListeningRow; scene: Category; inProgress: boolean; result: ReturnType<typeof latestListeningResult>;
  displayTitle?: string;
  subtitle?: string; book?: number; audioRow?: ListeningRow;
}) {
  return <tr>
    {/* 2026-11-20：副标题使用可用的本地资料内容。 */}
    <td><b>{displayTitle ?? row.title}</b>{subtitle && <small>{subtitle}</small>}{inProgress && <small>进行中</small>}</td>
    <td className="listening-result">{result ? <Link to={`/records/${encodeURIComponent(result.id)}`} title="查看本节最近一次结果">{result.points}/10</Link>
      : <span className="muted" aria-label="尚未提交">—</span>}</td>
    {/* 2026-11-20：已关联题源的条目使用与待添加条目一致的操作栏。 */}
    {/* 2026-11-20：保留当前册数及本节不同题源的入口。 */}
    {/* 2026-11-27：用同一条记录决定成绩显示和回看入口。 */}
    <td><ListeningActions scene={scene} row={row} inProgress={inProgress} book={book} audioRow={audioRow} hasResult={Boolean(result)} /></td>
  </tr>;
}

// 2026-11-20：题目和音频独立决定入口状态，旧题源仍可进入精听手选音频。
// 2026-11-20：题面与答案缺失时保留精听入口，并按来源分别生成链接。
// 2026-11-27：按场景和按顺序的每行都显示交卷回看入口。
function ListeningActions({ scene, row, inProgress, book, audioRow = row, hasResult }: {
  scene: Category; row?: ListeningRow; inProgress?: boolean; book?: number; audioRow?: ListeningRow; hasResult?: boolean;
}) {
  const source = row?.source;
  const canReview = source?.type === "paper" ? source.part.questions.length > 0
    : source?.entry.exportedListening?.hasAnswers ?? Boolean(source?.entry.file);
  return <div className="table-actions listening-row-actions">
    <ListeningAction label="答题" to={row?.potentialPractice ? listeningLink(scene, row.id, undefined, book) : undefined}
      hint={inProgress ? "继续作答" : "开始作答"} unavailable="缺少可作答的本节题目" />
    <ListeningAction label="查看" to={row && hasResult ? listeningLink(scene, row.id, "result", book) : undefined}
      hint="回看最近一次交卷" unavailable="本节暂无交卷记录" />
    <ListeningAction label="详解" to={row && canReview ? listeningLink(scene, row.id, "review", book) : undefined}
      hint="查看标准答案与解析" unavailable="缺少本节题目或标准答案" />
    <ListeningAction label="精听" to={audioRow && canListenToRow(audioRow) ? listeningLink(scene, audioRow.id, "listen", book) : undefined}
      hint="打开音频练习" unavailable="缺少本节音频" />
  </div>;
}

function ListeningAction({ label, to, hint, unavailable }: { label: string; to?: string; hint: string; unavailable: string }) {
  if (to) return <Link className="button secondary" to={to} title={hint}>{label}</Link>;
  return <span className="listening-unavailable-action" title={unavailable}>
    <button type="button" className="button secondary" aria-label={`${label}，${unavailable}`} disabled>{label}</button>
  </span>;
}
