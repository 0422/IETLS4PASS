// 2026-11-23：系统设置管理外观、资源目录和本机数据，日志页提供诊断。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useEffect } from "react";
// 2026-11-19：独立的备份和诊断组件复用桌面数据服务。
import { desktop, desktopAvailable, documentsKey, errorText } from "../services/desktop";
// 2026-11-23：清空工作区前先结束已发起的后台词条删除。
import { vocabularyRemovals } from "../services/vocabularyRemovals";
import { Backups } from "./Backups";
import { Diagnostics } from "./Diagnostics";
// 2026-11-27：在日志页维护本机的考试计划。
import { ExamPlanSettings } from "./ExamPlanSettings";
// 2026-11-23：系统设置提供统一资源目录入口。
import { ResourceDirectories } from "./ResourceDirectories";

type Theme = "system" | "light" | "dark";
// 2026-11-19：界面主题独立于题库和学习记录，动态背景可关闭。
type Background = "off" | "melody" | "academic" | "xiaodai";
export function useTheme() {
  return useQuery({
    queryKey: documentsKey("settings"), queryFn: () => desktop.documents<unknown>("settings"),
    enabled: desktopAvailable(),
    select: (values) => {
      const value = values.find((entry) => entry.id === "theme")?.value;
      return value === "light" || value === "dark" ? value : "system";
    },
  });
}

function useBackground() {
  return useQuery({
    queryKey: documentsKey("settings"), queryFn: () => desktop.documents<unknown>("settings"),
    enabled: desktopAvailable(),
    select: (values): Background => {
      const value = values.find((entry) => entry.id === "background")?.value;
      return value === "melody" || value === "academic" || value === "xiaodai" ? value : "off";
    },
  });
}

export function ThemeEffect() {
  const theme = useTheme().data ?? "system";
  const background = useBackground().data ?? "off";
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.background = background;
  }, [background, theme]);
  return null;
}

// 2026-11-21：系统页集合外观、备份与恢复和本机数据重置。
export function SystemSettings() {
  const cache = useQueryClient();
  const settings = useTheme();
  const background = useBackground();
  const enabled = desktopAvailable();
  const theme = useMutation({
    mutationFn: (value: Theme) => desktop.put("settings", "theme", value),
    onSuccess: () => cache.invalidateQueries({ queryKey: documentsKey("settings") }),
  });
  const changeBackground = useMutation({
    mutationFn: (value: Background) => desktop.put("settings", "background", value),
    onSuccess: () => cache.invalidateQueries({ queryKey: documentsKey("settings") }),
  });


  // 2026-11-21：重置完成后刷新工作区查询，并更新系统页的状态提示。
  const reset = useMutation({
    // 2026-11-23：重置之后不会再写入重置前的词条删除标记。
    mutationFn: async () => {
      await vocabularyRemovals.flush(cache);
      return desktop.reset();
    },
    onSuccess: async () => {
      cache.removeQueries({ queryKey: ["reading-asset"] });
      cache.removeQueries({ queryKey: ["listening-asset"] });
      await cache.invalidateQueries();
    },
  });

  // 2026-11-21：系统设置的操作结果与日志页分开显示。
  const error = theme.error || settings.error || background.error || changeBackground.error || reset.error;
  return <>
    {/* 2026-11-19：移除设置模块页头，直接显示设置卡片。 */}
    {!enabled && <p className="notice">本机数据备份与恢复在桌面应用中可用。</p>}
    {error && <p className="notice danger" role="alert">{errorText(error)}</p>}
    {reset.isSuccess && <p className="notice" role="status">已重置本机学习数据。</p>}
    <section className="card settings-card">
      {/* 2026-11-21：外观区块直接显示标题和选项。 */}
      <h2>外观</h2>
      <div className="table-actions"><label>主题<select aria-label="主题" value={settings.data ?? "system"} disabled={!enabled || theme.isPending} onChange={(event) => theme.mutate(event.target.value as Theme)}>
        <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
      </select></label>
      <label>动态背景<select value={background.data ?? "off"} disabled={!enabled || changeBackground.isPending}
        onChange={(event) => changeBackground.mutate(event.target.value as Background)}>
        <option value="off">关闭</option><option value="melody">Melody</option>
        <option value="academic">Academic</option><option value="xiaodai">XiaoDai</option>
      </select></label></div>
    </section>
    {/* 2026-11-23：目录配置同时管理题库、词表、文档和本地语音模型。 */}
    <ResourceDirectories />
    {/* 2026-11-23：备份恢复和本机回退点共用一个面板。 */}
    <Backups />
    <section className="card settings-card">
      {/* 2026-11-21：重置范围在操作的确认弹窗中说明。 */}
      <h2>重置本机数据</h2>
      <button type="button" className="button dangerous" disabled={!enabled || reset.isPending} onClick={() => {
        if (window.confirm("确认清空学习数据、导入资料、AI 模型连接及密钥和本机回退点？")) reset.mutate();
      }}>重置学习数据</button>
    </section>
  </>;
}

// 2026-11-21：日志页提供诊断记录和手动数据库检查。
export function LogSettings() {
  const enabled = desktopAvailable();
  const check = useMutation({ mutationFn: desktop.info });
  const diagnostic = check.data;
  return <>
    {!enabled && <p className="notice">本地诊断和数据检查在桌面应用中可用。</p>}
    {/* 2026-11-27：考试计划放在日志页顶部，日历可在卡片下方展开。 */}
    <ExamPlanSettings />
    <Diagnostics />
    <section className="card settings-card">
      {/* 2026-11-21：数据检查区块直接显示标题与检查按钮。 */}
      <h2>数据检查</h2>
      <button type="button" className="button secondary" disabled={!enabled || check.isPending} onClick={() => check.mutate()}><ShieldCheck size={16} />检查本机数据</button>
      {check.error && <p className="notice danger folder-list" role="alert">{errorText(check.error)}</p>}
      {diagnostic && <div className="diagnostic">
        <p>{diagnostic.database} · 结构版本 {diagnostic.version} · SQLite {diagnostic.check}</p>
        <p>{diagnostic.records} 条正式成绩 · {diagnostic.documents} 条工作区资料</p>
      </div>}
    </section>
  </>;
}
