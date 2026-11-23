// 2026-11-19：口语题库从绑定的本机 JSON 加载，按 Part、分类和关键词浏览。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { mergeSpeakingTopics, parseSpeakingFile, speakingParts, speakingTopicId, speakingTopicMatches } from "../domain/speaking";
import type { SpeakingPart, SpeakingTopic } from "../domain/speaking";
import { desktop, desktopAvailable, errorText } from "../services/desktop";
import { folderRefreshInterval } from "../services/folderBanks";
// 2026-11-21：真题详情复用独立的口语对话页面。
import { SpeakingPractice } from "./SpeakingPractice";

interface SpeakingFolder {
  id: string;
  revision: string;
  topics: SpeakingTopic[];
  problems: string[];
}

export const speakingCatalogKey = ["speaking-catalog"] as const;

// 2026-11-23：总览和口语题库共用已加载的话题。
export function useSpeakingCatalog() {
  const cache = useQueryClient();
  return useQuery({
    queryKey: speakingCatalogKey, enabled: desktopAvailable(), retry: false,
    refetchInterval: folderRefreshInterval, refetchOnMount: "always", refetchOnWindowFocus: "always",
    queryFn: async () => {
      const folders = (await desktop.bankFolders()).filter((folder) => folder.kind === "speaking");
      const previous = new Map<string, SpeakingFolder>(cache.getQueryData<SpeakingFolder[]>(speakingCatalogKey)?.map((folder) => [folder.id, folder]));
      return Promise.all(folders.map(async ({ id, title }): Promise<SpeakingFolder> => {
        const prior = previous.get(id);
        try {
          const scan = await desktop.scanBank(id);
          if (prior && prior.revision === scan.revision) return prior;
          const topics: SpeakingTopic[] = [];
          const problems: string[] = [];
          for (const file of scan.files.filter((name) => /\.json$/i.test(name))) {
            try {
              const json: unknown = JSON.parse((await desktop.bankText(id, file)).replace(/^\uFEFF/, ""));
              topics.push(...parseSpeakingFile(json));
            } catch (reason) { problems.push(`${file} · ${errorText(reason)}`); }
          }
          return { id, revision: scan.revision, topics, problems };
        } catch (reason) {
          return { id, revision: "", topics: prior?.topics ?? [], problems: [`${title} · ${errorText(reason)}`] };
        }
      }));
    },
  });
}

function speakingLink(part: SpeakingPart, category = "", query = "", topic = "") {
  const search = new URLSearchParams({ part: String(part) });
  if (category) search.set("category", category);
  if (query) search.set("q", query);
  if (topic) search.set("topic", topic);
  return `/speaking?${search}`;
}

export function SpeakingBank() {
  const catalog = useSpeakingCatalog();
  const [search, setSearch] = useSearchParams();
  const part = speakingParts.find((item) => String(item) === search.get("part")) ?? 1;
  const category = search.get("category") ?? "";
  const query = search.get("q") ?? "";
  const topicId = search.get("topic");
  const folders = catalog.data ?? [];
  const topics = mergeSpeakingTopics(folders.map((folder) => folder.topics)).filter((topic) => topic.part === part);
  const categories = [...new Set(topics.map((topic) => topic.category))];
  const visible = topics.filter((topic) => (!category || topic.category === category) && speakingTopicMatches(topic, query));
  const problems = folders.flatMap((folder) => folder.problems);
  const back = speakingLink(part, category, query);

  function filter(name: "category" | "q", value: string) {
    const next = new URLSearchParams(search);
    if (value) next.set(name, value); else next.delete(name);
    setSearch(next, { replace: true });
  }

  if (topicId && !catalog.isLoading && !catalog.error) {
    const selected = topics.find((topic) => speakingTopicId(topic) === topicId);
    if (selected) return <SpeakingDetail topic={selected} back={back} />;
    // 2026-11-20：口语练习的返回文字与侧栏名称一致。
    // 2026-11-21：从真题话题返回时指向口语题库。
    return <p className="notice" role="status">找不到这个口语话题。 <Link to={back}>返回口语题库</Link></p>;
  }

  return <>
    <nav className="study-view-tabs" aria-label="口语分篇">
      {speakingParts.map((item) => <Link key={item} to={speakingLink(item)} aria-current={item === part ? "page" : undefined}>Part {item}</Link>)}
    </nav>
    <div className="filter-bar">
      <label className="search-field"><input type="search" aria-label="搜索口语话题" placeholder="搜索话题、题卡或问题" value={query}
        onChange={(event) => filter("q", event.currentTarget.value)} /></label>
      <label>分类<select value={category} onChange={(event) => filter("category", event.currentTarget.value)}>
        <option value="">全部分类</option>
        {categories.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
    </div>
    {catalog.error && <p className="notice danger" role="alert">{errorText(catalog.error)}</p>}
    {problems.length > 0 && <details className="notice"><summary>{problems.length} 项口语题源读取失败</summary>
      <ul>{problems.map((problem, index) => <li key={`${index}:${problem}`}>{problem}</li>)}</ul>
    </details>}
    <p className="list-caption">{visible.length} / {topics.length} 个话题</p>
    {visible.length ? <div className="card table-scroll"><table>
      <thead><tr><th>话题</th><th>分类</th><th>来源</th><th>操作</th></tr></thead>
      <tbody>{visible.map((topic) => {
        const id = speakingTopicId(topic);
        const to = speakingLink(part, category, query, id);
        return <tr key={id}><td><Link to={to}>{topic.title}</Link></td><td>{topic.category}</td>
          {/* 2026-11-21：详情页可直接开始口语练习。 */}
          <td>{topic.book || "—"}</td><td><Link to={to}>练习</Link></td></tr>;
      })}</tbody>
    </table></div> : <p className="card empty">{catalog.isLoading ? "正在读取口语题目…" : !folders.length
      ? "请在设置中选择口语目录或包含口语子目录的资料总目录。" : "当前筛选下没有口语话题。"}</p>}
  </>;
}

function SpeakingDetail({ topic, back }: { topic: SpeakingTopic; back: string }) {
  // 2026-11-21：主体为问答，题源按实际 Part 和阶段显示。
  return <section className="speaking-exercise exercise-page">
    {/* 2026-11-20：从话题详情返回口语练习列表。 */}
    {/* 2026-11-21：返回链接与移动后的口语题库名称一致。 */}
    {/* 2026-11-21：口语详情在同一行显示返回链接、话题和来源。 */}
    <header className="section-heading speaking-detail-heading">
      <Link className="back-link" to={back}>返回口语题库</Link>
      <h1>{topic.title}</h1>
      <p className="muted">{["Part " + topic.part, topic.category, topic.book].filter(Boolean).join(" · ")}</p>
    </header>
    {/* 2026-11-21：考试期间题目文字按需查看，结束后回看完整对话。 */}
    <SpeakingPractice key={speakingTopicId(topic)} topic={topic} />
  </section>;
}
