// 2026-11-19：建立独立的桌面导航与功能路由，统一处理浏览器预览和页面错误。
import { ArrowLeft, AudioLines, BookOpen, BookText, Bot, ChevronLeft, ClipboardCheck, Copy, FileCode2, FileText, FolderOpen, Globe, Headphones, LayoutDashboard, MessagesSquare, Mic, Minus, Monitor, NotebookPen, Settings2, Square, Target, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
// 2026-11-19：收集页面边界和桌面窗口的异常状态。
// 2026-11-19：在应用层维护侧栏展开状态。
// 2026-11-21：设置记住进入前的工作区地址。
// 2026-11-23：关闭窗口时等待后台写入，删除失败可以在切换页面后继续显示。
import { Component, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
// 2026-11-21：设置默认打开系统子页。
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Library } from "../features/Library";
import { Listening } from "../features/Listening";
import { Records, RecordDetail } from "../features/Records";
import { Recovery } from "../features/Recovery";
// 2026-11-21：设置子页分别加载系统、日志与 AI 模型。
import { LogSettings, SystemSettings, ThemeEffect } from "../features/Settings";
import { AiModelSettings } from "../features/AiModelSettings";
import { SpeakingBank } from "../features/SpeakingBank";
// 2026-11-20：写作练习进入可切换作文类型的页面。
import { WritingPractice } from "../features/WritingPractice";
// 2026-11-23：总览与学习成就入口使用独立视图。
import { Overview, StudyViews } from "../features/StudyOverview";
import { Vocabulary } from "../features/Vocabulary";
// 2026-11-21：课程笔记在学习工具分组中提供独立页面。
import { CourseNotes } from "../features/CourseNotes";
// 2026-11-22：Prompt 文档在学习工具中单独管理。
import { PromptDocuments } from "../features/PromptDocuments";
// 2026-11-19：正式成绩刷新后维护成就解锁进度。
import { AchievementProjection, Achievements } from "../features/Achievements";
import { ReadingPractice } from "../features/reading/ReadingPractice";
import { desktopAvailable } from "../services/desktop";
import { diagnosticReport, reportDiagnostic } from "../services/diagnostics";
// 2026-11-23：退出流程和全局提示共用词条删除队列。
import { vocabularyRemovals } from "../services/vocabularyRemovals";


// 2026-11-23：侧栏按真题、季度新题和 AI 考官分组。
const navigationGroups = [
  { title: "真题", links: [
    { path: "/listening", title: "听力题库", icon: Headphones },
    { path: "/speaking", title: "口语题库", icon: Mic },
    { path: "/writing-practice", title: "写作题库", icon: NotebookPen },
  ] },
  { title: "季度新题", links: [
    { path: "/library", title: "阅读练习", icon: FolderOpen },
    { path: "/speaking-practice", title: "口语练习", icon: MessagesSquare },
  ] },
  // 2026-11-23：在季度新题下方增加 AI 考官及两个独立模块入口。
  { title: "AI考官", links: [
    { path: "/ai-examiner/diagnosis", title: "学习诊断", icon: ClipboardCheck },
    { path: "/ai-examiner/training", title: "针对训练", icon: Target },
  ] },
];

// 2026-11-20：参考 DellaCRM 在最底部的总览与设置行之上放置辅助入口。
// 2026-11-21：风土人情和词汇基石并入同一底部工具组。
const utilityLinks = [
  { path: "/vocabulary", title: "词汇基石", icon: BookText },
  // 2026-11-22：发音纠正和 Prompt 文档紧随词汇基石。
  { path: "/pronunciation", title: "发音纠正", icon: AudioLines },
  { path: "/prompts", title: "Prompt 文档", icon: FileCode2 },
  // 2026-11-21：在风土人情上方进入课程笔记。
  { path: "/course-notes", title: "课程笔记", icon: NotebookPen },
  { path: "/culture", title: "风土人情", icon: Globe },
];

const bottomLinks = [
  // 2026-11-20：将总览放到设置左侧，原有草稿和归档仍从相应流程访问。
  { path: "/", title: "总览", icon: LayoutDashboard },
  { path: "/settings", title: "设置", icon: Settings2 },
];

// 2026-11-21：进入设置时使用独立的侧栏导航。
const settingsLinks = [
  { path: "/settings/system", title: "系统", icon: Monitor },
  { path: "/settings/logs", title: "日志", icon: FileText },
  { path: "/settings/ai-models", title: "AI 模型", icon: Bot },
];


// 2026-11-19：折叠时保留图标、悬停文字和可访问名称，子视图归到对应侧栏入口。
function SidebarLink({ link, activePath, collapsed }: { link: (typeof bottomLinks)[number]; activePath: string; collapsed: boolean }) {
  const { path, title, icon: Icon } = link;
  const active = path === activePath;
  return <Link to={path} className={active ? "nav-link active" : "nav-link"}
    aria-current={active ? "page" : undefined} aria-label={collapsed ? title : undefined} title={collapsed ? title : undefined}>
    <Icon size={18} strokeWidth={1.75} aria-hidden="true" /><span className="nav-label">{title}</span>
  </Link>;
}

// 2026-11-19：按本机偏好恢复侧栏宽度，存储不可用时仍能在本次会话操作。
const sidebarPreference = "ietls4pass-sidebar-collapsed";
function readSidebarPreference() {
  try { return localStorage.getItem(sidebarPreference) === "1"; }
  catch { return false; }
}

class PageBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "页面数据暂时无法显示。" };
  }

  // 2026-11-19：将渲染故障计入本地报告。
  componentDidCatch() { reportDiagnostic("page_render"); }

  render() {
    return this.state.error ? <section className="card">
      <h1>无法打开此页面</h1><p role="alert">{this.state.error}</p><Link to="/">返回总览</Link>
    </section> : this.props.children;
  }
}

// 2026-11-20：桌面控制按钮跟随系统窗口状态，空白区域交给 Tauri 拖动和双击切换。
function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  // 2026-11-23：正常关闭时用同一个查询客户端完成剩余词条写入。
  const cache = useQueryClient();
  const maximizeLabel = maximized ? "还原窗口" : "最大化";
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let active = true;
    function updateMaximized() {
      void appWindow.isMaximized().then((value) => {
        if (active) setMaximized(value);
      }).catch(() => reportDiagnostic("window_error"));
    }
    const listener = appWindow.onResized(updateMaximized);
    void listener.then(updateMaximized).catch(() => reportDiagnostic("window_error"));
    return () => {
      active = false;
      void listener.then((unlisten) => unlisten(), () => {});
    };
  }, []);

  // 2026-11-23：统一处理右上角关闭和 Alt+F4，保存完成后用主窗口的 destroy 权限退出。
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let active = true;
    let closing = false;
    const listener = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      if (!active || closing) return;
      closing = true;
      try {
        if (await vocabularyRemovals.flush(cache)) await appWindow.destroy();
      } catch {
        reportDiagnostic("window_error");
      } finally {
        closing = false;
      }
    });
    void listener.catch(() => reportDiagnostic("window_error"));
    return () => {
      active = false;
      void listener.then((unlisten) => unlisten(), () => {});
    };
  }, [cache]);

  function runWindowAction(action: "minimize" | "toggleMaximize" | "close") {
    void getCurrentWindow()[action]().catch(() => reportDiagnostic("window_error"));
  }

  return <div className="window-titlebar">
    <div className="window-drag-region" data-tauri-drag-region aria-hidden="true" />
    <div className="window-controls" role="group" aria-label="窗口控制">
      <button type="button" title="最小化" aria-label="最小化" onClick={() => runWindowAction("minimize")}>
        <Minus size={15} aria-hidden="true" />
      </button>
      <button type="button" title={maximizeLabel} aria-label={maximizeLabel} onClick={() => runWindowAction("toggleMaximize")}>
        {maximized ? <Copy size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
      </button>
      <button type="button" className="window-close" title="关闭窗口" aria-label="关闭窗口" onClick={() => runWindowAction("close")}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  </div>;
}

export function App() {
  const location = useLocation();
  // 2026-11-23：离开词汇页后仍能看到保存失败，词条会重新出现在词表中。
  const removalError = useSyncExternalStore(vocabularyRemovals.subscribe, vocabularyRemovals.error);
  const reading = location.pathname.startsWith("/reading/");
  // 2026-11-19：学习总览的统计、记录列表和记录详情高亮同一个侧栏入口。
  const path = location.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  // 2026-11-19：听力列表与答题共享路由，切换 Section 时正文从顶部开始。
  const listeningRoute = path === "/listening" ? new URLSearchParams(location.search) : undefined;
  const listeningSection = listeningRoute?.get("section") ?? listeningRoute?.get("exam");
  // 2026-11-19：从口语列表进出详情时重置正文滚动位置。
  const speakingTopic = path === "/speaking" ? new URLSearchParams(location.search).get("topic") : undefined;
  // 2026-11-21：切换写作题时回到页面顶部，切换作答与范文时保留当前题。
  const writingQuestion = path === "/writing-practice" ? new URLSearchParams(location.search).get("question") : undefined;
  const topicPage = listeningSection || speakingTopic || writingQuestion;
  // 2026-11-23：进入学习成就时，侧栏仍高亮总览。
  const studyView = path === "/achievements" || path === "/statistics" || path === "/records" || path.startsWith("/records/");
  const activePath = reading ? "/library" : studyView ? "/" : path;
  // 2026-11-21：设置返回保留题目、筛选等 URL 参数。
  const inSettings = path === "/settings" || path.startsWith("/settings/");
  const lastWorkspacePath = useRef("/");
  useEffect(() => {
    if (!inSettings) lastWorkspacePath.current = `${location.pathname}${location.search}${location.hash}`;
  }, [inSettings, location.pathname, location.search, location.hash]);
  const [collapsed, setCollapsed] = useState(readSidebarPreference);
  const toggleLabel = collapsed ? "展开侧边栏" : "收起侧边栏";
  const preview = !desktopAvailable();
  // 2026-11-19：让桌面诊断覆盖 React 事件和未处理的异步异常。
  useEffect(() => {
    if (preview) return;
    void diagnosticReport();
    const error = () => reportDiagnostic("window_error");
    const rejection = () => reportDiagnostic("unhandled_rejection");
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejection);
    return () => {
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejection);
    };
  }, [preview]);
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(sidebarPreference, next ? "1" : "0"); }
    catch { /* 2026-11-19：浏览器禁用存储时使用本次会话状态。 */ }
  }

  // 2026-11-19：共享工作区网格随侧栏展开状态调整宽度。
  // 2026-11-20：桌面有独立的窗口控制行，浏览器沿用原工作区布局。
  return <div className={`workspace${reading ? " is-reading" : ""}${collapsed ? " sidebar-collapsed" : ""}${preview ? "" : " desktop-workspace"}`}>
    <ThemeEffect />
    <AchievementProjection />
    <aside className="sidebar">
      {/* 2026-11-19：品牌图标和软件名同排，右侧提供侧栏折叠入口。 */}
      <div className="sidebar-brand-row">
        {/* 2026-11-19：展开态的品牌入口跳转总览，折叠态只显示可展开的书本按钮。 */}
        {!collapsed && <Link className="brand" to="/" aria-label="IETLS4PASS 总览">
          <span className="brand-icon"><BookOpen strokeWidth={1.8} size={19} aria-hidden="true" /></span>
          <strong>IETLS4PASS</strong>
        </Link>}
        <button className={collapsed ? "brand-icon sidebar-expand" : "sidebar-toggle"} type="button" title={toggleLabel} aria-label={toggleLabel}
          aria-expanded={!collapsed} aria-controls={inSettings ? "sidebar-navigation" : "sidebar-navigation sidebar-bottom"} onClick={toggleSidebar}>
          {collapsed ? <BookOpen strokeWidth={1.8} size={19} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
        </button>
      </div>
      {/* 2026-11-19：主导航分组滚动，底部入口保持可见。 */}
      <div className="sidebar-navigation" id="sidebar-navigation">
        {/* 2026-11-19：隐藏指定分组的标题时省去标题元素，保留导航的无障碍名称。 */}
        {/* 2026-11-20：题库和练习两组都显示分组名称。 */}
        {/* 2026-11-21：设置子页共用折叠行为，返回入口指向进入设置前的页面。 */}
        {inSettings ? <>
          <nav className="sidebar-group" aria-label="返回工作区">
            <SidebarLink link={{ path: lastWorkspacePath.current, title: "返回", icon: ArrowLeft }} activePath={activePath} collapsed={collapsed} />
          </nav>
          <nav className="sidebar-group" aria-label="设置分类">
            {/* 2026-11-21：设置侧栏直接显示子页名称，隐藏重复的分组标题。 */}
            {settingsLinks.map((link) => <SidebarLink key={link.path} link={link} activePath={activePath} collapsed={collapsed} />)}
          </nav>
        </> : navigationGroups.map(({ title, links }) => <nav key={title} className="sidebar-group" aria-label={title}>
          <div className="sidebar-group-title" aria-hidden="true">{title}</div>
          {links.map((link) => <SidebarLink key={link.path} link={link} activePath={activePath} collapsed={collapsed} />)}
        </nav>)}
      </div>
      {/* 2026-11-20：底部导航的名称与两个可见入口一致。 */}
      {/* 2026-11-20：底部区上方是词汇基石，下方并排放置总览和设置。 */}
      {/* 2026-11-21：工作区底部入口仅在主侧栏展示。 */}
      {!inSettings && <div className="sidebar-footer" id="sidebar-bottom">
        {/* 2026-11-21：在总览和设置上方提供两项学习工具。 */}
        <nav className="sidebar-utility" aria-label="学习工具">
          {utilityLinks.map((link) => <SidebarLink key={link.path} link={link} activePath={activePath} collapsed={collapsed} />)}
        </nav>
        <nav className="sidebar-bottom" aria-label="总览与设置">
          {bottomLinks.map((link) => <SidebarLink key={link.path} link={link} activePath={activePath} collapsed={collapsed} />)}
        </nav>
      </div>}
    </aside>
    {/* 2026-11-20：窗口按钮对齐侧栏品牌行并保持在正文滚动区外。 */}
    {!preview && <WindowControls />}
    {/* 2026-11-19：正文独立滚动，切换页面时从正文顶部开始。 */}
    <main className="main-content" key={topicPage ? `${location.pathname}:${topicPage}` : location.pathname}>
      {/* 2026-11-23：后台词条删除失败时提示，正常删除无需弹窗。 */}
      {removalError && <div className="notice danger table-actions" role="alert">
        {removalError}<button type="button" className="text-button" onClick={vocabularyRemovals.dismissError}>关闭提示</button>
      </div>}
      {/* 2026-11-21：预览提示使用调整后的阅读练习名称。 */}
      {preview && <div className="notice preview-note" role="status">正在浏览器预览。阅读练习和评分可用，本机保存需在桌面应用中操作。</div>}
      {/* 2026-11-19：正文按路径重新挂载时一并重置页面错误状态。 */}
      <PageBoundary>
        <Routes>
          {/* 2026-11-19：三个学习视图共用切换栏，保留已有的记录和统计链接。 */}
          <Route element={<StudyViews />}>
            <Route index element={<Overview />} />
            <Route path="records" element={<Records />} />
            <Route path="records/:id" element={<RecordDetail />} />
            {/* 2026-11-23：旧阅读统计链接转到学习成就。 */}
            <Route path="achievements" element={<Achievements />} />
            <Route path="statistics" element={<Navigate to="/achievements" replace />} />
          </Route>
          <Route path="library" element={<Library />} />
          <Route path="reading/:bankId/:examId" element={<ReadingPractice />} />
          <Route path="listening" element={<Listening />} />
          {/* 2026-11-19：口语目录题源入口。 */}
          <Route path="speaking" element={<SpeakingBank />} />
          {/* 2026-11-20：小作文和大作文通过写作练习页切换。 */}
          <Route path="writing-practice" element={<WritingPractice />} />
          {/* 2026-11-21：季度口语练习和风土人情使用独立页面，显示当前暂无资料。 */}
          <Route path="speaking-practice" element={<section className="card empty">
            <MessagesSquare size={24} aria-hidden="true" /><p>暂无季度口语练习题目。</p>
          </section>} />
          {/* 2026-11-23：为 AI 考官的两个入口接通独立页面，后续接入诊断和训练内容。 */}
          <Route path="ai-examiner/diagnosis" element={<section className="card empty">
            <ClipboardCheck size={24} aria-hidden="true" /><p>暂无学习诊断。</p>
          </section>} />
          <Route path="ai-examiner/training" element={<section className="card empty">
            <Target size={24} aria-hidden="true" /><p>暂无针对训练。</p>
          </section>} />
          <Route path="culture" element={<section className="card empty">
            <Globe size={24} aria-hidden="true" /><p>暂无风土人情资料。</p>
          </section>} />
          <Route path="vocabulary" element={<Vocabulary />} />
          {/* 2026-11-22：发音纠正先提供独立入口，提示词可在 Prompt 文档中编辑。 */}
          <Route path="pronunciation" element={<section className="card empty">
            <AudioLines size={24} aria-hidden="true" /><p>暂无发音纠正练习。</p>
          </section>} />
          <Route path="prompts" element={<PromptDocuments />} />
          {/* 2026-11-21：课程笔记浏览与编辑 Markdown 文件。 */}
          <Route path="course-notes" element={<CourseNotes />} />
          <Route path="drafts" element={<Recovery />} />
          {/* 2026-11-21：为设置分类提供独立地址，旧设置入口进入系统。 */}
          <Route path="settings">
            <Route index element={<Navigate to="system" replace />} />
            <Route path="system" element={<SystemSettings />} />
            <Route path="logs" element={<LogSettings />} />
            <Route path="ai-models" element={<AiModelSettings />} />
          </Route>
          <Route path="*" element={<p className="notice">未找到这个页面。<Link to="/">返回总览</Link></p>} />
        </Routes>
      </PageBoundary>
    </main>
  </div>;
}
